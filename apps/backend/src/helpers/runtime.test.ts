import { describe, expect, test } from "bun:test";
import {
  getProjectRuntimeStatus,
  projectRuntimeRoutes,
} from "./runtime";

const databaseProjectId = "83517414-5313-418a-9547-5bbabc7a5cfd";

describe("project runtime", () => {
  test("derives the public routes from the database project ID", () => {
    const routes = projectRuntimeRoutes(databaseProjectId);

    expect(routes.runtimeId).toBe("sky-83517414-5313-418a-9547-5bbabc7a5cfd");
    expect(routes.workspacePath).toBe(
      "/workspace/sky-83517414-5313-418a-9547-5bbabc7a5cfd/",
    );
    expect(routes.workspaceUrl).toBe(
      "http://project.tarun.co/workspace/sky-83517414-5313-418a-9547-5bbabc7a5cfd/",
    );
  });

  test("reports ready only after both workspace and agent answer successfully", async () => {
    const calls: string[] = [];
    const requestHeaders: Array<RequestInit["headers"]> = [];
    const fetcher = async (input: string, init?: RequestInit) => {
      calls.push(String(input));
      requestHeaders.push(init?.headers);
      return new Response(null, {
        status: String(input).includes("workspace-service") ? 200 : 503,
      });
    };

    const starting = await getProjectRuntimeStatus(databaseProjectId, fetcher);
    expect(starting.status).toBe("starting");
    expect(starting.workspaceReady).toBe(true);
    expect(starting.agentReady).toBe(false);
    expect(calls).toHaveLength(2);
    expect(requestHeaders[0]).toEqual({ Host: "project.tarun.co" });

    const ready = await getProjectRuntimeStatus(
      databaseProjectId,
      async () => new Response(null, { status: 200 }),
    );
    expect(ready.status).toBe("ready");
  });
});
