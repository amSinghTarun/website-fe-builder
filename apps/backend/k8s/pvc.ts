import { toRuntimeId } from "@sky/common";

export const getPvcSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: `${runtimeId}-pvc`,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "500Mi",
        },
      },
    },
  };
};
