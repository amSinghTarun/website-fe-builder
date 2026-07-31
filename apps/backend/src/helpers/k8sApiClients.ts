import { AppsV1Api, KubeConfig, CoreV1Api } from "@kubernetes/client-node";

const kc = new KubeConfig();
kc.loadFromDefault();

export const k8sAppsApi = kc.makeApiClient(AppsV1Api);
export const k8sCoreApi = kc.makeApiClient(CoreV1Api);
