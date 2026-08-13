import { type FunctionDeclaration } from "@google/genai";
import { Tools, type ToolContext, type ToolResult } from "../types/tools";
import { executeInWorkspace } from "../runtime/executeInWorkspace";
import { AgentRunCancelledError } from "../runtime/AgentRunRegistry";
import path from "node:path";

type WorkspaceCommandExecutor = typeof executeInWorkspace;

export const createBashTool = (
  workspaceCommandExecutor: WorkspaceCommandExecutor = executeInWorkspace,
) => ({
  executeBash: {
    identifier: Tools.EXECUTE_BASH,
    declaration: {
      name: "executeBash",
      description:
        "Execute a shell command inside the running project workspace container. Node and npm are available there. On Alpine workspaces, install Python when needed with `apk add --no-cache python3 py3-pip`; do not ask the user to install project toolchains on their computer.",
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
    executable: async (
      args: { fullCommand: string },
      context: ToolContext,
    ): Promise<ToolResult> => {
      try {
        const databaseProjectId = process.env["DATABASE_PROJECT_ID"]?.trim();
        if (!databaseProjectId) {
          throw new Error("DATABASE_PROJECT_ID is required");
        }

        const agentWorkspacePath =
          process.env["WORKSPACE_PATH"]?.trim() || context.cwd;
        const containerWorkspacePath =
          process.env["WORKSPACE_CONTAINER_PATH"]?.trim() || "/app/my-app";
        const relativeWorkingDirectory = path.posix.relative(
          path.posix.dirname(agentWorkspacePath),
          context.cwd,
        );
        if (
          relativeWorkingDirectory === ".." ||
          relativeWorkingDirectory.startsWith("../")
        ) {
          throw new Error(
            "The bash working directory is outside the project volume",
          );
        }
        const containerWorkingDirectory =
          path.posix.resolve(context.cwd) ===
          path.posix.resolve(agentWorkspacePath)
            ? containerWorkspacePath
            : path.posix.resolve(
                path.posix.dirname(containerWorkspacePath),
                relativeWorkingDirectory,
              );

        const result = await workspaceCommandExecutor(args.fullCommand, {
          databaseProjectId,
          namespace: process.env["APP_NAMESPACE"]?.trim() || "default",
          containerName: process.env["WORKSPACE_CONTAINER"]?.trim() || "node",
          workingDirectory: containerWorkingDirectory,
          signal: context.signal,
        });
        return {
          response:
            result.exitCode === 0
              ? result.output
              : `Command exited with code ${result.exitCode}:\n${result.output}`,
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      } catch (error) {
        if (error instanceof AgentRunCancelledError) throw error;
        return {
          response: `Error executing command: \n ${error}`,
          // A command can modify files before it exits unsuccessfully.
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      }
    },
  },
});

export const bashTool = createBashTool();
