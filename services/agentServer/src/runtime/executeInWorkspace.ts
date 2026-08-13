import { CoreV1Api, Exec, KubeConfig } from "@kubernetes/client-node";
import { PassThrough } from "node:stream";
import { toRuntimeId } from "@sky/runtime-id";
import {
  AgentRunCancelledError,
  abortable,
  throwIfRunCancelled,
} from "./AgentRunRegistry";

type WorkspaceExecDependencies = {
  coreApi: Pick<CoreV1Api, "listNamespacedPod">;
  execClient: Pick<Exec, "exec">;
};

let dependencies: WorkspaceExecDependencies | undefined;

function getDependencies(): WorkspaceExecDependencies {
  if (dependencies) return dependencies;

  const kubeConfig = new KubeConfig();
  if (process.env["KUBERNETES_SERVICE_HOST"]) {
    kubeConfig.loadFromCluster();
  } else {
    kubeConfig.loadFromDefault();
  }

  dependencies = {
    coreApi: kubeConfig.makeApiClient(CoreV1Api),
    execClient: new Exec(kubeConfig),
  };
  return dependencies;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function executeInWorkspace(
  command: string,
  options: {
    databaseProjectId: string;
    namespace?: string;
    containerName?: string;
    workingDirectory?: string;
    signal?: AbortSignal;
  },
): Promise<{ output: string; exitCode: number }> {
  throwIfRunCancelled(options.signal);
  const runtimeId = toRuntimeId(options.databaseProjectId);
  const namespace = options.namespace ?? "default";
  const { coreApi, execClient } = getDependencies();
  const pods = await coreApi.listNamespacedPod({
    namespace,
    labelSelector: `app=${runtimeId}-workspace`,
  });
  const pod = pods.items.find(
    (candidate) => candidate.status?.phase === "Running",
  );

  if (!pod?.metadata?.name) {
    throw new Error("The project workspace pod is not running");
  }

  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

  let exitCode = 1;
  let settleStatus: (() => void) | undefined;
  const statusReceived = new Promise<void>((resolve) => {
    settleStatus = resolve;
  });
  const workingDirectory = options.workingDirectory ?? "/app/my-app";
  const socket = await execClient.exec(
    namespace,
    pod.metadata.name,
    options.containerName ?? "node",
    ["/bin/sh", "-lc", `cd ${shellQuote(workingDirectory)} && ${command}`],
    stdout,
    stderr,
    null,
    false,
    (status) => {
      exitCode = status.status === "Success" ? 0 : 1;
      settleStatus?.();
    },
  );

  const onAbort = () => socket.close();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await abortable(statusReceived, options.signal);
    throwIfRunCancelled(options.signal);
    return { output: Buffer.concat(chunks).toString("utf-8"), exitCode };
  } catch (error) {
    if (options.signal?.aborted) throw new AgentRunCancelledError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
