import { describe, expect, test } from "bun:test";
import { summarizeToolCall } from "./toolActivity";

describe("tool activity summaries", () => {
  test("describes file operations without including file contents", () => {
    expect(
      summarizeToolCall(
        "updateFile",
        { filePath: "src/App.jsx", content: "secret source" },
        "started",
      ),
    ).toBe("Updating src/App.jsx");
  });

  test("describes command purpose without exposing the command", () => {
    expect(
      summarizeToolCall(
        "executeBash",
        { fullCommand: "npm run build -- --token=secret" },
        "started",
      ),
    ).toBe("Checking the production build");
  });

  test("keeps summaries to a single short line", () => {
    const summary = summarizeToolCall(
      "readFileContent",
      { filePath: `src/${"a".repeat(200)}\nsecret.jsx` },
      "completed",
    );

    expect(summary).not.toContain("\n");
    expect(summary.length).toBeLessThanOrEqual(120);
  });
});
