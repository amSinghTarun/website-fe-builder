import type { AppRuntimeState } from "./AppRuntimeMonitor";

function bounded(value: string | undefined, maxLength = 8_000): string {
  if (!value) return "Not available";
  return value.length <= maxLength
    ? value
    : `[truncated]\n${value.slice(-maxLength)}`;
}

export function formatRuntimeObservation(state: AppRuntimeState): string {
  if (state.status === "running") {
    return `[AUTHORITATIVE RUNTIME OBSERVATION]
    Status: running
    HTTP status: ${state.httpStatus ?? "healthy"}

    Kubernetes readiness, strict frontend lint, and a real browser render passed.
    Treat these checks as authoritative for this turn. Do not ask the user to
    inspect DevTools, provide console output, run commands, or reinstall the
    toolchain. Do not make speculative file changes merely to demonstrate
    activity. If the user reports a more specific symptom, investigate it with
    the available project tools.
    [/AUTHORITATIVE RUNTIME OBSERVATION]
  `;
  }

  return `[AUTHORITATIVE RUNTIME OBSERVATION]
    Status: ${state.status}
    Reason: ${state.reason ?? "Unknown"}
    HTTP status: ${state.httpStatus ?? "Not available"}
    HTTP diagnostic:
    ${bounded(state.httpErrorBody)}

    Recent application logs:
    ${bounded(state.logs)}

    The generated application is not healthy. Diagnose this evidence and repair
    the application before completing the task.
    [/AUTHORITATIVE RUNTIME OBSERVATION]
  `;
}
