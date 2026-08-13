import { CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { toRuntimeId } from "@sky/runtime-id";
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
      `cd ${shellQuote(workingDirectory)} && ${command}`,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const output = Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).arrayBuffer(),
  ]);

  const onAbort = () => child.kill("SIGTERM");
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const exitCode = await abortable(child.exited, options.signal);
    throwIfRunCancelled(options.signal);
    const chunks = await output;
    return {
      output: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
        "utf-8",
      ),
      exitCode,
    };
  } catch (error) {
    if (options.signal?.aborted) throw new AgentRunCancelledError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}
