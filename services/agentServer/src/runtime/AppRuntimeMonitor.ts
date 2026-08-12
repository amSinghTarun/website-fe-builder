import { createHash } from "node:crypto";
import { toRuntimeId } from "@sky/runtime-id";
import type {
  CoreV1Api,
  V1ContainerStatus,
  V1Pod,
} from "@kubernetes/client-node";

export type AppRuntimeStatus =
  | "provisioning"
  | "starting"
  | "running"
  | "unhealthy"
  | "crashed"
  | "not_found"
  | "unavailable";

export type RuntimeFailureScope =
  | "application"
  | "infrastructure"
  | "unknown";

export interface AppRuntimeRef {
  databaseProjectId: string;
  namespace: string;
  workspacePath: string;
  podLabelSelector: string;
  containerName: string;
  serviceName: string;
  servicePort: number;
  httpHost?: string;
  httpPath?: string;
}

export interface AppRuntimeState {
  status: AppRuntimeStatus;
  failureScope?: RuntimeFailureScope;
  repairableByAgent: boolean;
  podName?: string;
  podPhase?: string;
  containerReady?: boolean;
  restartCount?: number;
  reason?: string;
  exitCode?: number;
  signal?: number;
  httpStatus?: number;
  httpErrorBody?: string;
  logs?: string;
  observedAt: string;
  fingerprint?: string;
}

type RuntimeCoreApi = Pick<
  CoreV1Api,
  "listNamespacedPod" | "readNamespacedPod" | "readNamespacedPodLog"
>;

type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AppRuntimeMonitorOptions {
  coreApi: RuntimeCoreApi;
  fetchFn?: FetchFn;
  healthTimeoutMs?: number;
  maxHttpErrorBodyLength?: number;
}

const INFRASTRUCTURE_WAITING_REASONS = new Set([
  "CreateContainerConfigError",
  "CreateContainerError",
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
]);

const APPLICATION_CRASH_REASONS = new Set([
  "CrashLoopBackOff",
  "Error",
  "RunContainerError",
]);

export class AppRuntimeMonitor {
  private readonly coreApi: RuntimeCoreApi;
  private readonly fetchFn: FetchFn;
  private readonly healthTimeoutMs: number;
  private readonly maxHttpErrorBodyLength: number;
  private readonly previouslyRunning = new Set<string>();

  public constructor(options: AppRuntimeMonitorOptions) {
    this.coreApi = options.coreApi;
    this.fetchFn = options.fetchFn ?? fetch;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 3_000;
    this.maxHttpErrorBodyLength = options.maxHttpErrorBodyLength ?? 16_000;
  }

  public async getState(ref: AppRuntimeRef): Promise<AppRuntimeState> {
    const runtimeId = toRuntimeId(ref.databaseProjectId);

    try {
      const podName = await this.resolvePodName(ref);

      if (!podName) {
        return this.finalize({
          status: this.previouslyRunning.has(runtimeId)
            ? "not_found"
            : "provisioning",
          failureScope: "infrastructure",
          repairableByAgent: false,
          reason: this.previouslyRunning.has(runtimeId)
            ? "Workspace pod disappeared after it had been running"
            : "Workspace pod has not been created yet",
          observedAt: new Date().toISOString(),
        });
      }

      const pod = await this.coreApi.readNamespacedPod({
        name: podName,
        namespace: ref.namespace,
      });
      const podPhase = pod.status?.phase;
      const container = this.findContainerStatus(pod, ref.containerName);

      if (!container) {
        return this.finalize({
          status: "starting",
          failureScope: "unknown",
          repairableByAgent: false,
          podName,
          podPhase,
          reason: `Container ${ref.containerName} has no status yet`,
          observedAt: new Date().toISOString(),
        });
      }

      const base = {
        podName,
        podPhase,
        containerReady: container.ready ?? false,
        restartCount: container.restartCount ?? 0,
        observedAt: new Date().toISOString(),
      };
      const terminated = container.state?.terminated;

      if (terminated) {
        return this.finalize({
          ...base,
          status: "crashed",
          failureScope: "application",
          repairableByAgent: true,
          reason: terminated.reason ?? "Application container terminated",
          exitCode: terminated.exitCode,
          signal: terminated.signal,
          logs: await this.getBestCrashLogs(
            ref,
            podName,
            container.restartCount ?? 0,
          ),
        });
      }

      const waiting = container.state?.waiting;

      if (waiting) {
        const reason = waiting.reason ?? "Container waiting";

        if (INFRASTRUCTURE_WAITING_REASONS.has(reason)) {
          return this.finalize({
            ...base,
            status: "crashed",
            failureScope: "infrastructure",
            repairableByAgent: false,
            reason,
          });
        }

        if (APPLICATION_CRASH_REASONS.has(reason)) {
          const previousTermination = container.lastState?.terminated;
          return this.finalize({
            ...base,
            status: "crashed",
            failureScope: "application",
            repairableByAgent: true,
            reason: previousTermination?.reason ?? reason,
            exitCode: previousTermination?.exitCode,
            signal: previousTermination?.signal,
            logs: await this.getBestCrashLogs(
              ref,
              podName,
              container.restartCount ?? 0,
            ),
          });
        }

        return this.finalize({
          ...base,
          status: "starting",
          failureScope: "unknown",
          repairableByAgent: false,
          reason,
        });
      }

      if (podPhase !== "Running" || !container.state?.running) {
        return this.finalize({
          ...base,
          status: "starting",
          failureScope: "unknown",
          repairableByAgent: false,
          reason: `Pod phase is ${podPhase ?? "unknown"}`,
        });
      }

      if (!container.ready) {
        if (pod.status?.podIP) {
          const directHttpState = await this.checkHttp(ref, pod.status.podIP);

          if (
            !directHttpState.healthy &&
            directHttpState.status != null &&
            directHttpState.status >= 500
          ) {
            return this.finalize({
              ...base,
              status: "unhealthy",
              failureScope: "application",
              repairableByAgent: true,
              reason: directHttpState.reason,
              httpStatus: directHttpState.status,
              httpErrorBody: directHttpState.body,
              logs: await this.getCurrentLogsForPod(ref, podName),
            });
          }
        }

        return this.finalize({
          ...base,
          status: "starting",
          failureScope: "application",
          repairableByAgent: false,
          reason: "Application container has not become ready",
        });
      }

      const httpState = await this.checkHttp(ref);

      if (!httpState.healthy) {
        return this.finalize({
          ...base,
          status: "unhealthy",
          failureScope: "application",
          repairableByAgent: true,
          reason: httpState.reason,
          httpStatus: httpState.status,
          httpErrorBody: httpState.body,
          logs: await this.getCurrentLogsForPod(ref, podName),
        });
      }

      this.previouslyRunning.add(runtimeId);
      return this.finalize({
        ...base,
        status: "running",
        failureScope: "application",
        repairableByAgent: false,
        httpStatus: httpState.status,
      });
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return this.finalize({
          status: this.previouslyRunning.has(runtimeId)
            ? "not_found"
            : "provisioning",
          failureScope: "infrastructure",
          repairableByAgent: false,
          reason: "Workspace pod was not found",
          observedAt: new Date().toISOString(),
        });
      }

      return this.finalize({
        status: "unavailable",
        failureScope: "infrastructure",
        repairableByAgent: false,
        reason: this.errorMessage(error),
        observedAt: new Date().toISOString(),
      });
    }
  }

  public async waitForSettledState(
    ref: AppRuntimeRef,
    options?: {
      attempts?: number;
      initialDelayMs?: number;
      maxDelayMs?: number;
    },
  ): Promise<AppRuntimeState> {
    const attempts = Math.max(1, options?.attempts ?? 5);
    const initialDelayMs = Math.max(0, options?.initialDelayMs ?? 500);
    const maxDelayMs = Math.max(initialDelayMs, options?.maxDelayMs ?? 3_000);
    let lastState: AppRuntimeState | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      lastState = await this.getState(ref);

      if (
        lastState.status === "running" ||
        lastState.status === "crashed" ||
        lastState.status === "not_found" ||
        lastState.status === "unavailable"
      ) {
        return lastState;
      }

      if (attempt < attempts - 1) {
        const delayMs = Math.min(
          maxDelayMs,
          initialDelayMs * 2 ** attempt,
        );
        await this.sleep(delayMs);
      }
    }

    if (!lastState) {
      return this.finalize({
        status: "unavailable",
        failureScope: "unknown",
        repairableByAgent: false,
        reason: "No runtime observation was produced",
        observedAt: new Date().toISOString(),
      });
    }

    if (
      lastState.status === "starting" &&
      lastState.podPhase === "Running"
    ) {
      return this.finalize({
        ...lastState,
        status: "unhealthy",
        failureScope: "application",
        repairableByAgent: true,
        reason: "Application failed to become ready after the retry window",
        logs:
          lastState.logs ??
          (await this.getCurrentLogs(ref)),
        observedAt: new Date().toISOString(),
      });
    }

    return lastState;
  }

  public async getCurrentLogs(
    ref: AppRuntimeRef,
    tailLines = 100,
  ): Promise<string> {
    const podName = await this.resolvePodName(ref);
    if (!podName) return "[Workspace pod not found]";
    return this.getCurrentLogsForPod(ref, podName, tailLines);
  }

  public async getPreviousLogs(
    ref: AppRuntimeRef,
    tailLines = 100,
  ): Promise<string> {
    const podName = await this.resolvePodName(ref);
    if (!podName) return "[Workspace pod not found]";
    return this.getPreviousLogsForPod(ref, podName, tailLines);
  }

  private async resolvePodName(ref: AppRuntimeRef): Promise<string | undefined> {
    const result = await this.coreApi.listNamespacedPod({
      namespace: ref.namespace,
      labelSelector: ref.podLabelSelector,
    });
    const activePods = result.items.filter(
      (pod) =>
        pod.metadata?.deletionTimestamp == null &&
        pod.status?.phase !== "Succeeded" &&
        pod.status?.phase !== "Failed" &&
        pod.metadata?.name,
    );
    activePods.sort(
      (left, right) =>
        this.creationTime(right) - this.creationTime(left),
    );
    return activePods[0]?.metadata?.name;
  }

  private creationTime(pod: V1Pod): number {
    const value = pod.metadata?.creationTimestamp;
    return value ? new Date(value).getTime() : 0;
  }

  private findContainerStatus(
    pod: V1Pod,
    containerName: string,
  ): V1ContainerStatus | undefined {
    return pod.status?.containerStatuses?.find(
      (container) => container.name === containerName,
    );
  }

  private async checkHttp(ref: AppRuntimeRef, podIP?: string): Promise<{
    healthy: boolean;
    status?: number;
    body?: string;
    reason?: string;
  }> {
    const host = podIP
      ? podIP.includes(":")
        ? `[${podIP}]`
        : podIP
      : `${ref.serviceName}.${ref.namespace}.svc.cluster.local`;
    const httpPath = ref.httpPath?.startsWith("/")
      ? ref.httpPath
      : `/${ref.httpPath ?? ""}`;
    const url = `http://${host}:${ref.servicePort}${httpPath}`;

    try {
      const response = await this.fetchFn(url, {
        headers: ref.httpHost ? { Host: ref.httpHost } : undefined,
        signal: AbortSignal.timeout(this.healthTimeoutMs),
      });

      if (response.status < 500) {
        return { healthy: true, status: response.status };
      }

      const body = (await response.text()).slice(
        0,
        this.maxHttpErrorBodyLength,
      );
      return {
        healthy: false,
        status: response.status,
        body,
        reason: `Application returned HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        reason: `Application did not respond: ${this.errorMessage(error)}`,
      };
    }
  }

  private async getBestCrashLogs(
    ref: AppRuntimeRef,
    podName: string,
    restartCount: number,
  ): Promise<string> {
    if (restartCount > 0) {
      const previous = await this.getPreviousLogsForPod(ref, podName);
      if (previous && !previous.startsWith("[Unable to read")) return previous;
    }
    return this.getCurrentLogsForPod(ref, podName);
  }

  private async getCurrentLogsForPod(
    ref: AppRuntimeRef,
    podName: string,
    tailLines = 100,
  ): Promise<string> {
    return this.readLogs(ref, podName, tailLines, false);
  }

  private async getPreviousLogsForPod(
    ref: AppRuntimeRef,
    podName: string,
    tailLines = 100,
  ): Promise<string> {
    return this.readLogs(ref, podName, tailLines, true);
  }

  private async readLogs(
    ref: AppRuntimeRef,
    podName: string,
    tailLines: number,
    previous: boolean,
  ): Promise<string> {
    try {
      return (
        (await this.coreApi.readNamespacedPodLog({
          name: podName,
          namespace: ref.namespace,
          container: ref.containerName,
          previous,
          tailLines,
          timestamps: true,
        })) || ""
      );
    } catch (error) {
      return `[Unable to read ${previous ? "previous" : "current"} application logs: ${this.errorMessage(error)}]`;
    }
  }

  private finalize(state: AppRuntimeState): AppRuntimeState {
    if (state.status === "running") return state;

    const fingerprintSource = JSON.stringify({
      status: state.status,
      scope: state.failureScope,
      reason: state.reason,
      exitCode: state.exitCode,
      httpStatus: state.httpStatus,
      httpErrorBody: state.httpErrorBody?.slice(-4_000),
      logs: this.stableLogExcerpt(state.logs),
    });

    return {
      ...state,
      fingerprint: createHash("sha256")
        .update(fingerprintSource)
        .digest("hex")
        .slice(0, 16),
    };
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const value = error as {
      code?: number;
      statusCode?: number;
      response?: { status?: number; statusCode?: number };
    };
    return (
      value.code === 404 ||
      value.statusCode === 404 ||
      value.response?.status === 404 ||
      value.response?.statusCode === 404
    );
  }

  private stableLogExcerpt(logs: string | undefined): string | undefined {
    if (!logs) return undefined;
    const normalized = logs
      .split("\n")
      .map((line) =>
        line.replace(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/,
          "",
        ),
      )
      .filter(Boolean);
    return normalized.slice(-20).join("\n").slice(-4_000);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
