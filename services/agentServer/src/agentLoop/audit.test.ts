import { describe, expect, test } from "bun:test";
import { serializeAuditPayload } from "./audit";

describe("serializeAuditPayload", () => {
  test("preserves normal structured tool results", () => {
    const serialized = serializeAuditPayload({
      response: "updated",
      effects: { workspaceChanged: true },
    });

    expect(JSON.parse(serialized)).toEqual({
      response: "updated",
      effects: { workspaceChanged: true },
    });
  });

  test("records errors and bounds very large responses", () => {
    expect(JSON.parse(serializeAuditPayload(new Error("broken"))).message).toBe(
      "broken",
    );

    const serialized = serializeAuditPayload({ response: "x".repeat(70_000) });
    const parsed = JSON.parse(serialized);
    expect(parsed.truncated).toBe(true);
    expect(parsed.originalCharacters).toBeGreaterThan(64_000);
  });

  test("redacts common secret values", () => {
    const serialized = serializeAuditPayload({
      token: "top-secret",
      response: "DATABASE_PASSWORD=hunter2\nAuthorization: Bearer abc.def",
    });

    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("abc.def");
    expect(serialized).toContain("[REDACTED]");
  });
});
