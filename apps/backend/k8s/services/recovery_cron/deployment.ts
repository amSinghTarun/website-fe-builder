import { toRuntimeId } from "@sky/common";
import { workspacePodAffinity } from "../../workspace-affinity";
import { runtimeImage } from "../../runtime-image";

export const recoveryDeploymentSpec = (databaseProjectId: string) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  return {
    apiVersion: `apps/v1`,
    kind: `Deployment`,
    metadata: {
      name: `${runtimeId}-recovery`,
      labels: {
        app: `${runtimeId}-recovery-cron`,
        "sky.dev/component": "recovery",
      },
    },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: {
        matchLabels: {
          app: `${runtimeId}-recovery-cron`,
        },
      },
      template: {
        metadata: {
          labels: {
            app: `${runtimeId}-recovery-cron`,
          },
        },
        spec: {
          restartPolicy: "Always",
          serviceAccountName: "k8s-service-account",
          affinity: workspacePodAffinity(runtimeId),
          containers: [
            {
              name: `${runtimeId}-recovery-cron`,
              image: runtimeImage("tarunsingh28/sky-recovery-cron"),
              imagePullPolicy: "Always",
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
              },
              env: [
                { name: "DATABASE_PROJECT_ID", value: databaseProjectId },
                { name: "APP_NAMESPACE", value: "default" },
                { name: "WORKSPACE_PATH", value: "/user-app/my-app" },
                { name: "AGENT_PORT", value: "3000" },
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
                  name: `${runtimeId}-volume`,
                  mountPath: "/user-app",
                },
              ],
            },
          ],
          volumes: [
            {
              name: `${runtimeId}-volume`,
              persistentVolumeClaim: {
                claimName: `${runtimeId}-pvc`,
              },
            },
          ],
        },
      },
    },
  };
};
