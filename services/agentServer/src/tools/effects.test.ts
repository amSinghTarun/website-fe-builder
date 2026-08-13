import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const result = bashTool.executeBash.executable(
      { fullCommand: "true" },
      { cwd },
    );

    expect(result.effects?.runtimeMayChange).toBe(true);
  });
});
