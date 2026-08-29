import { AppsV1Api, KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { toRuntimeId } from "@sky/common";
import * as k8sConfs from "../../k8s";

const kc = new KubeConfig();
if (process.env.KUBERNETES_SERVICE_HOST) {
  kc.loadFromCluster();
} else {
  kc.loadFromDefault();
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: number; statusCode?: number };
  return value.code === 404 || value.statusCode === 404;
}

async function applyDeployment(body: any): Promise<any> {
  const namespace = "default";
  const name = body.metadata.name;

  try {
    const existing = await k8sAppsApi.readNamespacedDeployment({
      name,
      namespace,
    });
    body.metadata.resourceVersion = existing.metadata?.resourceVersion;
    return await k8sAppsApi.replaceNamespacedDeployment({
      name,
      namespace,
      body,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return k8sAppsApi.createNamespacedDeployment({ namespace, body });
  }
}

async function applyService(body: any): Promise<any> {
  const namespace = "default";
  const name = body.metadata.name;

  try {
    const existing = await k8sCoreApi.readNamespacedService({
      name,
      namespace,
    });
    body.metadata.resourceVersion = existing.metadata?.resourceVersion;
    body.spec.clusterIP = existing.spec?.clusterIP;
    body.spec.clusterIPs = existing.spec?.clusterIPs;
    body.spec.ipFamilies = existing.spec?.ipFamilies;
    body.spec.ipFamilyPolicy = existing.spec?.ipFamilyPolicy;
    return await k8sCoreApi.replaceNamespacedService({
      name,
      namespace,
      body,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return k8sCoreApi.createNamespacedService({ namespace, body });
  }
}

async function ensurePvc(body: any): Promise<any> {
  const namespace = "default";
  const name = body.metadata.name;

  try {
    return await k8sCoreApi.readNamespacedPersistentVolumeClaim({
      name,
      namespace,
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return k8sCoreApi.createNamespacedPersistentVolumeClaim({
      namespace,
      body,
    });
  }
}

export const spinupK8sResources = async (
  feLibrary: string,
  databaseProjectId: string,
) => {
  const runtimeId = toRuntimeId(databaseProjectId);

  // create pvc
  const volume = await ensurePvc(k8sConfs.getPvcSpec(databaseProjectId));

  // create the deployments
  const workspace = await applyDeployment(
    k8sConfs.workspaceDeploymentSpec(feLibrary, databaseProjectId),
  );
  const recovery_cron = await applyDeployment(
    k8sConfs.recoveryDeploymentSpec(databaseProjectId),
  );
  const agent = await applyDeployment(
    k8sConfs.agentDeploymentSpec(databaseProjectId),
  );

  // create services
  const agentClusterIpService = await applyService(
    k8sConfs.agentServiceSpec(databaseProjectId),
  );
  const workspacetClusterIpService = await applyService(
    k8sConfs.workspaceServiceSpec(databaseProjectId),
  );

  return {
    runtimeId,
    agentService: `${runtimeId}-agent-service`,
    workspaceService: `${runtimeId}-workspace-service`,
  };
};

const k8sAppsApi = kc.makeApiClient(AppsV1Api);
const k8sCoreApi = kc.makeApiClient(CoreV1Api);
