import { describe, expect, test } from "bun:test";
import type { CoreV1Api, V1Pod } from "@kubernetes/client-node";
import { AppRuntimeMonitor, type AppRuntimeRef } from "./AppRuntimeMonitor";

const runtimeRef: AppRuntimeRef = {
  databaseProjectId: "database-id",
  namespace: "default",
  workspacePath: "/user-app/my-app",
  podLabelSelector: "app=sky-database-id-workspace",
  containerName: "node",
  serviceName: "sky-database-id-workspace-service",
  servicePort: 5173,
};

function podWithContainer(
  state: NonNullable<
    NonNullable<V1Pod["status"]>["containerStatuses"]
  >[number]["state"],
  options?: {
    ready?: boolean;
    restartCount?: number;
    lastState?: NonNullable<
      NonNullable<V1Pod["status"]>["containerStatuses"]
    >[number]["lastState"];
  },
): V1Pod {
  return {
    metadata: {
      name: "workspace-pod",
      creationTimestamp: new Date(),
    },
    status: {
      phase: "Running",
      podIP: "10.0.0.10",
      containerStatuses: [
        {
          name: "node",
          image: "node:lts-alpine",
          imageID: "node-image",
          ready: options?.ready ?? false,
          restartCount: options?.restartCount ?? 0,
          state,
          lastState: options?.lastState,
        },
      ],
    },
  };
}

function createMonitor(options: {
  pods?: V1Pod[];
  currentLogs?: string;
  previousLogs?: string;
  httpStatus?: number;
  httpBody?: string;
  listError?: Error;
}) {
  const pods = options.pods ?? [];
  let readIndex = 0;
  const coreApi = {
    listNamespacedPod: async () => {
      if (options.listError) throw options.listError;
      return { items: pods.length ? [pods[0]!] : [] };
    },
    readNamespacedPod: async () =>
      pods[Math.min(readIndex++, pods.length - 1)]!,
    readNamespacedPodLog: async (request: { previous?: boolean }) =>
      request.previous
        ? (options.previousLogs ?? "")
        : (options.currentLogs ?? ""),
  } as unknown as CoreV1Api;

  return new AppRuntimeMonitor({
    coreApi,
    fetchFn: async () =>
      new Response(options.httpBody ?? "", {
        status: options.httpStatus ?? 200,
      }),
  });
}

describe("AppRuntimeMonitor", () => {
  test("reports a ready pod with a responding HTTP app as running", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer(
          { running: { startedAt: new Date() } },
          { ready: true },
        ),
      ],
    });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "running",
      repairableByAgent: false,
      httpStatus: 200,
    });
  });

  test("waits through a transient reload", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer({ running: { startedAt: new Date() } }),
        podWithContainer(
          { running: { startedAt: new Date() } },
          { ready: true },
        ),
      ],
    });

    expect(
      await monitor.waitForSettledState(runtimeRef, {
        attempts: 2,
        initialDelayMs: 0,
      }),
    ).toMatchObject({ status: "running" });
  });

  test("returns HTTP diagnostics and logs for an unhealthy app", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer(
          { running: { startedAt: new Date() } },
          { ready: true },
        ),
      ],
      httpStatus: 500,
      httpBody: "Vite compilation error",
      currentLogs: "Failed to compile App.tsx",
    });

    expect(
      await monitor.waitForSettledState(runtimeRef, {
        attempts: 1,
      }),
    ).toMatchObject({
      status: "unhealthy",
      repairableByAgent: true,
      httpStatus: 500,
      httpErrorBody: "Vite compilation error",
      logs: "Failed to compile App.tsx",
    });
  });

  test("reads a Vite 500 directly from a pod removed from Service endpoints", async () => {
    const monitor = createMonitor({
      pods: [podWithContainer({ running: { startedAt: new Date() } })],
      httpStatus: 500,
      httpBody: "Syntax error in App.tsx",
      currentLogs: "hmr update failed",
    });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "unhealthy",
      containerReady: false,
      httpStatus: 500,
      httpErrorBody: "Syntax error in App.tsx",
      logs: "hmr update failed",
    });
  });

  test("uses previous logs for CrashLoopBackOff", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer(
          { waiting: { reason: "CrashLoopBackOff" } },
          {
            restartCount: 2,
            lastState: {
              terminated: {
                containerID: "container-id",
                exitCode: 1,
                finishedAt: new Date(),
                reason: "Error",
                startedAt: new Date(),
              },
            },
          },
        ),
      ],
      currentLogs: "new process",
      previousLogs: "actual crash stack",
    });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "crashed",
      failureScope: "application",
      repairableByAgent: true,
      exitCode: 1,
      logs: "actual crash stack",
    });
  });

  test("does not ask the coding agent to repair image failures", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer({ waiting: { reason: "ImagePullBackOff" } }),
      ],
    });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "crashed",
      failureScope: "infrastructure",
      repairableByAgent: false,
      reason: "ImagePullBackOff",
    });
  });

  test("keeps OOM termination evidence even without useful logs", async () => {
    const monitor = createMonitor({
      pods: [
        podWithContainer({
          terminated: {
            containerID: "container-id",
            exitCode: 137,
            finishedAt: new Date(),
            reason: "OOMKilled",
            startedAt: new Date(),
          },
        }),
      ],
      currentLogs: "",
    });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "crashed",
      reason: "OOMKilled",
      exitCode: 137,
      repairableByAgent: true,
    });
  });

  test("turns Kubernetes API errors into an unavailable state", async () => {
    const monitor = createMonitor({ listError: new Error("RBAC denied") });

    expect(await monitor.getState(runtimeRef)).toMatchObject({
      status: "unavailable",
      failureScope: "infrastructure",
      repairableByAgent: false,
      reason: "RBAC denied",
    });
  });

  test("keeps fingerprints stable when only Kubernetes log timestamps differ", async () => {
    const pods = [
      podWithContainer(
        { waiting: { reason: "CrashLoopBackOff" } },
        { restartCount: 1 },
      ),
    ];
    const first = createMonitor({
      pods,
      previousLogs: "2026-08-09T10:00:00.000Z TypeError: broken",
    });
    const second = createMonitor({
      pods,
      previousLogs: "2026-08-09T10:00:10.000Z TypeError: broken",
    });

    expect((await first.getState(runtimeRef)).fingerprint).toBe(
      (await second.getState(runtimeRef)).fingerprint,
    );
  });
});
