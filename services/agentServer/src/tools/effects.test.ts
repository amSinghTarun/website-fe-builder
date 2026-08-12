import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileTools } from "./file";
import { bashTool } from "./bash";

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

  test("bash is conservatively treated as runtime-affecting", async () => {
    const cwd = await workspace();
    const result = bashTool.executeBash.executable(
      { fullCommand: "true" },
      { cwd },
    );

    expect(result.effects?.runtimeMayChange).toBe(true);
  });
});
