FROM node:22-slim AS build

WORKDIR /app

COPY ./apps/frontend/package*.json ./
RUN npm ci

COPY ./apps/frontend ./
RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY ./apps/frontend/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/build ./build

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
