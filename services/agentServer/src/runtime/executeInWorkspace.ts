import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { toRuntimeId } from "@sky/common";
import {
  AgentRunCancelledError,
  abortable,
  throwIfRunCancelled,
} from "./AgentRunRegistry";

type WorkspaceExecDependencies = {
  coreApi: Pick<CoreV1Api, "listNamespacedPod">;
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
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ output: string; exitCode: number }> {
  throwIfRunCancelled(options.signal);
  const runtimeId = toRuntimeId(options.databaseProjectId);
  const namespace = options.namespace ?? "default";
  const { coreApi } = getDependencies();
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

  const workingDirectory = options.workingDirectory ?? "/app/my-app";
  const configuredTimeoutMs = Number(
    process.env["WORKSPACE_COMMAND_TIMEOUT_MS"] ?? "60000",
  );
  const timeoutMs = Math.max(
    1_000,
    options.timeoutMs ??
      (Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : 60_000),
  );
  const timeoutSeconds = Math.ceil(timeoutMs / 1_000);
  const child = Bun.spawn(
    [
      "kubectl",
      "exec",
      "--namespace",
      namespace,
      pod.metadata.name,
      "--container",
      options.containerName ?? "node",
      "--",
      "/bin/sh",
      "-lc",
      `cd ${shellQuote(workingDirectory)} && timeout -s TERM ${timeoutSeconds}s /bin/sh -lc ${shellQuote(command)}`,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const output = Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ]);

  let commandTimedOut = false;
  const killTimer = setTimeout(() => {
    commandTimedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs + 5_000);
  const onAbort = () => child.kill("SIGTERM");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const exitCode = await abortable(child.exited, options.signal);
    throwIfRunCancelled(options.signal);
    const chunks = await output;
    const commandOutput = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
    ).toString("utf-8");
    const didTimeOut = commandTimedOut || exitCode === 124;
    return {
      output: didTimeOut
        ? `${commandOutput}\nCommand timed out after ${timeoutSeconds} seconds.`.trim()
        : commandOutput,
      exitCode: didTimeOut ? 124 : exitCode,
    };
  } catch (error) {
    if (options.signal?.aborted) throw new AgentRunCancelledError();
    throw error;
  } finally {
    clearTimeout(killTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
