import { describe, expect, test } from "bun:test";
import {
  AgentRunCancelledError,
  AgentRunRegistry,
  abortable,
} from "./AgentRunRegistry";

describe("AgentRunRegistry", () => {
  test("stops only the active run for a project", () => {
    const registry = new AgentRunRegistry();
    const run = registry.start("project-1");

    expect(registry.stop("project-1")).toBe(true);
    expect(run.signal.aborted).toBe(true);
    expect(registry.stop("project-1")).toBe(false);
    registry.finish("project-1", run);
    expect(registry.start("project-1").signal.aborted).toBe(false);
  });

  test("rejects concurrent generations for the same project", () => {
    const registry = new AgentRunRegistry();
    registry.start("project-1");

    expect(() => registry.start("project-1")).toThrow(
      "A generation is already active",
    );
  });

  test("interrupts an agent waiting for user input", async () => {
    const registry = new AgentRunRegistry();
    const run = registry.start("project-1");
    const waiting = abortable(new Promise<string>(() => {}), run.signal);

    registry.stop("project-1");

    await expect(waiting).rejects.toBeInstanceOf(AgentRunCancelledError);
  });
});
