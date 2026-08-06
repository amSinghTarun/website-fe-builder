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

const PORT = 3001;
const app = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

await app.register(cors, {
  hook: "onRequest",
  origin: "http://localhost:5173",
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
    });
    return reply.code(200).send({
      status: "success",
      message: "Projects of user",
      data: userProjects,
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
      },
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
    const { id: projectId, library: feLibrary } = await prisma.project.update({
      where: {
        id: request.body.projectId,
      },
      data: {
        initialPrompt: request.body.initialPrompt,
      },
    });

    await prisma.conversationHistory.create({
      data: {
        contents: request.body.initialPrompt,
        from: "USER",
        type: "TEXT_MESSAGE",
        projectId: request.body.projectId,
      },
    });

    await spinupK8sResources(feLibrary, `sky-${projectId}`);

    // need to return the url of server so that we can display frontend as per it

    return reply
      .code(201)
      .send({ status: "success", message: "Infra created" });
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

app.get(
  "/sendUserMessage",
  {
    onRequest: checkAuth,
  },
  async (request, reply) => {
    // I should call the api of agent and send message there but how to call the reverse proxy api for agent
    // send the changes files as well, so that browser can store them in state
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
