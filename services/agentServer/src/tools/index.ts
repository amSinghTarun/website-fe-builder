import { inputTools } from "./input";
import { bashTool } from "./bash";
import { fileTools } from "./file";
import { taskTool } from "./task";
import { agentTool } from "./agent";
import type { AgentTool } from "../types/tools";

export { mergeWorktree } from "./agent";
export let tools = {
  ...inputTools,
  ...bashTool,
  ...fileTools,
  ...taskTool,
  ...agentTool,
} satisfies Record<string, AgentTool<any>>;
