import { describe, expect, test } from "bun:test";
import { evaluateRuntimeRepair } from "./helpers";

describe("evaluateRuntimeRepair", () => {
  test("records the fingerprint and attempt used for each retry", () => {
    const attempts = new Map<string, number>();
    const runtimeState = {
      status: "unhealthy" as const,
      repairableByAgent: true,
      fingerprint: "same-failure",
      reason: "Browser preview smoke test failed",
      observedAt: new Date().toISOString(),
    };

    expect(evaluateRuntimeRepair(runtimeState, attempts)).toMatchObject({
      action: "retry",
      attempt: 1,
      fingerprint: "same-failure",
    });
    expect(evaluateRuntimeRepair(runtimeState, attempts)).toMatchObject({
      action: "retry",
      attempt: 2,
      fingerprint: "same-failure",
    });
    expect(evaluateRuntimeRepair(runtimeState, attempts)).toMatchObject({
      action: "retry",
      attempt: 3,
      fingerprint: "same-failure",
    });
    expect(evaluateRuntimeRepair(runtimeState, attempts)).toMatchObject({
      action: "blocked",
      attempt: 4,
      fingerprint: "same-failure",
    });
  });
});
