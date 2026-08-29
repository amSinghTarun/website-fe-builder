import { type FunctionDeclaration } from "@google/genai";
import { subAgentRegistry } from "../subAgents/registry";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { type ToolContext, type ToolResult } from "../types/tools";
import { activityTarget } from "../toolActivity";

export const agentTool = {
  createSubAgent: {
    activity: {
      started: (args: { id: string }) =>
        `Starting focused task ${activityTarget(args.id, "for a sub-agent")}`,
      completed: (args: { id: string }) =>
        `Started focused task ${activityTarget(args.id, "for a sub-agent")}`,
    },
    declaration: {
      name: "createSubAgent",
      description: "Create a sub-agent and spawn off a dedicated task to it",
      parametersJsonSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "id of the sub-agent",
          },
          systemPrompt: {
            type: "string",
            description: "the system prompt for the agent.",
          },
          prompt: {
            type: "string",
            description: "The task prompt that the agent should work upon",
          },
          baseBranch: {
            type: "string",
            description: "Branch to base this sub-agent's worktree on.",
          },
        },
        required: ["id", "systemPrompt", "prompt", "baseBranch"],
      },
    } as FunctionDeclaration,
    executable: (
      args: {
        id: string;
        systemPrompt: string;
        prompt: string;
        baseBranch: string;
        cwd: string;
      },
      context: ToolContext,
    ): ToolResult => {
      const branchName = `agent-${args.id}`;
      const base = args.baseBranch;
      const worktreePath = path.resolve(
        context.cwd,
        "../worktrees",
        branchName,
      );

      try {
        execFileSync(
          "git",
          ["worktree", "add", "-b", branchName, worktreePath, base],
          { cwd: context.cwd, stdio: "pipe" },
        );
      } catch (error: any) {
        return {
          response: `Failed to provision worktree: ${error.message}`,
        };
      }

      return {
        response: "agent created",
        workspacePath: worktreePath,
        branchName,
        yield: {
          type: "Created a sub agent",
          response: args.id,
        },
      };
    },
  },
  waitForSubAgent: {
    activity: {
      started: (args: { id: string }) =>
        `Waiting for focused task ${activityTarget(args.id, "from a sub-agent")}`,
      completed: (args: { id: string }) =>
        `Received result from focused task ${activityTarget(args.id, "from a sub-agent")}`,
    },
    declaration: {
      name: "waitForSubAgent",
      description:
        "Wait for a previously created sub-agent to finish and for its worktree to be merged, then return the exact merge result.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "id of the sub-agent for which we are waiting",
          },
        },
        required: ["id"],
      },
    } as FunctionDeclaration,
    executable: async (
      args: { id: string },
      context: ToolContext,
    ): Promise<ToolResult> => {
      try {
        const result = await subAgentRegistry.waitFor({
          projectId: context.databaseProjectId,
          parentRunId: context.agentRunId,
          id: args.id,
        });
        const response = result ?? {
          status: "ERROR" as const,
          id: args.id,
          error: "No sub-agent with that ID exists for this agent run.",
        };

        return {
          response,
          ...(!result && {
            yield: {
              type: "subAgentFailed",
              response,
            },
          }),
          ...(result?.status === "MERGED" && {
            effects: {
              workspaceChanged: true,
              runtimeMayChange: true,
            },
          }),
        };
      } catch (error) {
        const response = {
          status: "ERROR" as const,
          id: args.id,
          error: error instanceof Error ? error.message : String(error),
        };
        return {
          response,
          yield: {
            type: "subAgentFailed",
            response,
          },
        };
      }
    },
  },
  getCurrentWorkspace: {
    activity: {
      started: "Checking the project workspace",
      completed: "Checked the project workspace",
    },
    declaration: {
      name: "getCurrentWorkspace",
      description:
        "Returns the current working directory of this agent so it can determine whether it is operating in the main repository or a worktree.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    } as FunctionDeclaration,
    executable: async (
      _args: Record<string, never>,
      context: ToolContext,
    ): Promise<ToolResult> => {
      return {
        response: {
          cwd: context.cwd,
          isWorktree: context.cwd.includes("/worktrees/"),
          workspaceName: context.cwd.split("/").pop(),
        },
      };
    },
  },
};
