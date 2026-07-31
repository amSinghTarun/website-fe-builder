export const workspaceServiceSpec = (projectId: string) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: `${projectId}-workspace-service`,
  },
  spec: {
    type: "ClusterIP",
    selector: {
      app: `${projectId}-workspace`,
    },
    ports: [
      {
        port: 3000,
        targetPort: 8080,
      },
    ],
  },
});
