import { describe, expect, test } from "bun:test";
import { validateFrontendLint } from "./validateFrontendLint";

const options = {
  databaseProjectId: "project-id",
  namespace: "default",
  containerName: "node",
  workingDirectory: "/app/my-app",
};

describe("validateFrontendLint", () => {
  test("skips validation when the project has no lint script", async () => {
    const commands: string[] = [];
    const state = await validateFrontendLint(options, async (command) => {
      commands.push(command);
      return { output: "\n", exitCode: 0 };
    });

    expect(state).toBeUndefined();
    expect(commands).toHaveLength(1);
  });

  test("turns oxlint warnings into a repairable runtime failure", async () => {
    const commands: string[] = [];
    const state = await validateFrontendLint(options, async (command) => {
      commands.push(command);
      if (commands.length === 1) {
        return { output: "oxlint\n", exitCode: 0 };
      }
      return {
        output: "Column is not defined",
        exitCode: 1,
      };
    });

    expect(commands[1]).toBe("npm run lint -- --deny-warnings");
    expect(state).toMatchObject({
      status: "unhealthy",
      repairableByAgent: true,
      reason: "Frontend lint failed with exit code 1",
      logs: "Column is not defined",
    });
    expect(state?.fingerprint).toBeString();
  });

  test("rejects eslint warnings with its supported flag", async () => {
    const commands: string[] = [];
    await validateFrontendLint(options, async (command) => {
      commands.push(command);
      return commands.length === 1
        ? { output: "eslint .\n", exitCode: 0 }
        : { output: "", exitCode: 0 };
    });

    expect(commands[1]).toBe("npm run lint -- --max-warnings=0");
  });
});
