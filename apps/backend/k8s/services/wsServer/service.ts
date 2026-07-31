export const wsServerServiceSpec = (projectId: string) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: `${projectId}-ws-server-service`,
  },
  spec: {
    type: "ClusterIP",
    selector: {
      app: `${projectId}-ws-server`,
    },
    ports: [
      {
        port: 8080,
        targetPort: 8080,
      },
    ],
  },
});
