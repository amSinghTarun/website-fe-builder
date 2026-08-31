import { describe, expect, test } from "bun:test";
import type {
  V1Node,
  V1PersistentVolumeClaim,
  V1Pod,
  V1Service,
} from "@kubernetes/client-node";
import { buildClusterTopology } from "./clusterTopology";

describe("buildClusterTopology", () => {
  test("connects services and PVCs to their pods without exposing raw manifests", () => {
    const pod = {
      metadata: {
        name: "sky-12345678-1234-1234-1234-123456789abc-workspace-abc",
        namespace: "default",
        labels: { app: "demo-workspace" },
        ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "demo-rs", uid: "1", controller: true }],
      },
      spec: {
        nodeName: "node-a",
        containers: [{ name: "workspace", image: "private/image:tag" }],
        volumes: [{ name: "source", persistentVolumeClaim: { claimName: "sky-12345678-1234-1234-1234-123456789abc-pvc" } }],
      },
      status: {
        phase: "Running",
        containerStatuses: [{ name: "workspace", image: "private/image:tag", imageID: "image", ready: true, restartCount: 2, started: true, state: {} }],
      },
    } as V1Pod;
    const service = {
      metadata: { name: "sky-12345678-1234-1234-1234-123456789abc-workspace-service", namespace: "default" },
      spec: { selector: { app: "demo-workspace" }, type: "ClusterIP", ports: [{ port: 5173 }] },
    } as V1Service;
    const pvc = {
      metadata: { name: "sky-12345678-1234-1234-1234-123456789abc-pvc", namespace: "default" },
      spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "5Gi" } } },
      status: { phase: "Bound", capacity: { storage: "5Gi" } },
    } as V1PersistentVolumeClaim;
    const node = {
      metadata: { name: "node-a", labels: { "topology.kubernetes.io/zone": "zone-a" } },
      status: {
        capacity: { cpu: "4", memory: "16Gi", pods: "32" },
        conditions: [{ type: "Ready", status: "True", lastHeartbeatTime: new Date(), lastTransitionTime: new Date() }],
      },
    } as V1Node;

    const result = buildClusterTopology(
      { nodes: [node], pods: [pod], services: [service], pvcs: [pvc] },
      new Date("2026-08-30T12:00:00.000Z"),
    );

    expect(result.nodes[0]?.ready).toBe(true);
    expect(result.pods[0]).toMatchObject({
      nodeName: "node-a",
      ready: true,
      restarts: 2,
      projectId: "12345678-1234-1234-1234-123456789abc",
      pvcNames: ["sky-12345678-1234-1234-1234-123456789abc-pvc"],
      containers: [
        { name: "workspace", role: "container", state: "ready", ready: true, restarts: 2 },
      ],
    });
    expect(result.services[0]?.selectedPodIds).toEqual(["default/sky-12345678-1234-1234-1234-123456789abc-workspace-abc"]);
    expect(result.services[0]?.projectId).toBe("12345678-1234-1234-1234-123456789abc");
    expect(result.pvcs[0]?.mountedByPodIds).toEqual(["default/sky-12345678-1234-1234-1234-123456789abc-workspace-abc"]);
    expect(result.pvcs[0]?.projectId).toBe("12345678-1234-1234-1234-123456789abc");
    expect(JSON.stringify(result)).not.toContain("private/image:tag");
  });

  test("identifies restartable init containers as sidecars", () => {
    const pod = {
      metadata: { name: "sky-12345678-1234-1234-1234-123456789abc-agent-pod" },
      spec: {
        containers: [{ name: "agent" }],
        initContainers: [
          { name: "recovery-cron", restartPolicy: "Always" },
          { name: "wait-for-workspace" },
        ],
      },
      status: {
        containerStatuses: [{ name: "agent", ready: true, restartCount: 0 }],
        initContainerStatuses: [
          { name: "recovery-cron", ready: true, restartCount: 1, state: { running: {} } },
          { name: "wait-for-workspace", ready: false, restartCount: 0, state: { terminated: { exitCode: 0 } } },
        ],
      },
    } as V1Pod;

    const result = buildClusterTopology({
      nodes: [],
      pods: [pod],
      services: [],
      pvcs: [],
    });

    expect(result.pods[0]?.containers).toEqual([
      { name: "agent", role: "container", state: "ready", ready: true, restarts: 0 },
      { name: "recovery-cron", role: "sidecar", state: "ready", ready: true, restarts: 1 },
      { name: "wait-for-workspace", role: "init", state: "completed", ready: false, restarts: 0 },
    ]);
  });

  test("does not connect a selector-less service to every pod", () => {
    const result = buildClusterTopology({
      nodes: [],
      pods: [{ metadata: { name: "pod-a", namespace: "default", labels: { app: "a" } } } as V1Pod],
      services: [{ metadata: { name: "external", namespace: "default" }, spec: {} } as V1Service],
      pvcs: [],
    });

    expect(result.services[0]?.selectedPodIds).toEqual([]);
  });
});
