import Fastify from "fastify";
import z from "zod";
import { GeminiProvider } from "./providers/index.js";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import fastifySwagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import { catchUserInputResolver } from "./helper";
import { type ConversationHistory } from "@sky/db";
import { tools } from "./tools/index.js";
import { normalizeToolResult } from "./types/tools.js";
import { getConfiguredAppRuntimeMonitor } from "./runtime/index.js";
import {
  AgentRunCancelledError,
  agentRunRegistry,
} from "./runtime/AgentRunRegistry.js";

const app = Fastify().withTypeProvider<ZodTypeProvider>();
const configuredDatabaseProjectId = process.env["DATABASE_PROJECT_ID"]?.trim();
const workspacePath = process.env["WORKSPACE_PATH"]?.trim() || process.cwd();
const replayableToolNames = new Set([
  "createFile",
  "updateFile",
  "deleteFile",
  "executeBash",
]);

function assertConfiguredProject(projectId: string): void {
  if (
    configuredDatabaseProjectId &&
    projectId !== configuredDatabaseProjectId
  ) {
    throw new Error("Project ID does not belong to this agent runtime");
  }
}

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Agent Backend",
      description: "Backend for Lovable K8s project",
      version: "1.0.0",
    },
    servers: [],
  },
  transform: jsonSchemaTransform,
});
await app.register(scalar, {
  routePrefix: "/reference",
  configuration: {
    theme: "deepSpace",
  },
  logLevel: "info",
});

app.get("/health", async () => ({ status: "success" }));

app.post(
  "/chat",
  {
    schema: {
      body: z.object({
        message: z.string(),
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    try {
      assertConfiguredProject(request.body.projectId);
      const runController = agentRunRegistry.start(request.body.projectId);
      let geminiAgent = new GeminiProvider(
        request.body.projectId,
        undefined,
        workspacePath,
      );

      const textStream = geminiAgent.agentStream({
        id: "1",
        message: request.body.message,
        signal: runController.signal,
      });

      return new Response(
        async function* () {
          try {
            for await (let output of textStream) {
              yield `data: ${JSON.stringify(output)}\n\n`;
            }
          } finally {
            if (!runController.signal.aborted) {
              runController.abort(new AgentRunCancelledError());
            }
            agentRunRegistry.finish(request.body.projectId, runController);
          }
        },
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        },
      );
    } catch (error) {
      console.log(error);
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

app.post(
  "/stop",
  {
    schema: {
      body: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    try {
      assertConfiguredProject(request.body.projectId);
      return reply.code(200).send({
        status: "success",
        stopped: agentRunRegistry.stop(request.body.projectId),
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

app.post(
  "/continue",
  {
    schema: {
      body: z.object({
        message: z.string(),
        projectId: z.string(),
        uuid: z.string(),
      }),
    },
  },
  async (request, reply) => {
    try {
      assertConfiguredProject(request.body.projectId);
      const resolver = catchUserInputResolver.get(request.body.uuid);
      if (!resolver) {
        return reply.code(409).send({
          error: "This input request is no longer active",
        });
      }
      resolver(request.body.message);
      return reply.code(200).send({ status: "success" });
    } catch (error) {
      console.log(error);
      return reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

app.post(
  "/executeFncCalls",
  {
    schema: {
      body: z.object({
        toolCalls: z.custom<ConversationHistory>().array(),
      }),
    },
  },
  async (request, reply) => {
    try {
      if (
        configuredDatabaseProjectId &&
        request.body.toolCalls.some(
          (toolCall) => toolCall.projectId !== configuredDatabaseProjectId,
        )
      ) {
        throw new Error("Replay contains tool calls from a different project");
      }

      let runtimeMayChange = false;
      const replayResults: Array<{
        toolCall: string | null;
        response: unknown;
      }> = [];

      for (let tool of request.body.toolCalls) {
        if (tool.from == "LOOP") {
          replayResults.push({
            toolCall: tool.toolCall,
            response:
              "Skipped historical worktree merge; replayed file operations are applied directly to the restored main workspace.",
          });
          continue;
        }

        const replayTool =
          tools[tool.toolCall as keyof typeof tools] ??
          Object.values(tools).find(
            (candidate) =>
              candidate.declaration.name === tool.toolCall ||
              candidate.identifier.toString() === tool.toolCall,
          );

        if (!replayTool) {
          replayResults.push({
            toolCall: tool.toolCall,
            response: "Tool is no longer available",
          });
          continue;
        }

        if (!replayableToolNames.has(replayTool.declaration.name!)) {
          replayResults.push({
            toolCall: tool.toolCall,
            response:
              "Skipped non-mutating or orchestration tool during replay",
          });
          continue;
        }

        const stored = JSON.parse(tool.contents as string);
        const result = normalizeToolResult(
          await replayTool.executable(stored.args, { cwd: workspacePath }),
        );
        runtimeMayChange ||= result.effects?.runtimeMayChange === true;
        replayResults.push({
          toolCall: tool.toolCall,
          response: result.response,
        });
      }

      const configuredRuntime = getConfiguredAppRuntimeMonitor();
      const runtimeState =
        runtimeMayChange && configuredRuntime
          ? await configuredRuntime.monitor.waitForSettledState(
              configuredRuntime.ref,
            )
          : undefined;

      return reply.send({ replayResults, runtimeState });
    } catch (error) {
      console.log(error);
      return reply.code(500).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

const port = Number(process.env["PORT"] ?? "3000");
await app.listen({
  port: Number.isFinite(port) ? port : 3000,
  host: "0.0.0.0",
});
