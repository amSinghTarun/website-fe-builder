export function workspacePodAffinity(runtimeId: string) {
  return {
    podAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: [
        {
          labelSelector: {
            matchLabels: { app: `${runtimeId}-workspace` },
          },
          topologyKey: "kubernetes.io/hostname",
        },
      ],
    },
  };
}
