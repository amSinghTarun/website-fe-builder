import { toRuntimeId } from "@sky/runtime-id";

export const wsServerDeploymentSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: `apps/v1`,
    kind: `Deployment`,
    metadata: {
      name: `${runtimeId}-ws-server-deployment`,
      labels: {
        app: `${runtimeId}-ws-server`,
        "sky.dev/component": "websocket",
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          app: `${runtimeId}-ws-server`,
        },
      },
      template: {
        metadata: {
          labels: {
            app: `${runtimeId}-ws-server`,
          },
        },
        spec: {
          containers: [
            {
              name: `${runtimeId}-ws-server`,
              image: "tarunsingh28/sky-ws-server",
              imagePullPolicy: "Always",
              ports: [{ containerPort: 8080 }],
              resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "250m", memory: "256Mi" },
              },
            },
          ],
        },
      },
    },
  };
};
