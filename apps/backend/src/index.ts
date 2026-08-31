import fastify from "fastify";
import scalar from "@scalar/fastify-api-reference";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import fastifySwagger from "@fastify/swagger";
import { z } from "zod/v4";
import { prisma, Prisma } from "@sky/db";
import {
  hashPassword,
  createJwt,
  verifyHashedPassword,
  spinupK8sResources,
  getProjectRuntimeStatus,
  getClusterTopology,
  projectRuntimeRoutes,
} from "./helpers";
import { checkAuth } from "./middleware";
import "dotenv/config";
import { customAlphabet } from "nanoid";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { toRuntimeId } from "@sky/common";
import { Readable } from "node:stream";

const PORT = 3001;
const AGENT_STARTUP_ATTEMPTS = 150;
const AGENT_STARTUP_RETRY_MS = 2000;

async function openAgentStream(
  databaseProjectId: string,
  message: string,
  signal?: AbortSignal,
): Promise<Response> {
  const runtimeId = toRuntimeId(databaseProjectId);
  const url = `http://${runtimeId}-agent-service.default.svc.cluster.local:3000/chat`;
  let lastError = "Agent runtime is not ready";

  for (let attempt = 1; attempt <= AGENT_STARTUP_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId: databaseProjectId }),
        signal,
      });

      if (response.ok) return response;

      lastError = `Agent returned ${response.status}: ${await response.text()}`;
      if (![502, 503, 504].includes(response.status)) break;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < AGENT_STARTUP_ATTEMPTS) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(signal?.reason ?? new Error("Generation stopped by user"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const finishWait = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const timer = setTimeout(finishWait, AGENT_STARTUP_RETRY_MS);
        if (signal?.aborted) onAbort();
      });
    }
  }

  throw new Error(`Unable to reach the project agent: ${lastError}`);
}

const activeAgentRequests = new Map<string, AbortController>();

async function stopAgent(databaseProjectId: string): Promise<boolean> {
  const activeRequest = activeAgentRequests.get(databaseProjectId);
  const stoppedBackendRequest = Boolean(
    activeRequest && !activeRequest.signal.aborted,
  );
  activeRequest?.abort(new Error("Generation stopped by user"));

  const runtimeId = toRuntimeId(databaseProjectId);
  try {
    const response = await fetch(
      `http://${runtimeId}-agent-service.default.svc.cluster.local:3000/stop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: databaseProjectId }),
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Agent rejected the stop request (${response.status}): ${await response.text()}`,
      );
    }

    const result = (await response.json()) as { stopped?: boolean };
    return stoppedBackendRequest || result.stopped === true;
  } catch {
    if (stoppedBackendRequest) return true;
    return false;
  }
}

async function continueAgent(
  databaseProjectId: string,
  uuid: string,
  message: string,
): Promise<void> {
  const runtimeId = toRuntimeId(databaseProjectId);
  const response = await fetch(
    `http://${runtimeId}-agent-service.default.svc.cluster.local:3000/continue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: databaseProjectId, uuid, message }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Agent rejected the response (${response.status}): ${await response.text()}`,
    );
  }
}

async function getAgentFiles(databaseProjectId: string): Promise<unknown> {
  const runtimeId = toRuntimeId(databaseProjectId);
  const response = await fetch(
    `http://${runtimeId}-agent-service.default.svc.cluster.local:3000/files?projectId=${encodeURIComponent(databaseProjectId)}`,
    { signal: AbortSignal.timeout(10_000) },
  );

  if (!response.ok) {
    throw new Error(
      `Unable to read generated files (${response.status}): ${await response.text()}`,
    );
  }

  return response.json();
}

const app = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

await app.register(cors, {
  hook: "onRequest",
  origin: (origin, callback) => {
    const allowedOrigins = new Set(
      (
        process.env.CORS_ORIGINS ??
        "http://localhost:5173,http://sky.traun.co,https://sky.traun.co"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );

    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
});

app.register(cookie);

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Lovable Backend",
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

app.get(
  "/health",
  {
    schema: {
      response: {
        200: z.object({
          status: z.enum(["success", "error"]),
          message: z.string(),
        }),
      },
    },
  },
  (request, reply) => {
    reply.code(200).send({
      status: "success",
      message: "Perps Exchange is working",
    });
  },
);

app.get("/whoAmI", async (request, reply) => {
  try {
    await checkAuth(request);
    return reply.code(200).send({
      status: "success",
      message: "You are unique",
      body: {
        username: request.username,
      },
    });
  } catch (error: any) {
    return reply
      .code(401)
      .setCookie("token", "deleted", {
        expires: new Date(),
        sameSite: "lax",
        httpOnly: true,
      })
      .send({
        status: "error",
        message: error.message,
      });
  }
});

app.post(
  "/signup",
  {
    schema: {
      body: z.object({
        username: z.string().max(15).default(""),
        password: z.string().min(8).default("password"),
      }),
    },
  },
  async (request, reply) => {
    try {
      let hashedPassword = await hashPassword(request.body.password);
      let randomUsernamePartFnc = customAlphabet(
        "abcdefghijklmnopqrstuvwxyz",
        6,
      );
      let username =
        request.body.username == ""
          ? `user-${randomUsernamePartFnc()}`
          : request.body.username;

      console.log(username);

      const user = await prisma.user.create({
        data: {
          username: username,
          password: hashedPassword,
        },
      });

      let cookieJwtToken = createJwt(user.username, user.id);

      return reply
        .code(201)
        .setCookie("token", cookieJwtToken, {
          maxAge: 60 * 60 * 24 * 7,
          sameSite: "lax",
          httpOnly: true,
        })
        .send({
          status: "success",
          message: "user created",
          body: {
            username: user.username,
          },
        });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code == "P2002"
      ) {
        return reply.code(409).send({
          status: "error",
          message: "Username already exists. Please choose another username.",
        });
      }

      throw error;
    }
  },
);

app.post(
  "/login",
  {
    schema: {
      body: z.object({
        username: z.string(),
        password: z.string(),
      }),
    },
  },
  async (request, reply) => {
    let user = await prisma.user.findUnique({
      where: {
        username: request.body.username,
      },
    });

    if (!user) throw new Error("No user found with this username");

    let passwordIsCorrect = await verifyHashedPassword(
      user.password,
      request.body.password,
    );

    let cookieJwtToken = createJwt(user.username, user.id);

    if (!passwordIsCorrect) throw new Error("Incorrect password");

    reply.setCookie("token", cookieJwtToken, {
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
      httpOnly: true,
    });

    return reply.code(201).send({
      status: "success",
      message: "user created",
      body: { token: createJwt(user.username, user.id) },
    });
  },
);

app.get(
  "/projects",
  {
    onRequest: checkAuth,
  },
  async (request, reply) => {
    let userProjects = await prisma.project.findMany({
      where: {
        userId: request.userId,
      },
      orderBy: { updatedAt: "desc" },
    });
    return reply.code(200).send({
      status: "success",
      message: "Projects of user",
      data: userProjects.map((project) => ({
        ...project,
        ...projectRuntimeRoutes(project.id),
      })),
    });
  },
);

app.get(
  "/clusterTopology",
  {
    onRequest: checkAuth,
  },
  async (_request, reply) => {
    return reply.code(200).send({
      status: "success",
      message: "Current Kubernetes cluster topology",
      data: await getClusterTopology(),
    });
  },
);

app.get(
  "/chat",
  {
    onRequest: checkAuth,
    schema: {
      querystring: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const chatHistory = await prisma.conversationHistory.findMany({
      where: {
        projectId: request.query.projectId as string,
        type: "TEXT_MESSAGE",
        project: { userId: request.userId },
      },
      orderBy: { id: "asc" },
    });
    return reply.code(200).send({
      status: "success",
      message: "chat of specified project",
      data: chatHistory,
    });
  },
);

app.post(
  "/createProject",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        title: z.string(),
        feLibrary: z.enum(["react", "vue"]),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.create({
      data: {
        library: request.body.feLibrary,
        title: request.body.title,
        userId: +request.userId!,
      },
    });

    return reply
      .code(201)
      .send({ status: "success", message: "project created", data: project });
  },
);

app.post(
  "/newChat",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        projectId: z.string(),
        initialPrompt: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.body.projectId,
        userId: request.userId,
      },
      select: { id: true, library: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    const { id: projectId, library: feLibrary } = await prisma.project.update({
      where: { id: project.id },
      data: {
        initialPrompt: request.body.initialPrompt,
      },
    });

    const runtime = await spinupK8sResources(feLibrary, projectId);

    return reply.code(201).send({
      status: "success",
      message: "Infra created",
      data: {
        ...runtime,
        ...projectRuntimeRoutes(projectId),
      },
    });
  },
);

app.post(
  "/resumeProject",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.body.projectId,
        userId: request.userId,
      },
      select: {
        id: true,
        title: true,
        library: true,
        initialPrompt: true,
      },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    const currentRuntime = await getProjectRuntimeStatus(project.id);

    if (currentRuntime.status === "ready") {
      return reply.code(200).send({
        status: "success",
        message: "Project runtime is already ready",
        data: {
          ...project,
          ...currentRuntime,
        },
      });
    }

    const runtime = await spinupK8sResources(project.library, project.id);

    return reply.code(202).send({
      status: "success",
      message: "Project runtime is starting",
      data: {
        ...project,
        ...runtime,
        ...projectRuntimeRoutes(project.id),
        status: "starting",
      },
    });
  },
);

app.get(
  "/runtimeStatus",
  {
    onRequest: checkAuth,
    schema: {
      querystring: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.query.projectId,
        userId: request.userId,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    return reply.code(200).send({
      status: "success",
      message: "Project runtime status",
      data: await getProjectRuntimeStatus(project.id),
    });
  },
);

app.post(
  "/sendUserMessage",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        projectId: z.string(),
        message: z.string().min(1),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.body.projectId,
        userId: request.userId,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    const currentRequest = activeAgentRequests.get(project.id);
    if (currentRequest && !currentRequest.signal.aborted) {
      return reply.code(409).send({
        status: "error",
        message: "A generation is already active for this project",
      });
    }

    const requestController = new AbortController();
    activeAgentRequests.set(project.id, requestController);
    const abortOnClientDisconnect = () => {
      requestController.abort(new Error("Client disconnected"));
    };
    request.raw.once("aborted", abortOnClientDisconnect);
    reply.raw.once("close", abortOnClientDisconnect);

    let agentResponse: Response;
    try {
      agentResponse = await openAgentStream(
        project.id,
        request.body.message,
        requestController.signal,
      );
    } catch (error) {
      if (activeAgentRequests.get(project.id) === requestController) {
        activeAgentRequests.delete(project.id);
      }
      request.raw.removeListener("aborted", abortOnClientDisconnect);
      reply.raw.removeListener("close", abortOnClientDisconnect);
      throw error;
    }

    if (!agentResponse.body) {
      activeAgentRequests.delete(project.id);
      throw new Error("Agent returned an empty response stream");
    }

    const responseStream = Readable.fromWeb(agentResponse.body as any);
    const cleanup = () => {
      request.raw.removeListener("aborted", abortOnClientDisconnect);
      reply.raw.removeListener("close", abortOnClientDisconnect);
      if (activeAgentRequests.get(project.id) === requestController) {
        activeAgentRequests.delete(project.id);
      }
    };
    responseStream.once("close", cleanup);
    responseStream.once("end", cleanup);
    responseStream.once("error", cleanup);

    return reply
      .header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("X-Accel-Buffering", "no")
      .send(responseStream);
  },
);

app.post(
  "/stop",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.body.projectId,
        userId: request.userId,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    const stopped = await stopAgent(project.id);
    return reply.code(200).send({
      status: "success",
      message: stopped ? "Generation stopped" : "No active generation",
      stopped,
    });
  },
);

app.post(
  "/continue",
  {
    onRequest: checkAuth,
    schema: {
      body: z.object({
        projectId: z.string(),
        uuid: z.string().min(1),
        message: z.string().min(1),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.body.projectId,
        userId: request.userId,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    await continueAgent(project.id, request.body.uuid, request.body.message);

    return reply.code(200).send({
      status: "success",
      message: "Response sent to agent",
    });
  },
);

// break in 2 parts
app.get(
  "/getServerFilesAndCode",
  {
    onRequest: checkAuth,
    schema: {
      querystring: z.object({
        projectId: z.string(),
      }),
    },
  },
  async (request, reply) => {
    const project = await prisma.project.findFirst({
      where: {
        id: request.query.projectId,
        userId: request.userId,
      },
      select: { id: true },
    });

    if (!project) {
      return reply.code(404).send({
        status: "error",
        message: "Project not found",
      });
    }

    return reply.code(200).send(await getAgentFiles(project.id));
  },
);

app.get("/", {}, async (request, reply) => {});

app.setErrorHandler((error: any, request, reply) => {
  console.log("---------- ERROR IN BACKEND SERVER");
  console.log(error);
  return reply.code(error.statusCode || 500).send({
    status: "error",
    message: error.message || "Something went wrong",
  });
});

const start = async () => {
  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info("Backend server started successfully on PORT : " + PORT);
  } catch (error) {
    app.log.error("Issue starting server");
    process.exit(1);
  }
};
start();
