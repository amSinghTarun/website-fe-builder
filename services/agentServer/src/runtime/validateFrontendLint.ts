import { createHash } from "node:crypto";
import type { AppRuntimeState } from "./AppRuntimeMonitor";
import { executeInWorkspace } from "./executeInWorkspace";

type WorkspaceExecutor = typeof executeInWorkspace;

export async function validateFrontendLint(
  options: {
    databaseProjectId: string;
    namespace: string;
    containerName: string;
    workingDirectory: string;
    signal?: AbortSignal;
  },
  executor: WorkspaceExecutor = executeInWorkspace,
): Promise<AppRuntimeState | undefined> {
  const script = await executor(
    `node -p "require('./package.json').scripts?.lint || ''"`,
    options,
  );
  if (script.exitCode !== 0 || !script.output.trim()) return undefined;

  const lintCommand = script.output.includes("oxlint")
    ? "npm run lint -- --deny-warnings"
    : script.output.includes("eslint")
      ? "npm run lint -- --max-warnings=0"
      : "npm run lint";
  const result = await executor(lintCommand, options);
  if (result.exitCode === 0) return undefined;

  const logs = result.output.slice(-16_000);
  return {
    status: "unhealthy",
    failureScope: "application",
    repairableByAgent: true,
    reason: `Frontend lint failed with exit code ${result.exitCode}`,
    logs,
    observedAt: new Date().toISOString(),
    fingerprint: createHash("sha256")
      .update(`frontend-lint:${result.exitCode}:${logs}`)
      .digest("hex"),
  };
}
