import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";

const kubeConfig = new KubeConfig();

if (process.env.KUBERNETES_SERVICE_HOST) {
  kubeConfig.loadFromCluster();
} else {
  kubeConfig.loadFromDefault();
}

// Keep every backend Kubernetes operation on the same authenticated clients.
export const k8sAppsApi = kubeConfig.makeApiClient(AppsV1Api);
export const k8sCoreApi = kubeConfig.makeApiClient(CoreV1Api);
