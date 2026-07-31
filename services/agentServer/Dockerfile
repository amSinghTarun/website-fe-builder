FROM oven/bun:1-alpine

WORKDIR /app

ENV DATABASE_URL=""
ENV GCP_PROJECT_ID=""

COPY ./package.json ./

COPY --parents ./services/agentServer/package.json ./
COPY --parents ./packages/db/package.json ./packages/db/bun.lock ./

WORKDIR /app/services/agentServer

RUN bun add @fastify/swagger

WORKDIR /app

RUN bun install

COPY ./services/agentServer ./services/agentServer
COPY ./packages/db ./packages/db

WORKDIR /app/packages/db

RUN bunx prisma generate 

EXPOSE 3000

WORKDIR /app/services/agentServer

CMD ["bun", "run", "start"]