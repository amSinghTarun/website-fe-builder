import type { FunctionDeclaration } from "@google/genai";

export enum Tools {
  CREATE_SUB_AGENT,
  WAITING_FOR_SUB_AGENT,
  GET_CURRENT_WORKSPACE,
  EXECUTE_BASH,
  READ_DIR,
  READ_FILE,
  CREATE_FILE,
  DELETE_FILE,
  UPDATE_FILE,
  READ_CONTEXT_ARTIFACT,
  TAKE_INPUT,
  CREATE_PLAN,
  INFORM_TASK_COMPLETION,
}

export interface ToolContext {
  cwd: string;
}

export interface ToolEffects {
  workspaceChanged?: boolean;
  runtimeMayChange?: boolean;
}

export interface ToolYield {
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

export interface AgentTool<TArgs = Record<string, unknown>> {
  identifier: Tools;
  declaration: FunctionDeclaration;
  executable: (
    args: TArgs,
    context: ToolContext,
  ) => ToolResult | Promise<ToolResult>;
}

export function normalizeToolResult(result: unknown): ToolResult {
  if (result && typeof result === "object" && "response" in result) {
    return result as ToolResult;
  }

  if (Buffer.isBuffer(result)) {
    return { response: result.toString("utf-8") };
  }

  return { response: result == null ? "" : String(result) };
}
