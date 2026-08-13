import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { listWorkspaceFiles } from "./workspaceFiles";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("workspace file listing", () => {
  test("returns source files while excluding dependencies, secrets, and symlinks", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "sky-files-"));
    directories.push(workspace);
    await mkdir(path.join(workspace, "src"));
    await mkdir(path.join(workspace, "node_modules"));
    await writeFile(path.join(workspace, "src", "App.tsx"), "export default 1;");
    await writeFile(path.join(workspace, ".env"), "SECRET=value");
    await writeFile(path.join(workspace, ".env.example"), "API_URL=");
    await writeFile(path.join(workspace, "node_modules", "ignored.js"), "no");
    await symlink("/etc/passwd", path.join(workspace, "outside"));

    expect(await listWorkspaceFiles(workspace)).toEqual([
      { path: ".env.example", content: "API_URL=", size: 8 },
      { path: "src/App.tsx", content: "export default 1;", size: 17 },
    ]);
  });
});
