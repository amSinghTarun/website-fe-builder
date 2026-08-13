export type ToolActivityPhase = "started" | "completed" | "failed";

export type ToolActivity = {
  id: string;
  phase: ToolActivityPhase;
  summary: string;
};

function cleanPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\r\n\t]/g, " ").trim().slice(0, 100);
  return cleaned || null;
}

function commandPurpose(value: unknown): string {
  const command = typeof value === "string" ? value : "";
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b/i.test(command)) {
    return "frontend dependencies";
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/i.test(command)) {
    return "the production build";
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|lint)\b/i.test(command)) {
    return "project checks";
  }
  if (/\bgit\s+(?:status|diff|log)\b/i.test(command)) {
    return "workspace changes";
  }
  return "a workspace command";
}

export function summarizeToolCall(
  toolName: string,
  args: Record<string, unknown> | undefined,
  phase: ToolActivityPhase,
): string {
  const successful = phase === "completed";
  const failed = phase === "failed";
  const path = cleanPath(
    args?.filePath ??
      args?.fileCreatePath ??
      args?.fileDeletePath ??
      args?.directoryPath,
  );
  const target = path ? ` ${path}` : "";

  const summaries: Record<string, [string, string]> = {
    readDirectory: [`Inspecting project files${target}`, `Inspected project files${target}`],
    readFileContent: [`Reading${target || " a project file"}`, `Reviewed${target || " a project file"}`],
    readContextArtifact: ["Reviewing earlier implementation context", "Reviewed earlier implementation context"],
    createFile: [`Creating${target || " a frontend file"}`, `Created${target || " a frontend file"}`],
    updateFile: [`Updating${target || " a frontend file"}`, `Updated${target || " a frontend file"}`],
    deleteFile: [`Removing${target || " a frontend file"}`, `Removed${target || " a frontend file"}`],
    createTaskPlan: ["Planning the implementation steps", "Planned the implementation steps"],
    informCompletedTaskFromTaskPlan: ["Finishing an implementation step", "Finished an implementation step"],
    createSubAgent: ["Starting a focused implementation task", "Started a focused implementation task"],
    waitForSubAgent: ["Waiting for a focused implementation task", "Integrated a focused implementation task"],
    getCurrentWorkspace: ["Checking the project workspace", "Checked the project workspace"],
    takeUserInput: ["Preparing a question for you", "Prepared a question for you"],
  };

  if (toolName === "executeBash") {
    const purpose = commandPurpose(args?.fullCommand);
    if (failed) return `Could not finish ${purpose}`;
    return successful ? `Finished checking ${purpose}` : `Checking ${purpose}`;
  }

  const pair = summaries[toolName];
  if (failed) return pair ? `Could not finish: ${pair[0]}` : "A project tool could not finish";
  if (pair) return successful ? pair[1] : pair[0];
  return successful ? "Finished a project operation" : "Working on the project";
}
