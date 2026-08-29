import { execFileSync } from "node:child_process";
import path from "node:path";

type MergeResult =
  | { status: "MERGED" }
  | {
      status: "MERGE_CONFLICT";
      error: string;
      branchName: string;
      worktreePath: string;
      conflictingFiles: string[];
      gitStatus: string;
    };

let mergeChain: Promise<void> = Promise.resolve();

// Serialize merges while allowing sub-agents to execute concurrently.
function queueMerge<T>(merge: () => Promise<T>): Promise<T> {
  const result = mergeChain.then(merge);
  mergeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commandErrorMessage(error: any): string {
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString("utf8")
    : String(error?.stderr ?? "");
  const stdout = Buffer.isBuffer(error?.stdout)
    ? error.stdout.toString("utf8")
    : String(error?.stdout ?? "");
  return [error?.message, stderr, stdout].filter(Boolean).join("\n").trim();
}

// Merge a completed sub-agent branch and preserve its worktree on conflict.
export function mergeWorktree(args: {
  id: string;
  targetBranch: string;
  mainWorktreePath: string;
}): Promise<MergeResult> {
  const branchName = `agent-${args.id}`;
  const worktreePath = path.resolve(
    args.mainWorktreePath,
    "../worktrees",
    branchName,
  );

  return queueMerge(async () => {
    try {
      runGit(args.mainWorktreePath, ["checkout", args.targetBranch]);
      runGit(args.mainWorktreePath, ["merge", branchName]);
      runGit(args.mainWorktreePath, ["worktree", "remove", worktreePath]);
      runGit(args.mainWorktreePath, ["branch", "-d", branchName]);
      return { status: "MERGED" as const };
    } catch (error: any) {
      const conflictingFiles = runGit(args.mainWorktreePath, [
        "diff",
        "--name-only",
        "--diff-filter=U",
      ])
        .split("\n")
        .map((file) => file.trim())
        .filter(Boolean);
      if (conflictingFiles.length === 0) throw error;

      const gitStatus = runGit(args.mainWorktreePath, ["status", "--short"]);
      const conflictError = commandErrorMessage(error);

      try {
        runGit(args.mainWorktreePath, ["merge", "--abort"]);
      } catch (abortError) {
        throw new Error(
          `Merge conflict detected, but the merge could not be aborted safely. ${commandErrorMessage(abortError)}`,
        );
      }

      return {
        status: "MERGE_CONFLICT" as const,
        error: conflictError,
        branchName,
        worktreePath,
        conflictingFiles,
        gitStatus,
      };
    }
  });
}
