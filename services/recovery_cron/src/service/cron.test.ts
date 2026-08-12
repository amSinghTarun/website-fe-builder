import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import unzipper from "unzipper";
import { createWorkspaceArchive } from "./cron";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("workspace snapshots", () => {
  test("archives project files while excluding node_modules and Git data", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "sky-workspace-"));
    temporaryDirectories.push(workspace);
    await mkdir(path.join(workspace, "src"));
    await mkdir(path.join(workspace, "node_modules", "dependency"), {
      recursive: true,
    });
    await mkdir(path.join(workspace, ".git"));
    await writeFile(path.join(workspace, "src", "App.tsx"), "export {};");
    await writeFile(
      path.join(workspace, "node_modules", "dependency", "index.js"),
      "ignored",
    );
    await writeFile(path.join(workspace, ".git", "config"), "ignored");

    const archive = await createWorkspaceArchive(workspace);
    const directory = await unzipper.Open.buffer(archive);
    const paths = directory.files.map((file) => file.path);

    expect(paths).toContain("src/App.tsx");
    expect(paths.some((entry) => entry.startsWith("node_modules/"))).toBeFalse();
    expect(paths.some((entry) => entry.startsWith(".git/"))).toBeFalse();
  });
});
