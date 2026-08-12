import { describe, expect, test } from "bun:test";
import { toRuntimeId } from ".";

describe("toRuntimeId", () => {
  test("derives the Kubernetes runtime prefix from the database project ID", () => {
    expect(toRuntimeId(" database-id ")).toBe("sky-database-id");
  });

  test("rejects an empty database project ID", () => {
    expect(() => toRuntimeId("  ")).toThrow("databaseProjectId is required");
  });
});
