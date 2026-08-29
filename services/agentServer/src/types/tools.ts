import type { FunctionDeclaration } from "@google/genai";

export interface ToolContext {
  cwd: string;
  databaseProjectId: string;
  agentRunId: string;
  signal?: AbortSignal;
}

interface ToolEffects {
  workspaceChanged?: boolean;
  runtimeMayChange?: boolean;
}

interface ToolYield {
  type: string;
  response: unknown;
  resolver?: Promise<unknown>;
  uuid?: string;
}

export interface ToolResult {
  response: unknown;
  yield?: ToolYield;
  effects?: ToolEffects;
  workspacePath?: string;
  branchName?: string;
}

export type ToolActivityPhase = "started" | "completed" | "failed";

type ToolActivityText<TArgs> = string | ((args: TArgs) => string);

interface ToolActivity<TArgs> {
  started: ToolActivityText<TArgs>;
  completed: ToolActivityText<TArgs>;
}

export interface AgentTool<TArgs = Record<string, unknown>> {
  declaration: FunctionDeclaration;
  activity: ToolActivity<TArgs>;
  executable: (
    args: TArgs,
    context: ToolContext,
  ) => ToolResult | Promise<ToolResult>;
}
