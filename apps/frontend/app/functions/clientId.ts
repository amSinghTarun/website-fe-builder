export function createClientId(
  randomUuid: (() => string) | null | undefined =
    globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
): string {
  if (randomUuid) return randomUuid();

  return `message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
