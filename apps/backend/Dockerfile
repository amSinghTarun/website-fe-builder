FROM oven/bun:1-alpine

WORKDIR /app

# 1. Install required system dependencies
RUN apk add --no-cache curl python3 bash libc6-compat

# 2. Run the official Google Cloud interactive script in headless mode
RUN curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts

# 3. Expose environment flags globally
ENV PATH="/root/google-cloud-sdk/bin:${PATH}"
ENV USE_GKE_GCLOUD_AUTH_PLUGIN=True

# 4. Install the auth plugin using the newly registered gcloud path
RUN gcloud components install gke-gcloud-auth-plugin --quiet

COPY ./package.json .

COPY --parents ./packages/db/package.json ./packages/db/bun.lock ./
COPY --parents ./apps/backend/package.json ./apps/backend/bun.lock ./

RUN bun install

COPY --parents ./apps/backend ./
COPY --parents ./packages/db ./

EXPOSE 3001

WORKDIR /app/apps/backend

CMD ["bun", "run", "start"]
