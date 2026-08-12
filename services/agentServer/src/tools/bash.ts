import { type FunctionDeclaration } from "@google/genai";
import { execSync } from "child_process";
import { Tools, type ToolContext, type ToolResult } from "../types/tools";

export let bashTool = {
  executeBash: {
    identifier: Tools.EXECUTE_BASH,
    declaration: {
      name: "executeBash",
      description: "execute any bash command",
      parametersJsonSchema: {
        type: "object",
        properties: {
          fullCommand: {
            type: "string",
            description:
              "full bash command to execute includeing every/any flags",
          },
        },
        required: ["fullCommand"],
      },
    } as FunctionDeclaration,
    executable: (
      args: { fullCommand: string },
      context: ToolContext,
    ): ToolResult => {
      try {
        const response = execSync(args.fullCommand, {
          cwd: context.cwd,
          encoding: "utf-8",
        });
        return {
          response,
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      } catch (error) {
        return {
          response: `Error executing command: \n ${error}`,
          // A command can modify files before it exits unsuccessfully.
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      }
    },
  },
};
