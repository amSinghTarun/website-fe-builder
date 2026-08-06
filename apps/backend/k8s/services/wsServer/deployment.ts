export const wsServerDeploymentSpec = (projectId: string) => ({
  apiVersion: `apps/v1`,
  kind: `Deployment`,
  metadata: {
    name: `${projectId}-ws-server-deployment`,
    labels: {
      app: `${projectId}-ws-server`,
    },
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: `${projectId}-ws-server`,
      },
    },

    template: {
      metadata: {
        labels: {
          app: `${projectId}-ws-server`,
        },
      },

      spec: {
        containers: [
          {
            name: `${projectId}-ws-server`,
            image: "tarunsingh28/sky-ws-server",
            ports: [{ containerPort: 8080 }],
          },
        ],
      },
    },
  },
});
