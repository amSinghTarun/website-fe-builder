import { k8sCoreApi } from "./k8sClient";
import type {
  V1Node,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Service,
} from "@kubernetes/client-node";

const NAMESPACE = "default";

export type ClusterTopology = {
  namespace: string;
  observedAt: string;
  nodes: Array<{
    id: string;
    name: string;
    ready: boolean;
    zone: string | null;
    instanceType: string | null;
    capacity: { cpu: string; memory: string; pods: string };
  }>;
  pods: Array<{
    id: string;
    name: string;
    namespace: string;
    nodeName: string | null;
    phase: string;
    ready: boolean;
    restarts: number;
    owner: string | null;
    createdAt: string | null;
    pvcNames: string[];
    projectId: string | null;
    containers: Array<{
      name: string;
      role: "container" | "sidecar" | "init";
      state: "ready" | "running" | "completed" | "waiting" | "failed";
      ready: boolean;
      restarts: number;
    }>;
  }>;
  services: Array<{
    id: string;
    name: string;
    namespace: string;
    type: string;
    clusterIP: string | null;
    ports: string[];
    selectedPodIds: string[];
    projectId: string | null;
  }>;
  pvcs: Array<{
    id: string;
    name: string;
    namespace: string;
    phase: string;
    capacity: string | null;
    accessModes: string[];
    volumeName: string | null;
    mountedByPodIds: string[];
    projectId: string | null;
  }>;
};

function resourceId(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function projectIdFromResourceName(name: string): string | null {
  return name.match(
    /^sky-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-|$)/i,
  )?.[1] ?? null;
}

function selectorMatches(
  selector: Record<string, string> | undefined,
  labels: Record<string, string> | undefined,
): boolean {
  const entries = Object.entries(selector ?? {});
  return entries.length > 0 && entries.every(([key, value]) => labels?.[key] === value);
}

export function buildClusterTopology(
  resources: {
    nodes: V1Node[];
    pods: V1Pod[];
    services: V1Service[];
    pvcs: V1PersistentVolumeClaim[];
  },
  observedAt = new Date(),
): ClusterTopology {
  const rawPods = resources.pods;
  const pods = rawPods.map((pod) => {
    const name = pod.metadata?.name ?? "unknown-pod";
    const namespace = pod.metadata?.namespace ?? NAMESPACE;
    const containerStatuses = pod.status?.containerStatuses ?? [];
    const initContainerStatuses = pod.status?.initContainerStatuses ?? [];
    const statusFor = (name: string, init: boolean) =>
      (init ? initContainerStatuses : containerStatuses).find(
        (status) => status.name === name,
      );
    const stateFor = (
      status: (typeof containerStatuses)[number] | undefined,
    ): "ready" | "running" | "completed" | "waiting" | "failed" => {
      if (status?.ready) return "ready";
      if (status?.state?.running) return "running";
      if (status?.state?.terminated)
        return status.state.terminated.exitCode === 0 ? "completed" : "failed";
      return "waiting";
    };
    const pvcNames = (pod.spec?.volumes ?? []).flatMap((volume) =>
      volume.persistentVolumeClaim?.claimName
        ? [volume.persistentVolumeClaim.claimName]
        : [],
    );
    const owner = pod.metadata?.ownerReferences?.find((reference) => reference.controller)
      ?? pod.metadata?.ownerReferences?.[0];

    return {
      id: resourceId(namespace, name),
      name,
      namespace,
      nodeName: pod.spec?.nodeName ?? null,
      phase: pod.status?.phase ?? "Unknown",
      ready:
        containerStatuses.length > 0 &&
        containerStatuses.every((container) => container.ready === true),
      restarts: containerStatuses.reduce(
        (total, container) => total + (container.restartCount ?? 0),
        0,
      ),
      owner: owner ? `${owner.kind}/${owner.name}` : null,
      createdAt: pod.metadata?.creationTimestamp?.toISOString() ?? null,
      pvcNames,
      projectId: projectIdFromResourceName(name),
      containers: [
        ...(pod.spec?.containers ?? []).map((container) => {
          const status = statusFor(container.name, false);
          return {
            name: container.name,
            role: "container" as const,
            state: stateFor(status),
            ready: status?.ready === true,
            restarts: status?.restartCount ?? 0,
          };
        }),
        ...(pod.spec?.initContainers ?? []).map((container) => {
          const status = statusFor(container.name, true);
          return {
            name: container.name,
            role:
              container.restartPolicy === "Always"
                ? ("sidecar" as const)
                : ("init" as const),
            state: stateFor(status),
            ready: status?.ready === true,
            restarts: status?.restartCount ?? 0,
          };
        }),
      ],
    };
  });

  return {
    namespace: NAMESPACE,
    observedAt: observedAt.toISOString(),
    nodes: resources.nodes.map((node) => {
      const labels = node.metadata?.labels ?? {};
      const capacity = node.status?.capacity ?? {};
      return {
        id: node.metadata?.name ?? "unknown-node",
        name: node.metadata?.name ?? "unknown-node",
        ready: node.status?.conditions?.some(
          (condition) => condition.type === "Ready" && condition.status === "True",
        ) ?? false,
        zone: labels["topology.kubernetes.io/zone"] ?? null,
        instanceType: labels["node.kubernetes.io/instance-type"] ?? null,
        capacity: {
          cpu: capacity.cpu ?? "—",
          memory: capacity.memory ?? "—",
          pods: capacity.pods ?? "—",
        },
      };
    }),
    pods,
    services: resources.services.map((service) => {
      const name = service.metadata?.name ?? "unknown-service";
      const namespace = service.metadata?.namespace ?? NAMESPACE;
      return {
        id: resourceId(namespace, name),
        name,
        namespace,
        type: service.spec?.type ?? "ClusterIP",
        clusterIP: service.spec?.clusterIP ?? null,
        ports: (service.spec?.ports ?? []).map((port) =>
          `${port.port}${port.protocol ? `/${port.protocol}` : ""}`,
        ),
        selectedPodIds: rawPods.flatMap((pod) => {
          const podName = pod.metadata?.name;
          const podNamespace = pod.metadata?.namespace ?? NAMESPACE;
          return podName && selectorMatches(service.spec?.selector, pod.metadata?.labels)
            ? [resourceId(podNamespace, podName)]
            : [];
        }),
        projectId: projectIdFromResourceName(name),
      };
    }),
    pvcs: resources.pvcs.map((pvc) => {
      const name = pvc.metadata?.name ?? "unknown-pvc";
      const namespace = pvc.metadata?.namespace ?? NAMESPACE;
      return {
        id: resourceId(namespace, name),
        name,
        namespace,
        phase: pvc.status?.phase ?? "Unknown",
        capacity: pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? null,
        accessModes: pvc.status?.accessModes ?? pvc.spec?.accessModes ?? [],
        volumeName: pvc.spec?.volumeName ?? null,
        mountedByPodIds: pods
          .filter((pod) => pod.namespace === namespace && pod.pvcNames.includes(name))
          .map((pod) => pod.id),
        projectId: projectIdFromResourceName(name),
      };
    }),
  };
}

// Return only topology metadata; never expose Secrets, environment values, logs, or annotations.
export async function getClusterTopology(): Promise<ClusterTopology> {
  const [nodeList, podList, serviceList, pvcList] = await Promise.all([
    k8sCoreApi.listNode({}),
    k8sCoreApi.listNamespacedPod({ namespace: NAMESPACE }),
    k8sCoreApi.listNamespacedService({ namespace: NAMESPACE }),
    k8sCoreApi.listNamespacedPersistentVolumeClaim({ namespace: NAMESPACE }),
  ]);

  return buildClusterTopology({
    nodes: nodeList.items,
    pods: podList.items,
    services: serviceList.items,
    pvcs: pvcList.items,
  });
}
