import { prisma, type ConversationRunStatus } from "@sky/db";
import { subAgentRegistry, type SubAgentResult } from "./registry";
import { mergeWorktree } from "./mergeWorktree";

type SubAgentRunResult = {
  id: string;
  status: ConversationRunStatus;
  summary: string;
};

type StartSubAgentLifecycleArgs = {
  id: string;
  projectId: string;
  parentRunId: string;
  parentAgentId: string;
  mainWorktreePath: string;
  start: () => Promise<SubAgentRunResult>;
  onSettled?: (result: SubAgentResult) => void;
};

// Track the complete delegated lifecycle: run, merge, persist, then publish.
export function startSubAgentLifecycle(
  args: StartSubAgentLifecycleArgs,
): void {
  subAgentRegistry.track(
    {
      projectId: args.projectId,
      parentRunId: args.parentRunId,
      id: args.id,
    },
    async (): Promise<SubAgentResult> => {
      try {
        const response = await args.start();
        if (response.status !== "SUCCEEDED") {
          return {
            id: args.id,
            status: "ERROR",
            error:
              response.summary ||
              `Sub-agent ended with status ${response.status}.`,
          };
        }

        // Serialize merges and preserve conflict diagnostics for the parent.
        const mergeResult = await mergeWorktree({
          id: response.id,
          targetBranch: "main",
          mainWorktreePath: args.mainWorktreePath,
        });
        if (mergeResult.status === "MERGE_CONFLICT") {
          return { id: response.id, ...mergeResult };
        }

        // Recovery only needs successful merge operations in its replay log.
        try {
          await prisma.conversationHistory.create({
            data: {
              contents: JSON.stringify({
                args: {
                  id: response.id,
                  targetBranch: "main",
                  mainWorktreePath: args.mainWorktreePath,
                },
              }),
              from: "LOOP",
              toolCall: "mergeWorkTree",
              projectId: args.projectId,
              type: "TOOL_CALL",
              agentId: args.parentAgentId,
            },
          });
        } catch (historyError) {
          console.error("Unable to record the sub-agent merge:", historyError);
        }

        return {
          id: response.id,
          status: "MERGED",
          summary: response.summary,
        };
      } catch (error) {
        return {
          id: args.id,
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    args.onSettled,
  );
}
