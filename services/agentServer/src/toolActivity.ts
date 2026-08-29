import type { AgentTool, ToolActivityPhase } from "./types/tools";

export function activityTarget(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim().replace(/\s+/g, " ").slice(0, 100) || fallback;
}

export function summarizeToolActivity(
  tool: AgentTool<any> | undefined,
  args: Record<string, unknown> | undefined,
  phase: ToolActivityPhase,
): string {
  if (!tool) {
    return phase === "failed"
      ? "A project tool could not finish"
      : "Working on the project";
  }

  const activity =
    phase === "completed" ? tool.activity.completed : tool.activity.started;
  const summary =
    typeof activity === "function" ? activity(args ?? {}) : activity;

  return phase === "failed" ? `Could not finish — ${summary}` : summary;
}
