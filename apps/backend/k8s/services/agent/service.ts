export const agentServiceSpec = (projectId: string) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: `${projectId}-agent-service`,
  },
  spec: {
    type: "ClusterIP",
    selector: {
      app: `${projectId}-agent`,
    },
    ports: [
      {
        port: 3001,
        targetPort: 3001,
      },
    ],
  },
});
