// env variables needed
// database url - constant
// gcp project id - constant
// for the constants create a k8s secret and refer from that

// user project id - dynamic (it is already being passed, just store it in env)

export const agentDeploymentSpec = (projectId: string) => ({
  apiVersion: `apps/v1`,
  kind: `Deployment`,
  metadata: {
    name: `${projectId}-agent-deployment`,
    labels: {
      app: `${projectId}-agent`,
    },
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: `${projectId}-agent`,
      },
    },
    template: {
      metadata: {
        labels: {
          app: `${projectId}-agent`,
        },
      },
      spec: {
        serviceAccountName: "k8s-service-account",
        containers: [
          {
            name: `${projectId}-agent`,
            image: `tarunsingh28/sky-agent`,
            ports: [{ containerPort: 3001 }],
            env: [
              { name: "PROJECT_ID", value: projectId },
              { name: "PORT", value: "3001" },
              {
                name: "DATABASE_URL",
                valueFrom: {
                  secretKeyRef: {
                    name: "sky-secrets",
                    key: "DATABASE_URL",
                  },
                },
              },
              {
                name: "GCP_PROJECT_ID",
                valueFrom: {
                  secretKeyRef: {
                    name: "sky-secrets",
                    key: "GCP_PROJECT_ID",
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
