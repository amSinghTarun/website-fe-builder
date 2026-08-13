import { inputTools } from "./input";
import { bashTool } from "./bash";
import { fileTools } from "./file";
import { taskTool } from "./task";
import { agentTool } from "./agent";
import { contextTools } from "./context";
import type { AgentTool } from "../types/tools";

export { mergeWorktree } from "./agent";
export let tools = {
  ...inputTools,
  ...bashTool,
  ...fileTools,
  ...contextTools,
  ...taskTool,
  ...agentTool,
} satisfies Record<string, AgentTool<any>>;
