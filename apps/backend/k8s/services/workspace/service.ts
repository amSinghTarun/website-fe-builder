import { toRuntimeId } from "@sky/common";

export const workspaceServiceSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `${runtimeId}-workspace-service`,
    },
    spec: {
      type: "ClusterIP",
      selector: {
        app: `${runtimeId}-workspace`,
      },
      ports: [
        {
          port: 5173,
          targetPort: 5173,
        },
      ],
    },
  };
};
