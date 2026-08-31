const MAX_AUDIT_CHARACTERS = 64_000;
const SECRET_KEY = /(?:password|secret|token|api[_-]?key|authorization|cookie)/i;

function redactAuditString(value: string): string {
  return value
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(
      /((?:password|secret|token|api[_-]?key|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}

// Serialize diagnostic evidence without allowing one tool response to flood the DB.
export function serializeAuditPayload(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, (key, item) => {
      if (SECRET_KEY.test(key)) return "[REDACTED]";
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "string") return redactAuditString(item);
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      return item;
    }) ?? "null";
  } catch (error) {
    serialized = JSON.stringify({
      serializationError: error instanceof Error ? error.message : String(error),
      value: String(value),
    });
  }

  if (serialized.length <= MAX_AUDIT_CHARACTERS) return serialized;
  return JSON.stringify({
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, MAX_AUDIT_CHARACTERS),
  });
}
