export const RUNTIME_ID_PREFIX = "sky-";

/**
 * Converts the database project UUID into the prefix used by Kubernetes
 * resources and runtime routes.
 */
export function toRuntimeId(databaseProjectId: string): string {
  const normalizedProjectId = databaseProjectId.trim();

  if (!normalizedProjectId) {
    throw new Error("databaseProjectId is required");
  }

  return `${RUNTIME_ID_PREFIX}${normalizedProjectId}`;
}
