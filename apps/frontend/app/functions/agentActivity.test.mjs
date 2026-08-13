import { describe, expect, test } from "bun:test";
import {
  emptyAgentActivity,
  reduceAgentActivity,
} from "./agentActivity.ts";

describe("agent activity stream", () => {
  test("renders and completes plan steps", () => {
    const planned = reduceAgentActivity(emptyAgentActivity, {
      type: "plan",
      response: [
        { id: "design", task: "Design the page" },
        { id: "build", task: "Build the components" },
      ],
    });
    const completed = reduceAgentActivity(planned, {
      type: "planComplete",
      response: "design",
    });

    expect(completed.items).toEqual([
      { id: "plan-design", label: "Design the page", status: "complete" },
      { id: "plan-build", label: "Build the components", status: "active" },
    ]);
  });

  test("shows runtime recovery and success", () => {
    const repairing = reduceAgentActivity(emptyAgentActivity, {
      type: "runtime",
      response: { status: "unhealthy", reason: "Vite returned HTTP 500" },
    });
    const running = reduceAgentActivity(repairing, {
      type: "runtime",
      response: { status: "running" },
    });

    expect(repairing.items[0]).toMatchObject({ status: "active" });
    expect(running.items[0]).toEqual({
      id: "runtime",
      label: "Preview is running",
      status: "complete",
    });
  });

  test("surfaces streamed errors", () => {
    const failed = reduceAgentActivity(emptyAgentActivity, {
      type: "error",
      response: "Vertex quota exceeded",
    });

    expect(failed.items[0]).toEqual({
      id: "agent-error",
      label: "Vertex quota exceeded",
      status: "error",
    });
  });
});
