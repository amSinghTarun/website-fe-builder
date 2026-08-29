import type { AppRuntimeState } from "../runtime";
import { formatRuntimeObservation } from "../runtime";
import type { SubAgentResult } from "../subAgents/registry";
import { summarizeToolActivity } from "../toolActivity";
import type { AgentTool, ToolActivityPhase, ToolResult } from "../types/tools";

export type AgentChunk = {
  type: string;
  response: unknown;
  uuid?: string;
};

export type PlanTask = { id: string; task: string };

type RuntimeRepairDecision =
  | { action: "none" }
  | { action: "retry"; message: string }
  | { action: "blocked"; message: string };

// Emit one transient activity update for the frontend while a tool runs.
export function emitToolActivity(
  id: string,
  tool: AgentTool<any> | undefined,
  toolArgs: Record<string, unknown> | undefined,
  phase: ToolActivityPhase,
  onChunk?: (chunk: AgentChunk) => void,
): void {
  onChunk?.({
    type: "toolActivity",
    response: {
      id,
      phase,
      summary: summarizeToolActivity(tool, toolArgs, phase),
    },
  });
}

// Normalize model-generated plan items and explain any rejected entries.
function parsePlanTasks(value: unknown): {
  tasks: PlanTask[];
  rejected: string[];
} {
  if (!Array.isArray(value)) {
    return { tasks: [], rejected: ["taskList (expected an array)"] };
  }
  if (value.length === 0) {
    return { tasks: [], rejected: ["taskList (empty)"] };
  }

  const tasks: PlanTask[] = [];
  const rejected: string[] = [];

  for (const [index, entry] of value.entries()) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    const task = typeof entry?.task === "string" ? entry.task.trim() : "";
    if (id && task) {
      tasks.push({ id, task });
      continue;
    }

    const invalidFields = [!id && "ID", !task && "task"]
      .filter(Boolean)
      .join(" and ");
    rejected.push(`${id || `item ${index + 1}`} (invalid ${invalidFields})`);
  }

  return { tasks, rejected };
}

// Keep the run-local plan state aligned with task-plan tool calls.
export function applyTaskPlanToolCall(args: {
  toolName: string;
  toolArgs: Record<string, unknown> | undefined;
  output: ToolResult;
  activeTaskPlan: Map<string, PlanTask>;
  completedTaskIds: Set<string>;
}): void {
  if (
    args.toolName === "createTaskPlan" ||
    args.toolName === "addTasksToPlan"
  ) {
    const { tasks, rejected } = parsePlanTasks(args.toolArgs?.taskList);
    const planAlreadyExists = args.activeTaskPlan.size > 0;
    const skippedTasks = [...rejected];
    const appendedTasks: PlanTask[] = [];

    if (args.toolName === "addTasksToPlan" && !planAlreadyExists) {
      args.output.response =
        "No task plan exists yet. Call createTaskPlan first.";
      delete args.output.yield;
      return;
    }

    for (const task of tasks) {
      if (args.activeTaskPlan.has(task.id)) {
        skippedTasks.push(`${task.id} (duplicate ID)`);
        continue;
      }
      args.activeTaskPlan.set(task.id, task);
      appendedTasks.push(task);
    }

    if (appendedTasks.length === 0) {
      args.output.response = `No tasks added. Skipped: ${skippedTasks.join(", ")}.`;
      delete args.output.yield;
      return;
    }

    args.output.response = `Added: ${appendedTasks.map((task) => task.id).join(", ")}.${
      skippedTasks.length ? ` Skipped: ${skippedTasks.join(", ")}.` : ""
    }`;
    args.output.yield = {
      type: planAlreadyExists ? "planAppend" : "plan",
      response: appendedTasks,
    };
    return;
  }

  if (args.toolName !== "informCompletedTaskFromTaskPlan") return;
  const completedId = args.toolArgs?.id;
  if (typeof completedId === "string" && args.activeTaskPlan.has(completedId)) {
    args.completedTaskIds.add(completedId);
    return;
  }

  args.output.response = "That task ID does not exist in the active plan.";
  delete args.output.yield;
}

// Format delegated results as one compact internal message for Gemini.
export function delegatedResultsMessage(
  results: SubAgentResult[],
  waitedForOutstanding: boolean,
): string {
  const introduction = waitedForOutstanding
    ? "Your outstanding delegated work has now been collected automatically. Review these results before continuing or completing the request:"
    : "Delegated work completed while you were working. Review these results now:";
  return `${introduction}\n${JSON.stringify(results)}`;
}

// A successful merge means the parent workspace and runtime may have changed.
export function delegatedResultsChangedWorkspace(
  results: SubAgentResult[],
): boolean {
  return results.some((result) => result.status === "MERGED");
}

// Decide whether the same repairable runtime failure should retry or stop.
export function evaluateRuntimeRepair(
  runtimeState: AppRuntimeState | undefined,
  attemptsByFingerprint: Map<string, number>,
): RuntimeRepairDecision {
  if (!runtimeState) return { action: "none" };
  if (runtimeState.status === "running") {
    attemptsByFingerprint.clear();
    return { action: "none" };
  }
  if (!runtimeState.repairableByAgent) return { action: "none" };

  const fingerprint = runtimeState.fingerprint ?? "unknown";
  const attempts = (attemptsByFingerprint.get(fingerprint) ?? 0) + 1;
  attemptsByFingerprint.set(fingerprint, attempts);

  if (attempts <= 3) {
    return {
      action: "retry",
      message: `${formatRuntimeObservation(runtimeState)}\n\nThe task cannot complete until this repairable application failure is resolved. Continue working.`,
    };
  }

  return {
    action: "blocked",
    message:
      "The generated application remains unhealthy after three automatic repair attempts.",
  };
}
