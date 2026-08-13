import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Content } from "@google/genai";
import {
  CONTEXT_ARTIFACT_PREFIX,
  archiveLargeUpdateFileArguments,
  readContextArtifact,
} from "./contextArchive";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("agent context archive", () => {
  test("archives large updateFile content without mutating canonical history", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "sky-context-"));
    directories.push(rootPath);
    const source = "export const value = 1;\n".repeat(20);
    const history: Content[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "updateFile",
              args: { filePath: "src/App.tsx", content: source },
            },
          },
        ],
      },
    ];
    const config = { rootPath, databaseProjectId: "database-id" };

    const contextualized = archiveLargeUpdateFileArguments(history, config);
    const originalContent = history[0]?.parts?.[0]?.functionCall?.args?.content;
    const reference = contextualized[0]?.parts?.[0]?.functionCall?.args
      ?.content as string;
    const artifactId = reference.match(/[a-f0-9]{64}\.txt/)?.[0];

    expect(originalContent).toBe(source);
    expect(reference).toStartWith(CONTEXT_ARTIFACT_PREFIX);
    expect(artifactId).toBeDefined();
    expect(readContextArtifact(artifactId!, config)).toBe(source);
    expect(
      await readFile(
        path.join(rootPath, "sky-database-id", artifactId!),
        "utf-8",
      ),
    ).toBe(source);

    expect(
      archiveLargeUpdateFileArguments(contextualized, config),
    ).toEqual(contextualized);
  });

  test("leaves short and non-update tool arguments unchanged", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "sky-context-"));
    directories.push(rootPath);
    const history: Content[] = [
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "updateFile",
              args: { filePath: "src/App.tsx", content: "short" },
            },
          },
          {
            functionCall: {
              name: "executeBash",
              args: { fullCommand: "x".repeat(200) },
            },
          },
        ],
      },
    ];

    expect(
      archiveLargeUpdateFileArguments(history, {
        rootPath,
        databaseProjectId: "database-id",
      }),
    ).toEqual(history);
  });

  test("rejects artifact path traversal", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "sky-context-"));
    directories.push(rootPath);

    expect(() =>
      readContextArtifact("../outside.txt", {
        rootPath,
        databaseProjectId: "database-id",
      }),
    ).toThrow("Invalid context artifact ID");
  });
});
