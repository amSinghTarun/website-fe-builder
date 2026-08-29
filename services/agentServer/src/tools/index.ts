import { inputTools } from "./input";
import { bashTool } from "./bash";
import { fileTools } from "./file";
import { taskTool } from "./task";
import { agentTool } from "./agent";
import { contextTools } from "./context";
import type { AgentTool } from "../types/tools";

export const tools = {
  ...inputTools,
  ...bashTool,
  ...fileTools,
  ...contextTools,
  ...taskTool,
  ...agentTool,
} satisfies Record<string, AgentTool<any>>;

export function getTool(
  name: string | null | undefined,
): AgentTool<any> | undefined {
  if (!name) return undefined;
  return Object.values(tools).find((tool) => tool.declaration.name === name);
}
