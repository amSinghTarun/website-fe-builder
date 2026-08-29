const pendingInputRequests = new Map<string, (message: string) => void>();

// Register a question that can be answered through the /continue route.
export function registerInputRequest(
  id: string,
  resolve: (message: string) => void,
): void {
  pendingInputRequests.set(id, resolve);
}

// Resolve an active question once; duplicate or stale answers are rejected.
export function resolveInputRequest(id: string, message: string): boolean {
  const resolve = pendingInputRequests.get(id);
  if (!resolve) return false;

  pendingInputRequests.delete(id);
  resolve(message);
  return true;
}

// Remove a question when its agent run finishes or is cancelled.
export function removeInputRequest(id: string): void {
  pendingInputRequests.delete(id);
}
