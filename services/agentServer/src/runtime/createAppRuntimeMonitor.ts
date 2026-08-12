import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { toRuntimeId } from "@sky/runtime-id";
import {
  AppRuntimeMonitor,
  type AppRuntimeRef,
} from "./AppRuntimeMonitor";

export interface ConfiguredAppRuntimeMonitor {
  monitor: AppRuntimeMonitor;
  ref: AppRuntimeRef;
}

let configuredMonitor: ConfiguredAppRuntimeMonitor | undefined;

export function getConfiguredAppRuntimeMonitor():
  | ConfiguredAppRuntimeMonitor
  | undefined {
  if (configuredMonitor) return configuredMonitor;

  if (process.env["APP_RUNTIME_MONITOR_ENABLED"]?.trim() === "false") {
    return undefined;
  }

  const databaseProjectId = process.env["DATABASE_PROJECT_ID"]?.trim();

  if (!databaseProjectId) return undefined;

  const runtimeId = toRuntimeId(databaseProjectId);

  const namespace = process.env["APP_NAMESPACE"]?.trim() || "default";
  const serviceName =
    process.env["WORKSPACE_SERVICE"]?.trim() ||
    `${runtimeId}-workspace-service`;
  const servicePort = Number(process.env["WORKSPACE_PORT"] ?? "5173");
  const kubeConfig = new KubeConfig();
  if (process.env["KUBERNETES_SERVICE_HOST"]) {
    kubeConfig.loadFromCluster();
  } else {
    kubeConfig.loadFromDefault();
  }
  const coreApi = kubeConfig.makeApiClient(CoreV1Api);

  configuredMonitor = {
    monitor: new AppRuntimeMonitor({ coreApi }),
    ref: {
      databaseProjectId,
      namespace,
      workspacePath:
        process.env["WORKSPACE_PATH"]?.trim() || "/user-app/my-app",
      podLabelSelector: `app=${runtimeId}-workspace`,
      containerName:
        process.env["WORKSPACE_CONTAINER"]?.trim() || "node",
      serviceName,
      servicePort: Number.isFinite(servicePort) ? servicePort : 5173,
    },
  };

  return configuredMonitor;
}
