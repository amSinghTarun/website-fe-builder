import { PassThrough } from "node:stream";

type AgentRun = {
  controller: AbortController;
  chunks: Buffer[];
  subscribers: Set<PassThrough>;
};

type AgentRunExecutor = (signal: AbortSignal) => Promise<Response>;

function errorEvent(error: unknown): Buffer {
  const message = error instanceof Error ? error.message : String(error);
  return Buffer.from(
    `data: ${JSON.stringify({ type: "error", response: message })}\n\n`,
  );
}

// Runs agents independently from browser connections and replays their output.
export class AgentRunRegistry {
  private readonly runs = new Map<string, AgentRun>();

  public start(projectId: string, execute: AgentRunExecutor): void {
    if (this.runs.has(projectId)) {
      throw new Error("A generation is already active for this project");
    }

    const run: AgentRun = {
      controller: new AbortController(),
      chunks: [],
      subscribers: new Set(),
    };
    this.runs.set(projectId, run);
    void this.consume(projectId, run, execute);
  }

  public subscribe(projectId: string): PassThrough | null {
    const run = this.runs.get(projectId);
    if (!run) return null;

    const stream = new PassThrough();
    run.subscribers.add(stream);
    run.chunks.forEach((chunk) => stream.write(chunk));
    stream.once("close", () => run.subscribers.delete(stream));
    return stream;
  }

  public stop(projectId: string): boolean {
    const run = this.runs.get(projectId);
    if (!run || run.controller.signal.aborted) return false;

    run.controller.abort(new Error("Generation stopped by user"));
    return true;
  }

  public isActive(projectId: string): boolean {
    return this.runs.has(projectId);
  }

  private publish(run: AgentRun, chunk: Buffer): void {
    run.chunks.push(chunk);
    run.subscribers.forEach((subscriber) => subscriber.write(chunk));
  }

  private async consume(
    projectId: string,
    run: AgentRun,
    execute: AgentRunExecutor,
  ): Promise<void> {
    try {
      const response = await execute(run.controller.signal);
      if (!response.body) throw new Error("Agent returned an empty response stream");

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.publish(run, Buffer.from(value));
      }
    } catch (error) {
      if (!run.controller.signal.aborted) {
        this.publish(run, errorEvent(error));
      }
    } finally {
      run.subscribers.forEach((subscriber) => subscriber.end());
      if (this.runs.get(projectId) === run) this.runs.delete(projectId);
    }
  }
}

