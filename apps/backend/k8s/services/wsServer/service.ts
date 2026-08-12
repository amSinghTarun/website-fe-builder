import { toRuntimeId } from "@sky/runtime-id";

export const wsServerServiceSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: `${runtimeId}-ws-server-service`,
    },
    spec: {
      type: "ClusterIP",
      selector: {
        app: `${runtimeId}-ws-server`,
      },
      ports: [
        {
          port: 8080,
          targetPort: 8080,
        },
      ],
    },
  };
};
