import { describe, expect, test } from "bun:test";
import { createClientId } from "./clientId.ts";

describe("createClientId", () => {
  test("uses crypto.randomUUID when the browser provides it", () => {
    expect(createClientId(() => "secure-context-id")).toBe(
      "secure-context-id",
    );
  });

  test("creates an ID when randomUUID is unavailable on an HTTP origin", () => {
    expect(createClientId(null)).toMatch(/^message-\d+-[a-z0-9]+$/);
  });
});
