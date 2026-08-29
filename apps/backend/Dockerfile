FROM oven/bun:1

WORKDIR /app

# Install system dependencies
RUN apt-get update && \
  apt-get install -y \
  curl \
  python3 \
  bash \
  ca-certificates \
  gnupg && \
  rm -rf /var/lib/apt/lists/*

# Add the Google Cloud SDK repository
RUN mkdir -p /etc/apt/keyrings && \
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | \
  gpg --dearmor -o /etc/apt/keyrings/google-cloud.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/google-cloud.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
  > /etc/apt/sources.list.d/google-cloud-sdk.list

# Install Google Cloud CLI + GKE auth plugin
RUN apt-get update && \
  apt-get install -y \
  google-cloud-cli \
  google-cloud-cli-gke-gcloud-auth-plugin && \
  rm -rf /var/lib/apt/lists/*

ENV USE_GKE_GCLOUD_AUTH_PLUGIN=True


COPY ./package.json .

COPY --parents ./packages/db/package.json ./packages/db/bun.lock ./
COPY --parents ./packages/common/package.json ./
COPY --parents ./apps/backend/package.json ./apps/backend/bun.lock ./

RUN bun install

COPY --parents ./apps/backend ./
COPY --parents ./packages/db ./
COPY --parents ./packages/common ./

WORKDIR /app/packages/db

RUN bunx prisma generate

EXPOSE 3001

WORKDIR /app/apps/backend

CMD ["bun", "run", "start"]
