export class AgentRunCancelledError extends Error {
  public constructor() {
    super("Generation stopped by user");
    this.name = "AgentRunCancelledError";
  }
}

export class AgentRunRegistry {
  private readonly activeRuns = new Map<string, AbortController>();

  public start(projectId: string): AbortController {
    const current = this.activeRuns.get(projectId);
    if (current && !current.signal.aborted) {
      throw new Error("A generation is already active for this project");
    }

    const controller = new AbortController();
    this.activeRuns.set(projectId, controller);
    return controller;
  }

  public stop(projectId: string): boolean {
    const controller = this.activeRuns.get(projectId);
    if (!controller || controller.signal.aborted) return false;

    controller.abort(new AgentRunCancelledError());
    return true;
  }

  public finish(projectId: string, controller: AbortController): void {
    if (this.activeRuns.get(projectId) === controller) {
      this.activeRuns.delete(projectId);
    }
  }
}

export function throwIfRunCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof AgentRunCancelledError
    ? signal.reason
    : new AgentRunCancelledError();
}

export async function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  throwIfRunCancelled(signal);

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AgentRunCancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export const agentRunRegistry = new AgentRunRegistry();
