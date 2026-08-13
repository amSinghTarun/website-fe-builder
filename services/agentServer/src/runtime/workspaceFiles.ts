import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceFile = {
  path: string;
  content: string;
  size: number;
};

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".vite",
  "coverage",
]);

const excludedFiles = new Set(["package-lock.json", "bun.lock", "yarn.lock"]);
const maxFiles = 300;
const maxFileBytes = 256 * 1024;
const maxTotalBytes = 3 * 1024 * 1024;

function isSensitiveFile(name: string): boolean {
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

function looksBinary(contents: Buffer): boolean {
  return contents.subarray(0, 8_000).includes(0);
}

export async function listWorkspaceFiles(
  workspacePath: string,
): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];
  let totalBytes = 0;

  const visit = async (directory: string, relativeDirectory = "") => {
    if (files.length >= maxFiles || totalBytes >= maxTotalBytes) return;

    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (files.length >= maxFiles || totalBytes >= maxTotalBytes) break;
      if (entry.isSymbolicLink()) continue;

      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          await visit(absolutePath, relativePath);
        }
        continue;
      }

      if (
        !entry.isFile() ||
        excludedFiles.has(entry.name) ||
        isSensitiveFile(entry.name)
      ) {
        continue;
      }

      const contents = await readFile(absolutePath);
      if (contents.byteLength > maxFileBytes || looksBinary(contents)) continue;
      if (totalBytes + contents.byteLength > maxTotalBytes) break;

      files.push({
        path: relativePath,
        content: contents.toString("utf-8"),
        size: contents.byteLength,
      });
      totalBytes += contents.byteLength;
    }
  };

  await visit(workspacePath);
  return files;
}
