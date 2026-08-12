import { toRuntimeId } from "@sky/runtime-id";

export const workspaceDeploymentSpec = (
  feLibrary: string,
  databaseProjectId: string,
) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: `${runtimeId}-workspace`,
      labels: {
        app: `${runtimeId}-workspace`,
      },
    },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: {
        matchLabels: {
          app: `${runtimeId}-workspace`,
        },
      },
      template: {
        metadata: {
          labels: {
            app: `${runtimeId}-workspace`,
          },
        },
        spec: {
          containers: [
            {
              name: "node",
              image: "node:lts-alpine",
              workingDir: "/app",
              ports: [
                {
                  containerPort: 5173,
                },
              ],
              env: [
                {
                  name: "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
                  value: "project.tarun.co",
                },
              ],
              command: [
                "/bin/sh",
                "-c",
                `
                set -eu
                apk add --no-cache git

                if [ ! -f /app/my-app/package.json ] || [ ! -d /app/my-app/.git ]; then
                  until [ -f /app/.sky-restore-ready ]; do sleep 1; done
                fi

                if [ ! -f /app/my-app/package.json ]; then
                  cd /app
                  npm create vite@latest my-app -- --template ${feLibrary}
                fi

                cd /app/my-app
                npm install

                if [ ! -d .git ]; then
                  git init -b main
                  git config user.name "SKY Workspace"
                  git config user.email "workspace@sky.local"
                  git add .
                  git commit -m "Initial generated workspace" --allow-empty
                fi

                exec npm run dev -- --host 0.0.0.0 --base /workspace/${runtimeId}/`,
              ],
              startupProbe: {
                tcpSocket: { port: 5173 },
                periodSeconds: 1,
                failureThreshold: 120,
              },
              readinessProbe: {
                httpGet: {
                  path: `/workspace/${runtimeId}/`,
                  port: 5173,
                },
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 3,
              },
              resources: {
                requests: { cpu: "250m", memory: "512Mi" },
                limits: { cpu: "1", memory: "1Gi" },
              },
              terminationMessagePolicy: "FallbackToLogsOnError",
              volumeMounts: [
                {
                  name: `${runtimeId}-volume`,
                  mountPath: "/app",
                },
              ],
            },
          ],
          volumes: [
            {
              name: `${runtimeId}-volume`,
              persistentVolumeClaim: {
                claimName: `${runtimeId}-pvc`,
              },
            },
          ],
        },
      },
    },
  };
};
