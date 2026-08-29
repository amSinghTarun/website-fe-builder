export type SubAgentResult =
  | {
      id: string;
      status: "MERGED";
      summary: string;
    }
  | {
      id: string;
      status: "ERROR";
      error: string;
    }
  | {
      id: string;
      status: "MERGE_CONFLICT";
      error: string;
      branchName: string;
      worktreePath: string;
      conflictingFiles: string[];
      gitStatus: string;
    };

type SubAgentScope = {
  projectId: string;
  parentRunId: string;
  id: string;
};

type RunScope = Omit<SubAgentScope, "id">;
type CollectionMode = "ready" | "all";

type SubAgentEntry = SubAgentScope & {
  completion: Promise<SubAgentResult>;
  result?: SubAgentResult;
};

// Store delegated runs by project and parent run so users never share state.
class SubAgentRegistry {
  private readonly entries = new Map<string, SubAgentEntry>();

  // Start and retain one complete sub-agent run-and-merge lifecycle.
  public track(
    scope: SubAgentScope,
    startLifecycle: () => Promise<SubAgentResult>,
    onSettled?: (result: SubAgentResult) => void,
  ): void {
    const key = this.key(scope);
    if (this.entries.has(key)) {
      throw new Error(`Sub-agent ${scope.id} is already registered`);
    }

    const entry = { ...scope } as SubAgentEntry;
    entry.completion = startLifecycle().then((result) => {
      entry.result = result;
      try {
        onSettled?.(result);
      } catch (error) {
        console.error("Unable to publish the sub-agent result:", error);
      }
      return result;
    });
    this.entries.set(key, entry);
  }

  // Wait for and consume one explicitly requested sub-agent result.
  public async waitFor(
    scope: SubAgentScope,
  ): Promise<SubAgentResult | undefined> {
    const key = this.key(scope);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    try {
      return await entry.completion;
    } finally {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    }
  }

  // Drain settled results immediately or await every remaining run at exit.
  public async collectRun(
    scope: RunScope,
    mode: CollectionMode,
  ): Promise<SubAgentResult[]> {
    const entries = [...this.entries.entries()].filter(
      ([, entry]) =>
        entry.projectId === scope.projectId &&
        entry.parentRunId === scope.parentRunId &&
        (mode === "all" || entry.result !== undefined),
    );

    try {
      if (mode === "ready") {
        return entries.map(([, entry]) => entry.result!);
      }
      return await Promise.all(entries.map(([, entry]) => entry.completion));
    } finally {
      for (const [key, entry] of entries) {
        if (this.entries.get(key) === entry) this.entries.delete(key);
      }
    }
  }

  // Forget unconsumed entries when their parent run exits or is cancelled.
  public clearRun(scope: RunScope): void {
    for (const [key, entry] of this.entries) {
      if (
        entry.projectId === scope.projectId &&
        entry.parentRunId === scope.parentRunId
      ) {
        this.entries.delete(key);
      }
    }
  }

  private key(scope: SubAgentScope): string {
    return JSON.stringify([scope.projectId, scope.parentRunId, scope.id]);
  }
}

export const subAgentRegistry = new SubAgentRegistry();
