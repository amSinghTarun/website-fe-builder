import { inputTools } from "./input";
import { bashTool } from "./bash";
import { fileTools } from "./file";
import { taskTool } from "./task";
import { agentTool } from "./agent";

export { mergeWorktree } from "./agent";
export let tools = {
  ...inputTools,
  ...bashTool,
  ...fileTools,
  ...taskTool,
  ...agentTool,
};
