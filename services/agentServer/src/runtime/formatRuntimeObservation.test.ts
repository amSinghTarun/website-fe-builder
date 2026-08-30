import { describe, expect, test } from "bun:test";
import { formatRuntimeObservation } from "./formatRuntimeObservation";

describe("formatRuntimeObservation", () => {
  test("tells the agent that healthy automated diagnostics are authoritative", () => {
    const message = formatRuntimeObservation({
      status: "running",
      repairableByAgent: false,
      httpStatus: 200,
      observedAt: new Date().toISOString(),
    });

    expect(message).toContain("real browser render passed");
    expect(message).toContain("Do not ask the user to");
    expect(message).not.toContain("application is not healthy");
  });
});
