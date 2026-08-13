import { createHash } from "node:crypto";
import type { AppRuntimeState } from "./AppRuntimeMonitor";
import { executeInWorkspace } from "./executeInWorkspace";

type WorkspaceExecutor = typeof executeInWorkspace;

export async function validateFrontendBuild(
  options: {
    databaseProjectId: string;
    namespace: string;
    containerName: string;
    workingDirectory: string;
    signal?: AbortSignal;
  },
  executor: WorkspaceExecutor = executeInWorkspace,
): Promise<AppRuntimeState | undefined> {
  const result = await executor("npm run build", options);
  if (result.exitCode === 0) return undefined;

  const logs = result.output.slice(-16_000);
  return {
    status: "unhealthy",
    failureScope: "application",
    repairableByAgent: true,
    reason: `Frontend build failed with exit code ${result.exitCode}`,
    logs,
    observedAt: new Date().toISOString(),
    fingerprint: createHash("sha256")
      .update(`frontend-build:${result.exitCode}:${logs}`)
      .digest("hex"),
  };
}
