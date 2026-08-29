export const RUNTIME_ID_PREFIX = "sky-";

export function requireDatabaseProjectId(
  value = process.env["DATABASE_PROJECT_ID"],
): string {
  const databaseProjectId = value?.trim();

  if (!databaseProjectId) {
    throw new Error("DATABASE_PROJECT_ID is required");
  }

  return databaseProjectId;
}

export function toRuntimeId(databaseProjectId: string): string {
  const normalizedProjectId = databaseProjectId.trim();

  if (!normalizedProjectId) {
    throw new Error("databaseProjectId is required");
  }

  return `${RUNTIME_ID_PREFIX}${normalizedProjectId}`;
}
