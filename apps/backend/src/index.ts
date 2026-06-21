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
import { hashPassword, createJwt, verifyHashedPassword } from "./helpers";
import { AppsV1Api, KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { checkAuth } from "./middleware";

const PORT = 3000;
const app = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

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
  (_, res) => {
    res
      .code(200)
      .send({ status: "success", message: "Perps Exchange is working" });
  },
);

app.post(
  "/signup",
  {
    schema: {
      body: z.object({
        username: z.string().max(15),
        password: z.string().min(8),
      }),
    },
  },
  async (request, reply) => {
    try {
      let hashedPassword = await hashPassword(request.body.password);

      const user = await prisma.user.create({
        data: {
          username: request.body.username,
          password: hashedPassword,
        },
      });

      return reply.code(201).send({
        status: "success",
        message: "user created",
        body: { token: createJwt(user.id.toString()) },
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code == "P2002"
      ) {
        throw new Error("Username already exist");
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

    if (!passwordIsCorrect) throw new Error("Incorrect password");

    return reply.code(201).send({
      status: "success",
      message: "user created",
      body: { token: createJwt(user.id.toString()) },
    });
  },
);

app.post(
  "/newChat",
  {
    onRequest: async (request, _, done) => {
      await checkAuth(request, done);
    },
    schema: {
      body: z.object({
        title: z.string(),
        initialPrompt: z.string(),
      }),
    },
  },
  async (request, reply) => {
    // if not create the pods required.
    // But how do you check the pods running?

    const kc = new KubeConfig();
    kc.loadFromDefault();
    const k8sAppsApi = kc.makeApiClient(AppsV1Api);
    const k8sCoreApi = kc.makeApiClient(CoreV1Api);

    const { id: projectId } = await prisma.project.create({
      data: {
        userId: +request.userId!,
        title: request.body.title,
        initialPrompt: request.body.initialPrompt,
      },
    });

    // somehow also pass the about projectId for the custom proxy map

    // create volume
    const volume = k8sCoreApi.createPersistentVolume({ body: {} });

    // create the deployments
    const workspace = k8sAppsApi.createNamespacedDeployment({
      namespace: "default",
      body: {},
    });
    const recovery_cron = k8sAppsApi.createNamespacedDeployment({
      namespace: "default",
      body: {},
    });
    const ws = k8sAppsApi.createNamespacedDeployment({
      namespace: "default",
      body: {},
    });
    const agent_loop = k8sAppsApi.createNamespacedDeployment({
      namespace: "default",
      body: {},
    });

    // create services
    const workspaceClusterIp = k8sCoreApi.createNamespacedService({
      namespace: "default",
      body: {},
    });
  },
);

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
