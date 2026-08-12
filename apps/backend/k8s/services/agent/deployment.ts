import { toRuntimeId } from "@sky/runtime-id";

// env variables needed
// database url - constant
// gcp project id - constant
// for the constants create a k8s secret and refer from that

// user project id - dynamic (it is already being passed, just store it in env)

export const agentDeploymentSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: `apps/v1`,
    kind: `Deployment`,
    metadata: {
      name: `${runtimeId}-agent-deployment`,
      labels: {
        app: `${runtimeId}-agent`,
        "sky.dev/component": "agent",
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          app: `${runtimeId}-agent`,
        },
      },
      template: {
        metadata: {
          labels: {
            app: `${runtimeId}-agent`,
          },
        },
        spec: {
          serviceAccountName: "k8s-service-account",
          initContainers: [
            {
              name: "wait-for-workspace",
              image: "busybox:1.36",
              command: [
                "/bin/sh",
                "-c",
                `until [ -f /user-app/my-app/package.json ] && [ -d /user-app/my-app/.git ] && nc -z ${runtimeId}-workspace-service 5173; do sleep 2; done`,
              ],
              volumeMounts: [
                {
                  name: `${runtimeId}-volume`,
                  mountPath: "/user-app",
                },
              ],
            },
          ],
          containers: [
            {
              name: `${runtimeId}-agent`,
              image: `tarunsingh28/sky-agent`,
              imagePullPolicy: "Always",
              ports: [{ containerPort: 3000 }],
              readinessProbe: {
                httpGet: { path: "/health", port: 3000 },
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 5,
              },
              livenessProbe: {
                httpGet: { path: "/health", port: 3000 },
                initialDelaySeconds: 10,
                periodSeconds: 10,
                timeoutSeconds: 2,
              },
              env: [
                { name: "DATABASE_PROJECT_ID", value: databaseProjectId },
                { name: "APP_NAMESPACE", value: "default" },
                { name: "WORKSPACE_PATH", value: "/user-app/my-app" },
                { name: "WORKSPACE_CONTAINER", value: "node" },
                {
                  name: "WORKSPACE_SERVICE",
                  value: `${runtimeId}-workspace-service`,
                },
                { name: "WORKSPACE_PORT", value: "5173" },
                { name: "PORT", value: "3000" },
                {
                  name: "DATABASE_URL",
                  valueFrom: {
                    secretKeyRef: {
                      name: "sky-secrets",
                      key: "DATABASE_URL",
                    },
                  },
                },
                {
                  name: "GCP_PROJECT_ID",
                  valueFrom: {
                    secretKeyRef: {
                      name: "sky-secrets",
                      key: "GCP_PROJECT_ID",
                    },
                  },
                },
              ],
              volumeMounts: [
                {
                  name: `${runtimeId}-volume`,
                  mountPath: "/user-app",
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
