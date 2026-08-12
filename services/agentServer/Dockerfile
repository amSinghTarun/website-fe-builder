FROM oven/bun:1

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV DATABASE_URL=""
ENV GCP_PROJECT_ID=""

COPY ./package.json ./

COPY --parents ./services/agentServer/package.json ./
COPY --parents ./packages/db/package.json ./packages/db/bun.lock ./
COPY --parents ./packages/runtime-id/package.json ./

RUN bun install

COPY ./services/agentServer ./services/agentServer
COPY ./packages/db ./packages/db
COPY ./packages/runtime-id ./packages/runtime-id

WORKDIR /app/packages/db

RUN bunx prisma generate 

EXPOSE 3000

WORKDIR /app/services/agentServer

CMD ["bun", "run", "start"]
