import { describe, expect, test } from "bun:test";
import { AgentRunRegistry } from "./agentRunRegistry";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";
  for await (const chunk of stream) output += chunk.toString();
  return output;
}

describe("AgentRunRegistry", () => {
  test("keeps a run alive when a subscriber disconnects and replays events", async () => {
    const registry = new AgentRunRegistry();
    const responseReady = deferred<Response>();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let signal: AbortSignal | undefined;

    registry.start("project-1", async (runSignal) => {
      signal = runSignal;
      return responseReady.promise;
    });

    const firstSubscriber = registry.subscribe("project-1");
    expect(firstSubscriber).not.toBeNull();
    firstSubscriber!.destroy();
    expect(signal?.aborted).toBe(false);

    responseReady.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            streamController = controller;
          },
        }),
      ),
    );
    await Bun.sleep(0);
    streamController.enqueue(Buffer.from("data: first\n\n"));
    await Bun.sleep(0);

    const resumedSubscriber = registry.subscribe("project-1");
    expect(resumedSubscriber).not.toBeNull();
    const output = readStream(resumedSubscriber!);
    streamController.enqueue(Buffer.from("data: second\n\n"));
    streamController.close();

    expect(await output).toBe("data: first\n\ndata: second\n\n");
    expect(registry.isActive("project-1")).toBe(false);
  });

  test("only an explicit stop aborts the run", async () => {
    const registry = new AgentRunRegistry();
    const stopped = deferred<Response>();
    let signal: AbortSignal | undefined;

    registry.start("project-1", async (runSignal) => {
      signal = runSignal;
      return stopped.promise;
    });

    expect(registry.stop("project-1")).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(registry.stop("project-1")).toBe(false);
    stopped.resolve(new Response(""));
  });
});

