import { type FunctionDeclaration } from "@google/genai";
import {
  getContextArchiveConfig,
  readContextArtifact,
} from "../context/contextArchive";
import { type ToolContext, type ToolResult } from "../types/tools";

export const contextTools = {
  readContextArtifact: {
    activity: {
      started: "Reviewing earlier implementation context",
      completed: "Reviewed earlier implementation context",
    },
    declaration: {
      name: "readContextArtifact",
      description:
        "Read historical updateFile content archived on the project volume. Accepts only an artifact ID previously included in conversation history. Use readFileContent instead when you need a file's current contents.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          artifactId: {
            type: "string",
            description:
              "The 64-character SHA-256 artifact filename ending in .txt.",
          },
        },
        required: ["artifactId"],
      },
    } as FunctionDeclaration,
    executable: (
      args: { artifactId: string },
      context: ToolContext,
    ): ToolResult => {
      const config = getContextArchiveConfig({
        workspacePath: context.cwd,
        databaseProjectId: context.databaseProjectId,
      });

      try {
        return { response: readContextArtifact(args.artifactId, config) };
      } catch (error) {
        return {
          response: `Error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
};
