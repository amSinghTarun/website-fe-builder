import { AppsV1Api, KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import * as k8sConfs from "../../k8s";

const kc = new KubeConfig();
kc.loadFromDefault();

export const spinupK8sResources = async (
  feLibrary: string,
  projectId: string,
) => {
  // create pvc
  const volume = await k8sCoreApi.createNamespacedPersistentVolumeClaim({
    namespace: "default",
    body: k8sConfs.getPvcSpec(projectId),
  });

  // create the deployments
  const workspace = await k8sAppsApi.createNamespacedDeployment({
    namespace: "default",
    body: k8sConfs.workspaceDeploymentSpec(feLibrary, projectId),
  });
  const recovery_cron = await k8sAppsApi.createNamespacedDeployment({
    namespace: "default",
    body: k8sConfs.recoveryDeploymentSpec(projectId),
  });
  const ws = await k8sAppsApi.createNamespacedDeployment({
    namespace: "default",
    body: k8sConfs.wsServerDeploymentSpec(projectId),
  });
  const agent = await k8sAppsApi.createNamespacedDeployment({
    namespace: "default",
    body: k8sConfs.agentDeploymentSpec(projectId),
  });

  // create services
  const wsServerClusterIpService = await k8sCoreApi.createNamespacedService({
    namespace: "default",
    body: k8sConfs.wsServerServiceSpec(projectId),
  });
  const agentClusterIpService = await k8sCoreApi.createNamespacedService({
    namespace: "default",
    body: k8sConfs.agentServiceSpec(projectId),
  });
  const workspacetClusterIpService = await k8sCoreApi.createNamespacedService({
    namespace: "default",
    body: k8sConfs.workspaceServiceSpec(projectId),
  });
};

const k8sAppsApi = kc.makeApiClient(AppsV1Api);
const k8sCoreApi = kc.makeApiClient(CoreV1Api);
