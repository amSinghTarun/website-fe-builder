import { type FunctionDeclaration } from "@google/genai";
import { execSync } from "child_process";
import { Tools } from "../types/tools";

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
    executable: (args: { fullCommand: string }, context: { cwd: string }) => {
      try {
        const response = execSync(args.fullCommand, { cwd: context.cwd });
        return { response: response };
      } catch (error) {
        return `Error executing command: \n ${error}`;
      }
    },
  },
};
