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
        name: "demo-workspace-abc",
        namespace: "default",
        labels: { app: "demo-workspace" },
        ownerReferences: [{ apiVersion: "apps/v1", kind: "ReplicaSet", name: "demo-rs", uid: "1", controller: true }],
      },
      spec: {
        nodeName: "node-a",
        containers: [{ name: "workspace", image: "private/image:tag" }],
        volumes: [{ name: "source", persistentVolumeClaim: { claimName: "demo-pvc" } }],
      },
      status: {
        phase: "Running",
        containerStatuses: [{ name: "workspace", image: "private/image:tag", imageID: "image", ready: true, restartCount: 2, started: true, state: {} }],
      },
    } as V1Pod;
    const service = {
      metadata: { name: "demo-service", namespace: "default" },
      spec: { selector: { app: "demo-workspace" }, type: "ClusterIP", ports: [{ port: 5173 }] },
    } as V1Service;
    const pvc = {
      metadata: { name: "demo-pvc", namespace: "default" },
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
    expect(result.pods[0]).toMatchObject({ nodeName: "node-a", ready: true, restarts: 2, pvcNames: ["demo-pvc"] });
    expect(result.services[0]?.selectedPodIds).toEqual(["default/demo-workspace-abc"]);
    expect(result.pvcs[0]?.mountedByPodIds).toEqual(["default/demo-workspace-abc"]);
    expect(JSON.stringify(result)).not.toContain("private/image:tag");
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
