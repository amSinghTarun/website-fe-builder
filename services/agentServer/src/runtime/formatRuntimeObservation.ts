import type { AppRuntimeState } from "./AppRuntimeMonitor";

function bounded(value: string | undefined, maxLength = 8_000): string {
  if (!value) return "Not available";
  return value.length <= maxLength
    ? value
    : `[truncated]\n${value.slice(-maxLength)}`;
}

export function formatRuntimeObservation(state: AppRuntimeState): string {
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
