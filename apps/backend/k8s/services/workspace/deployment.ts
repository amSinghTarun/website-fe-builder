export const workspaceDeploymentSpec = (
  fe_library: string,
  projectId: string,
) => {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: `${projectId}-workspace-runtime-deployment`,
      labels: {
        app: `${projectId}-workspace`,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          app: `${projectId}-workspace`,
        },
      },
      template: {
        metadata: {
          labels: {
            app: `${projectId}-workspace`,
          },
        },
        spec: {
          containers: [
            {
              name: "node",
              image: "node:lts-alpine",
              workingDir: "/app",
              ports: [
                {
                  containerPort: 5173,
                },
              ],
              command: [
                "/bin/sh",
                "-c",
                `
                if [ ! -d my-app ]; then
                  npm create vite@latest my-app -- --template ${fe_library} 
                fi
                && cd my-app 
                && npm install 
                && npm run dev -- --host 0.0.0.0`,
              ],
              volumeMounts: [
                {
                  name: `${projectId}-volume`,
                  mountPath: "/app",
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
  };
};
