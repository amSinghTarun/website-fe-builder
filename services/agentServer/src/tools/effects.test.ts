import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileTools } from "./file";
import { createBashTool } from "./bash";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "sky-tools-"));
  directories.push(directory);
  return directory;
}

describe("tool runtime effects", () => {
  test("read tools do not mark the runtime dirty", async () => {
    const cwd = await workspace();
    const result = fileTools.readDirectory.executable(
      { directoryPath: "." },
      { cwd },
    );

    expect(result.effects).toBeUndefined();
  });

  test("successful file writes mark the runtime dirty", async () => {
    const cwd = await workspace();
    const result = fileTools.createFile.executable(
      { fileCreatePath: "index.ts" },
      { cwd },
    );

    expect(result.effects).toEqual({
      workspaceChanged: true,
      runtimeMayChange: true,
    });
  });

  test("updateFile refuses context archive references", async () => {
    const cwd = await workspace();
    const target = path.join(cwd, "index.ts");
    await writeFile(target, "export const original = true;", "utf-8");

    const result = fileTools.updateFile.executable(
      {
        filePath: "index.ts",
        content: `[SKY_CONTEXT_ARTIFACT:${"a".repeat(64)}.txt] archived`,
      },
      { cwd },
    );

    expect(result.response).toContain("refused to write");
    expect(result.effects).toBeUndefined();
    expect(await readFile(target, "utf-8")).toBe(
      "export const original = true;",
    );
  });

  test("updateFile refuses legacy broken context references", async () => {
    const cwd = await workspace();
    const target = path.join(cwd, "index.ts");
    await writeFile(target, "export const original = true;", "utf-8");

    const result = fileTools.updateFile.executable(
      {
        filePath: "index.ts",
        content:
          "Read file at /root/.loveable-contest/project/archive.md, to see the content",
      },
      { cwd },
    );

    expect(result.response).toContain("refused to write");
    expect(await readFile(target, "utf-8")).toBe(
      "export const original = true;",
    );
  });

  test("bash is conservatively treated as runtime-affecting", async () => {
    const cwd = await workspace();
    let receivedWorkingDirectory: string | undefined;
    const bashTool = createBashTool(async (_command, options) => {
      receivedWorkingDirectory = options.workingDirectory;
      return { output: "ok", exitCode: 0 };
    });
    const previousProjectId = process.env.DATABASE_PROJECT_ID;
    const previousWorkspacePath = process.env.WORKSPACE_PATH;
    const previousContainerPath = process.env.WORKSPACE_CONTAINER_PATH;
    process.env.DATABASE_PROJECT_ID = "database-id";
    process.env.WORKSPACE_PATH = cwd;
    process.env.WORKSPACE_CONTAINER_PATH = "/app/my-app";
    let result;
    try {
      result = await bashTool.executeBash.executable(
        { fullCommand: "true" },
        { cwd },
      );
    } finally {
      if (previousProjectId == null) delete process.env.DATABASE_PROJECT_ID;
      else process.env.DATABASE_PROJECT_ID = previousProjectId;
      if (previousWorkspacePath == null) delete process.env.WORKSPACE_PATH;
      else process.env.WORKSPACE_PATH = previousWorkspacePath;
      if (previousContainerPath == null)
        delete process.env.WORKSPACE_CONTAINER_PATH;
      else process.env.WORKSPACE_CONTAINER_PATH = previousContainerPath;
    }

    expect(result.effects?.runtimeMayChange).toBe(true);
    expect(receivedWorkingDirectory).toBe("/app/my-app");
  });
});
