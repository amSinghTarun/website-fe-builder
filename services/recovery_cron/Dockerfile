# as docker can't go up the directories so this needs to be called from the root and that is the way it's written
# "build": "cd ../../ && docker build -f ./services/recovery_cron/Dockerfile -t recovery-app ."

# And also .dockerignore has to be placed in root directory

# Also we need to pass GOOGLE_APPLICATION_CREDENTIALS as that is how gcp connectes but this will not work on k8s as w can't really be copying our conf in k8s directly
#  so we are going to use OIDC in github actions, which store the creds in image in metadata and in container it works smothly
# docker run -e PROJECT_ID="project-b955da7b-8f9e-4324-af2" -e GOOGLE_APPLICATION_CREDENTIALS="/app/gcp-creds.json" -v \
#  "$HOME/.config/gcloud/application_default_credentials.json:/app/gcp-creds.json:ro" -e DATABASE_URL="postgres://postgres:mysecret123@localhost:5432/postgres" recovery-app:lates

FROM oven/bun:1

WORKDIR /app

ENV DATABASE_URL=""

COPY ./package.json ./

COPY --parents ./services/recovery_cron/package.json ./services/recovery_cron/bun.lock ./
COPY --parents ./packages/db/package.json ./
COPY --parents ./packages/common/package.json ./

RUN bun install

COPY ./services/recovery_cron/ ./services/recovery_cron/
COPY ./packages/db/ ./packages/db/
COPY ./packages/common/ ./packages/common/

WORKDIR /app/packages/db/

RUN bunx prisma generate 

WORKDIR /app/services/recovery_cron

CMD ["bun", "run", "start"]
