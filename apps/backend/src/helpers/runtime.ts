import { toRuntimeId } from "@sky/runtime-id";

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

type RuntimeFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

async function isReachable(
  url: string,
  fetcher: RuntimeFetcher,
): Promise<boolean> {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getProjectRuntimeStatus(
  databaseProjectId: string,
  fetcher: RuntimeFetcher = fetch,
) {
  const routes = projectRuntimeRoutes(databaseProjectId);
  const [workspaceReady, agentReady] = await Promise.all([
    isReachable(
      `http://${routes.runtimeId}-workspace-service.default.svc.cluster.local:5173${routes.workspacePath}`,
      fetcher,
    ),
    isReachable(
      `http://${routes.runtimeId}-agent-service.default.svc.cluster.local:3000/health`,
      fetcher,
    ),
  ]);

  return {
    ...routes,
    status: workspaceReady && agentReady ? ("ready" as const) : ("starting" as const),
    workspaceReady,
    agentReady,
  };
}
