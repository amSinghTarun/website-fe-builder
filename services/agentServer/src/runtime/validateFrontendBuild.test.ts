import { describe, expect, test } from "bun:test";
import { validateFrontendBuild } from "./validateFrontendBuild";

const options = {
  databaseProjectId: "database-id",
  namespace: "default",
  containerName: "node",
  workingDirectory: "/app/my-app",
};

describe("validateFrontendBuild", () => {
  test("accepts a successful production build", async () => {
    const state = await validateFrontendBuild(options, async () => ({
      output: "built successfully",
      exitCode: 0,
    }));

    expect(state).toBeUndefined();
  });

  test("returns repairable diagnostics for a failed production build", async () => {
    const state = await validateFrontendBuild(options, async (command, received) => {
      expect(command).toBe("npm run build");
      expect(received.workingDirectory).toBe("/app/my-app");
      return {
        output: "HabitCard.jsx: Invalid Unicode escape sequence",
        exitCode: 1,
      };
    });

    expect(state).toMatchObject({
      status: "unhealthy",
      failureScope: "application",
      repairableByAgent: true,
      reason: "Frontend build failed with exit code 1",
      logs: "HabitCard.jsx: Invalid Unicode escape sequence",
    });
    expect(state?.fingerprint).toHaveLength(64);
  });
});
