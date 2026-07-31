FROM oven/bun:1-alpine

WORKDIR /app

ENV DATABASE_URL=""

COPY ./package.json ./

COPY --parents ./packages/db/package.json ./packages/db/bun.lock ./

RUN bun install

COPY --parents ./packages/db ./

WORKDIR /app/packages/db

CMD ["bunx", "prisma", "migrate", "deploy"]