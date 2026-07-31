// No pod is going to access this deployment, so I don't think we need an clusterIp for this

// export const recoveryServiceSpec = (projectId: string) => ({
//   apiVersion: "v1",
//   kind: "Service",
//   metadata: {
//     name: `${projectId}-recoveryCron-service`,
//   },
//   spec: {
//     type: "ClusterIP",
//     selector: {
//       app: `${projectId}-recoveryCron`,
//     },
//   },
// });
