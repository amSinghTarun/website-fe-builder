import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Content } from "@google/genai";
import { toRuntimeId } from "@sky/runtime-id";

export const CONTEXT_ARTIFACT_PREFIX = "[SKY_CONTEXT_ARTIFACT:";
const LEGACY_CONTEXT_REFERENCE = "Read file at /root/.loveable-contest/";
const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}\.txt$/;

export interface ContextArchiveConfig {
  rootPath: string;
  databaseProjectId: string;
}

export function getContextArchiveConfig(
  workspacePath = process.env["WORKSPACE_PATH"]?.trim() || process.cwd(),
): ContextArchiveConfig | undefined {
  const databaseProjectId = process.env["DATABASE_PROJECT_ID"]?.trim();
  if (!databaseProjectId) return undefined;

  return {
    databaseProjectId,
    rootPath:
      process.env["CONTEXT_ARCHIVE_PATH"]?.trim() ||
      path.resolve(workspacePath, "..", ".sky-agent-context"),
  };
}

function projectArchivePath(config: ContextArchiveConfig): string {
  return path.join(config.rootPath, toRuntimeId(config.databaseProjectId));
}

export function archiveContextArtifact(
  content: string,
  config: ContextArchiveConfig,
): string {
  const artifactId = `${createHash("sha256").update(content).digest("hex")}.txt`;
  const directory = projectArchivePath(config);
  const artifactPath = path.join(directory, artifactId);

  mkdirSync(directory, { recursive: true });
  if (!existsSync(artifactPath)) writeFileSync(artifactPath, content, "utf-8");

  return artifactId;
}

export function readContextArtifact(
  artifactId: string,
  config: ContextArchiveConfig,
): string {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new Error("Invalid context artifact ID");
  }

  return readFileSync(
    path.join(projectArchivePath(config), artifactId),
    "utf-8",
  );
}

export function contextArtifactReference(
  artifactId: string,
  filePath: string,
): string {
  return `${CONTEXT_ARTIFACT_PREFIX}${artifactId}] The previous full updateFile content for ${filePath} is archived on the project volume. Call readContextArtifact with this artifactId only if the historical content is needed. Call readFileContent for the file's current contents. Never use this reference as file content.`;
}

export function isContextArtifactReference(content: string): boolean {
  return (
    content.includes(CONTEXT_ARTIFACT_PREFIX) ||
    content.includes(LEGACY_CONTEXT_REFERENCE)
  );
}

export function archiveLargeUpdateFileArguments(
  history: Content[],
  config: ContextArchiveConfig,
  minimumLength = 150,
): Content[] {
  const contextualizedHistory = structuredClone(history);

  for (const message of contextualizedHistory) {
    if (message.role === "user" || !message.parts) continue;

    for (const part of message.parts) {
      if (part.functionCall?.name !== "updateFile") continue;

      const args = part.functionCall.args;
      const content = args?.content;
      if (
        typeof content !== "string" ||
        content.length <= minimumLength ||
        isContextArtifactReference(content)
      ) {
        continue;
      }

      const artifactId = archiveContextArtifact(content, config);
      const filePath =
        typeof args?.filePath === "string" ? args.filePath : "the target file";
      args!.content = contextArtifactReference(artifactId, filePath);
    }
  }

  return contextualizedHistory;
}
