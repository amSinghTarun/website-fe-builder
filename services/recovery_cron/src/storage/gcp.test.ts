import { afterEach, describe, expect, test } from "bun:test";
import { ZipArchive } from "archiver";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { extractSnapshotArchive } from "./gcp";

const temporaryDirectories: string[] = [];

async function createArchive(
  files: Record<string, string>,
): Promise<Buffer> {
  const archive = new ZipArchive();
  const output = new PassThrough();
  const chunks: Buffer[] = [];

  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(output);
  for (const [fileName, contents] of Object.entries(files)) {
    archive.append(contents, { name: fileName });
  }
  await archive.finalize();
  return completed;
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sky-recovery-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("extractSnapshotArchive", () => {
  test("restores and validates every workspace file", async () => {
    const root = await createTemporaryDirectory();
    const destination = path.join(root, "my-app");
    const archive = await createArchive({
      "src/main.jsx": "export default 'app';",
      "package.json": '{"scripts":{"dev":"vite"}}',
      "index.html": '<main id="root"></main>',
      "vite.config.js": "export default {};",
    });

    await extractSnapshotArchive(archive, destination);

    expect(await fs.readFile(path.join(destination, "index.html"), "utf8"))
      .toBe('<main id="root"></main>');
    expect(
      await fs.readFile(path.join(destination, "vite.config.js"), "utf8"),
    ).toBe("export default {};");
    expect(
      await fs.readFile(path.join(destination, "src/main.jsx"), "utf8"),
    ).toBe("export default 'app';");
  });

  test("rejects an incomplete snapshot without replacing existing files", async () => {
    const root = await createTemporaryDirectory();
    const destination = path.join(root, "my-app");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "existing.txt"), "keep me");
    const archive = await createArchive({
      "package.json": '{"scripts":{"dev":"vite"}}',
    });

    await expect(extractSnapshotArchive(archive, destination)).rejects.toThrow(
      "missing required workspace files: index.html",
    );
    expect(await fs.readFile(path.join(destination, "existing.txt"), "utf8"))
      .toBe("keep me");
  });
});
