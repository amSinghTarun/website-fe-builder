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
} from "./helpers";
import { checkAuth } from "./middleware";
import "dotenv/config";
import { customAlphabet } from "nanoid";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { toRuntimeId } from "@sky/runtime-id";
import { Readable } from "node:stream";

const PORT = 3001;
const projectsBaseUrl = (
  process.env.PROJECTS_BASE_URL?.trim() || "http://project.tarunn.co"
).replace(/\/+$/, "");

function projectRuntimeRoutes(databaseProjectId: string) {
  const runtimeId = toRuntimeId(databaseProjectId);
  const workspacePath = `/workspace/${runtimeId}/`;

  return {
    runtimeId,
    agentPath: `/agent/${runtimeId}`,
    workspacePath,
    workspaceUrl: `${projectsBaseUrl}${workspacePath}`,
    websocketPath: `/ws/${runtimeId}`,
  };
}

async function openAgentStream(
  databaseProjectId: string,
  message: string,
): Promise<Response> {
  const runtimeId = toRuntimeId(databaseProjectId);
  const url = `http://${runtimeId}-agent-service.default.svc.cluster.local:3000/chat`;
  let lastError = "Agent runtime is not ready";

  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, projectId: databaseProjectId }),
      });

      if (response.ok) return response;

      lastError = `Agent returned ${response.status}: ${await response.text()}`;
      if (![502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 60) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  throw new Error(`Unable to reach the project agent: ${lastError}`);
}

const app = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

await app.register(cors, {
  hook: "onRequest",
  origin: (origin, callback) => {
    const allowedOrigins = new Set(
      (process.env.CORS_ORIGINS ??
        "http://localhost:5173,http://sky.tarunn.co,https://sky.tarunn.co")
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
        throw new Error(
          "Username already exist, Please just click signup again",
        );
      }
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
    console.log(request.query.projectId);

    let chatHistory = await prisma.conversationHistory.findMany({
      where: {
        projectId: request.query.projectId as string,
        type: "TEXT_MESSAGE",
        project: { userId: request.userId },
      },
      orderBy: { id: "asc" },
    });
    console.log(chatHistory);
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

    // need to return the url of server so that we can display frontend as per it

    return reply
      .code(201)
      .send({
        status: "success",
        message: "Infra created",
        data: {
          ...runtime,
          ...projectRuntimeRoutes(projectId),
        },
      });
  },
);

app.get(
  "/getServerUrl",
  {
    onRequest: checkAuth,
  },
  async (request, reply) => {
    // send the url of the server running in k8s, for user to see the display
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

    const agentResponse = await openAgentStream(
      project.id,
      request.body.message,
    );

    if (!agentResponse.body) {
      throw new Error("Agent returned an empty response stream");
    }

    return reply
      .header("Content-Type", "text/event-stream")
      .header("Cache-Control", "no-cache")
      .header("X-Accel-Buffering", "no")
      .send(Readable.fromWeb(agentResponse.body as any));
  },
);

app.get(
  "/getServerFilesAndCode",
  {
    onRequest: checkAuth,
  },
  async (request, reply) => {
    // expose an api from the agent to get the code and files of the project, cache the files in browser,
    // also send the changes files as well, so that browser can store them in state
    //
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
