export const recoveryDeploymentSpec = (projectId: string) => ({
  apiVersion: `apps/v1`,
  kind: `Deployment`,
  metadata: {
    name: `${projectId}-recovery-cron-deployment`,
    labels: {
      app: `${projectId}-recovery-cron`,
    },
  },
  spec: {
    replica: 1,
    // based on this selector, this deployment will find and combine any other pod/replica running with same metadata
    selector: {
      matchLabels: {
        app: `${projectId}-recovery-cron`,
      },
    },
    template: {
      metadata: {
        labels: {
          app: `${projectId}-recovery-cron`,
        },
      },
      spec: {
        containers: [
          {
            name: `${projectId}-recovery-cron`,
            image: `HERE will be my agent image in docker hub`,
            env: [
              { name: "PROJECT_ID", value: projectId },
              {
                name: "DATABASE_URL",
                valueFrom: {
                  secretKeyRef: {
                    name: "sky-secrets",
                    key: "DATABASE_URL",
                  },
                },
              },
            ],
            volumeMounts: [
              {
                name: `${projectId}-volume`,
                mountPath: "/user-app",
              },
            ],
          },
        ],
        volumes: [
          {
            name: `${projectId}-volume`,
            persistentVolumeClaim: {
              claimName: `${projectId}-pvc`,
            },
          },
        ],
      },
    },
  },
});
