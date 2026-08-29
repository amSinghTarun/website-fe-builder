import { toRuntimeId } from "@sky/common";

export const agentServiceSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `${runtimeId}-agent-service`,
    },
    spec: {
      type: "ClusterIP",
      selector: {
        app: `${runtimeId}-agent`,
      },
      ports: [
        {
          port: 3000,
          targetPort: 3000,
        },
      ],
    },
  };
};
