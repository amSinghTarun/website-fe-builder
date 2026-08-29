import { type FunctionDeclaration } from "@google/genai";
import { type ToolContext, type ToolResult } from "../types/tools";
import { executeInWorkspace } from "../runtime/executeInWorkspace";
import { AgentRunCancelledError } from "../runtime/AgentRunRegistry";
import path from "node:path";

type ExpectedCommandImpact = "read_only" | "workspace" | "runtime";

const FOREGROUND_SERVER_COMMAND =
  /^\s*(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:dev|start|serve|preview)|npx\s+vite|vite)(?:\s|$)/i;

export const bashTool = {
  executeBash: {
    activity: {
      started: (args: { expectedImpact: ExpectedCommandImpact }) =>
        args.expectedImpact === "read_only"
          ? "Checking the project"
          : args.expectedImpact === "runtime"
            ? "Updating the preview runtime"
            : "Applying workspace changes",
      completed: (args: { expectedImpact: ExpectedCommandImpact }) =>
        args.expectedImpact === "read_only"
          ? "Checked the project"
          : args.expectedImpact === "runtime"
            ? "Updated the preview runtime"
            : "Applied workspace changes",
    },
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
          expectedImpact: {
            type: "string",
            enum: ["read_only", "workspace", "runtime"],
            description:
              "Expected command effect. Use read_only for checks that should not change files or the running preview, workspace for commands that may create/update/delete files or dependencies, and runtime for commands that may affect the preview without changing project files. If uncertain, use workspace.",
          },
        },
        required: ["fullCommand", "expectedImpact"],
      },
    } as FunctionDeclaration,
    executable: async (
      args: {
        fullCommand: string;
        expectedImpact: ExpectedCommandImpact;
      },
      context: ToolContext,
    ): Promise<ToolResult> => {
      try {
        if (FOREGROUND_SERVER_COMMAND.test(args.fullCommand)) {
          return {
            response:
              "The workspace preview server is already running. Do not start another dev server; inspect files, run a finite check such as `npm run build`, and use the existing preview.",
          };
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

        const result = await executeInWorkspace(args.fullCommand, {
          databaseProjectId: context.databaseProjectId,
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
          effects: {
            workspaceChanged: args.expectedImpact === "workspace",
            runtimeMayChange: args.expectedImpact !== "read_only",
          },
        };
      } catch (error) {
        if (error instanceof AgentRunCancelledError) throw error;
        return {
          response: `Error executing command: \n ${error}`,
          // These are intent hints. Final workspace mutation is verified from
          // the filesystem because a failed command may still change files.
          effects: {
            workspaceChanged: args.expectedImpact === "workspace",
            runtimeMayChange: args.expectedImpact !== "read_only",
          },
        };
      }
    },
  },
};
