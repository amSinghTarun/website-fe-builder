FROM oven/bun:1

WORKDIR /app

COPY ./package.json ./bun.lock ./

COPY --parents ./services/wsServer/package.json ./services/wsServer/bun.lock ./

WORKDIR /app/services/wsServer
RUN bun install

WORKDIR /app

COPY --parents ./services/wsServer ./

EXPOSE 8080

WORKDIR /app/services/wsServer

CMD ["bun", "run", "start"]