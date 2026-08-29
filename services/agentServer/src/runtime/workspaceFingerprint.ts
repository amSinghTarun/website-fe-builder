import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".cache",
  ".vite",
  "coverage",
]);

export async function fingerprintWorkspace(
  workspacePath: string,
): Promise<string> {
  const root = path.resolve(workspacePath);
  const hash = createHash("sha256");

  const visit = async (directory: string, relativeDirectory = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) {
          await visit(absolutePath, relativePath);
        }
        continue;
      }

      if (entry.isSymbolicLink()) {
        hash.update(`link\0${relativePath}\0${await readlink(absolutePath)}\0`);
        continue;
      }

      if (!entry.isFile()) continue;

      hash.update(`file\0${relativePath}\0`);
      hash.update(await readFile(absolutePath));
      hash.update("\0");
    }
  };

  await visit(root);
  return hash.digest("hex");
}
