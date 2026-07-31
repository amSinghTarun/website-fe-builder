import { type FunctionDeclaration } from "@google/genai";
import { queueMerge, registerSubAgent, subAgents } from "../helper";
import { $Enums as prismaEnums } from "@sky/db";
import path from "node:path";
import { execSync } from "node:child_process";

export const mergeWorktree = (args: {
  id: string;
  targetBranch: string;
  mainWorktreePath: string;
}): Promise<any> => {
  const branchName = `agent-${args.id}`;
  const worktreePath = path.resolve(process.cwd(), "../worktrees", branchName);

  return queueMerge(async () => {
    try {
      execSync(`git checkout ${args.targetBranch}`, {
        cwd: args.mainWorktreePath,
      });
      execSync(`git merge ${branchName}`, { cwd: args.mainWorktreePath });
      execSync(`git worktree remove "${worktreePath}"`, {
        cwd: args.mainWorktreePath,
      });
      execSync(`git branch -d ${branchName}`, { cwd: args.mainWorktreePath });
      return { status: "MERGED" };
    } catch (error: any) {
      const isConflict = error.message?.includes("CONFLICT");
      const mergeError = new Error(error.message);
      (mergeError as any).status = isConflict ? "MERGE_CONFLICT" : "ERROR";
      throw mergeError;
    }
  });
};

export const agentTool = {
  createSubAgent: {
    identifier: prismaEnums.ToolCall.CREATE_SUB_AGENT,
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
      context: { cwd: string },
    ) => {
      const branchName = `agent-${args.id}`;
      const base = args.baseBranch;
      const worktreePath = path.resolve(
        context.cwd,
        "../worktrees",
        branchName,
      );

      try {
        execSync(
          `git worktree add -b ${branchName} "${worktreePath}" ${base}`,
          {
            stdio: "pipe",
          },
        );
      } catch (error: any) {
        return {
          response: `Failed to provision worktree: ${error.message}`,
        };
      }

      registerSubAgent(args.id);

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
    identifier: prismaEnums.ToolCall.WAITING_FOR_SUB_AGENT,
    declaration: {
      name: "waitForSubAgent",
      description:
        "If we need to wait for a sub-agent when we need it to finish it's task before we move on",
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
    executable: async (args: { id: string }, context: { cwd: string }) => {
      let response = {
        status: "ERROR : NO AGENT WITH THAT ID FOUND",
        id: args.id,
      };
      const result = await subAgents[args.id]?.completion;

      return {
        response: result ? { ...result, id: args.id } : response,
        yield: {
          type: "waitingForAgent",
          response: args.id,
        },
      };
    },
  },
  getCurrentWorkspace: {
    identifier: prismaEnums.ToolCall.GET_CURRENT_WORKSPACE,
    declaration: {
      name: "getCurrentWorkspace",
      description:
        "Returns the current working directory of this agent so it can determine whether it is operating in the main repository or a worktree.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
      },
    } as FunctionDeclaration,
    executable: async (context: { cwd: string }) => {
      return {
        response: {
          cwd: process.cwd(),
          isWorktree: process.cwd().includes("/worktrees/"),
          workspaceName: process.cwd().split("/").pop(),
        },
      };
    },
  },
};
