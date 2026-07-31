import path from "node:path";

export const catchUserInputResolver: Map<string, (message: string) => void> =
  new Map();

export const subAgents: Record<
  string,
  {
    status: "IN_PROGRESS" | "ERROR" | "MERGED" | "MERGE_CONFLICT";
    completion: Promise<any>;
  }
> = {};

const subAgentsResponse: Record<
  string,
  { resolve: (value: any) => void; reject: (value: any) => void }
> = {};

export const registerSubAgent = (id: string) => {
  subAgents[id] = {
    status: "IN_PROGRESS",
    completion: new Promise((resolve, reject) => {
      subAgentsResponse[id] = {
        resolve: resolve,
        reject: reject,
      };
    }),
  };
};

export const resolveSubAgent = (id: string, value: any) => {
  if (!subAgents[id]) return;
  subAgents[id].status = "MERGED";
  subAgentsResponse[id]?.resolve(value);
};

export const rejectSubAgent = (id: string, err: any) => {
  if (!subAgents[id]) return;
  subAgents[id].status =
    err?.status === "MERGE_CONFLICT" ? "MERGE_CONFLICT" : "ERROR";
  subAgentsResponse[id]?.reject(err);
};

export const resolveWorkspacePath = (
  cwd: string,
  relativePath: string,
): string => {
  const workspace = path.resolve(cwd);
  const resolved = path.resolve(workspace, relativePath);

  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error("Path escapes workspace");
  }

  return resolved;
};

// AI generated
let mergeChain: Promise<any> = Promise.resolve();

export function queueMerge<T>(fn: () => Promise<T>): Promise<T> {
  const run = mergeChain.then(fn);
  mergeChain = run.catch(() => {});
  return run;
}
