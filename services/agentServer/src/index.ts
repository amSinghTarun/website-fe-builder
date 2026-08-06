import Fastify from "fastify";
import z, { keyof } from "zod";
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
import {
  prisma,
  Prisma,
  PrismaClient,
  type ConversationHistory,
} from "@sky/db";
import { mergeWorktree, tools } from "./tools/index.js";

const app = Fastify().withTypeProvider<ZodTypeProvider>();

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
      let geminiAgent = new GeminiProvider(request.body.projectId);

      const textStream = geminiAgent.agentStream({
        id: "1",
        message: request.body.message,
      });

      return new Response(
        async function* () {
          for await (let output of textStream) {
            yield JSON.stringify(output);
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
      console.log(catchUserInputResolver.get(request.body.uuid));
      catchUserInputResolver.get(request.body.uuid)?.(request.body.message);
    } catch (error) {
      console.log(error);
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
      for (let tool of request.body.toolCalls) {
        if (tool.from == "LOOP") {
          mergeWorktree(JSON.parse(tool.contents as string).args);
          continue;
        }
        tools[tool.toolCall as keyof typeof tools].executable(
          JSON.parse(tool.contents as string).args,
          JSON.parse(tool.contents as string).context,
        );
      }
    } catch (error) {
      console.log(error);
    }
  },
);

await app.listen({ port: 3000, host: "0.0.0.0" });
