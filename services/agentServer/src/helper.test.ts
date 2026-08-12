import { describe, expect, test } from "bun:test";
import {
  consumeSubAgent,
  getOutstandingSubAgentIds,
  registerSubAgent,
  resolveSubAgent,
} from "./helper";

describe("sub-agent lifecycle", () => {
  test("consuming a completed sub-agent removes it from the completion gate", async () => {
    registerSubAgent("agent-1");
    resolveSubAgent("agent-1", { status: "MERGED" });

    expect(getOutstandingSubAgentIds()).toContain("agent-1");
    expect(await consumeSubAgent("agent-1")).toEqual({ status: "MERGED" });
    expect(getOutstandingSubAgentIds()).not.toContain("agent-1");
  });
});
