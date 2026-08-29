import { toRuntimeId } from "@sky/common";

const projectsBaseUrl = (
  process.env.PROJECTS_BASE_URL?.trim() || "http://project.tarun.co"
).replace(/\/+$/, "");

export function projectRuntimeRoutes(databaseProjectId: string) {
  const runtimeId = toRuntimeId(databaseProjectId);
  const workspacePath = `/workspace/${runtimeId}/`;

  return {
    runtimeId,
    agentPath: `/agent/${runtimeId}`,
    workspacePath,
    workspaceUrl: `${projectsBaseUrl}${workspacePath}`,
  };
}

async function isReachable(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getProjectRuntimeStatus(databaseProjectId: string) {
  const routes = projectRuntimeRoutes(databaseProjectId);
  const [workspaceReady, agentReady] = await Promise.all([
    isReachable(
      `http://${routes.runtimeId}-workspace-service.default.svc.cluster.local:5173${routes.workspacePath}`,
      { headers: { Host: new URL(projectsBaseUrl).host } },
    ),
    isReachable(
      `http://${routes.runtimeId}-agent-service.default.svc.cluster.local:3000/health`,
    ),
  ]);

  return {
    ...routes,
    status:
      workspaceReady && agentReady ? ("ready" as const) : ("starting" as const),
    workspaceReady,
    agentReady,
  };
}
