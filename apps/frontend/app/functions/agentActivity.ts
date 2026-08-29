export type AgentStreamEvent = {
  type: string;
  response?: unknown;
  uuid?: string;
};

export type AgentQuestion = {
  id: string;
  question: string;
};

export type ToolActivity = {
  id: string;
  phase: "started" | "completed" | "failed";
  summary: string;
};

export type AgentActivityStatus = "active" | "complete" | "error";

export type AgentActivityItem = {
  id: string;
  label: string;
  status: AgentActivityStatus;
};

export type AgentActivityState = {
  items: AgentActivityItem[];
  sequence: number;
};

export const emptyAgentActivity: AgentActivityState = {
  items: [],
  sequence: 0,
};

function responseText(response: unknown): string {
  if (typeof response === "string") return response;
  if (response == null) return "";

  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

export function parseToolActivity(response: unknown): ToolActivity | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }

  const value = response as Record<string, unknown>;
  const id = responseText(value.id).trim();
  const phase = responseText(value.phase).trim();
  const summary = responseText(value.summary).trim();
  if (
    !id ||
    !summary ||
    !["started", "completed", "failed"].includes(phase)
  ) {
    return null;
  }

  return {
    id,
    phase: phase as ToolActivity["phase"],
    summary,
  };
}

export function parseAgentQuestions(response: unknown): AgentQuestion[] {
  const value =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>).questions ?? response
      : response;
  const entries = Array.isArray(value) ? value : [value];

  return entries.flatMap((entry, index) => {
    if (typeof entry === "string" && entry.trim()) {
      return [{ id: `question-${index + 1}`, question: entry.trim() }];
    }

    if (!entry || typeof entry !== "object") return [];

    const question = entry as Record<string, unknown>;
    const text = responseText(question.question).trim();
    if (!text) return [];

    return [
      {
        id: responseText(question.id).trim() || `question-${index + 1}`,
        question: text,
      },
    ];
  });
}

function planItems(response: unknown): Array<{ id: string; task: string }> {
  const entries = Array.isArray(response) ? response : [response];

  return entries.flatMap((entry, index) => {
    if (typeof entry === "string") {
      return [{ id: String(index + 1), task: entry }];
    }

    if (!entry || typeof entry !== "object") return [];

    const item = entry as Record<string, unknown>;
    const id = responseText(item.id) || String(index + 1);
    const task = responseText(item.task ?? item.title ?? item.description);
    return task ? [{ id, task }] : [];
  });
}

function runtimeLabel(response: unknown): {
  label: string;
  status: AgentActivityStatus;
} {
  const runtime =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const status = responseText(runtime.status) || "unknown";
  const reason = responseText(runtime.reason);

  switch (status) {
    case "running":
      return { label: "Preview is running", status: "complete" };
    case "provisioning":
      return { label: "Provisioning the preview runtime", status: "active" };
    case "starting":
      return { label: reason || "Starting the preview runtime", status: "active" };
    case "unhealthy":
    case "crashed":
      return {
        label: reason
          ? `Preview check failed: ${reason}. Attempting a repair`
          : "Preview check failed. Attempting a repair",
        status: "active",
      };
    default:
      return {
        label: reason || `Preview runtime status: ${status}`,
        status: "active",
      };
  }
}

function upsert(
  items: AgentActivityItem[],
  next: AgentActivityItem,
): AgentActivityItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];

  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

export function reduceAgentActivity(
  state: AgentActivityState,
  event: AgentStreamEvent,
): AgentActivityState {
  if (event.type === "message" || event.type === "toolActivity") return state;

  if (event.type === "plan") {
    const steps = planItems(event.response).map((step) => ({
      id: `plan-${step.id}`,
      label: step.task,
      status: "active" as const,
    }));

    return {
      ...state,
      items: [
        ...state.items.filter((item) => !item.id.startsWith("plan-")),
        ...steps,
      ],
    };
  }

  if (event.type === "planAppend") {
    const steps = planItems(event.response).map((step) => ({
      id: `plan-${step.id}`,
      label: step.task,
      status: "active" as const,
    }));

    return {
      ...state,
      items: steps.reduce(
        (items, step) =>
          items.some((item) => item.id === step.id)
            ? items
            : [...items, step],
        state.items,
      ),
    };
  }

  if (event.type === "planComplete") {
    const id = `plan-${responseText(event.response)}`;
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === id ? { ...item, status: "complete" } : item,
      ),
    };
  }

  if (event.type === "runtime") {
    return {
      ...state,
      items: upsert(state.items, { id: "runtime", ...runtimeLabel(event.response) }),
    };
  }

  if (event.type === "runtimeBlocked") {
    return {
      ...state,
      items: upsert(state.items, {
        id: "runtime",
        label: "Preview remains unhealthy after automatic repair attempts",
        status: "error",
      }),
    };
  }

  if (event.type === "error") {
    return {
      ...state,
      items: upsert(state.items, {
        id: "agent-error",
        label: responseText(event.response) || "The agent encountered an error",
        status: "error",
      }),
    };
  }

  if (event.type === "stopped") {
    return {
      ...state,
      items: upsert(state.items, {
        id: "agent-stopped",
        label: responseText(event.response) || "Generation stopped by user",
        status: "complete",
      }),
    };
  }

  if (event.type === "Created a sub agent") {
    const id = responseText(event.response);
    return {
      ...state,
      items: upsert(state.items, {
        id: `sub-agent-${id}`,
        label: `Started sub-agent ${id}`,
        status: "active",
      }),
    };
  }

  if (
    event.type === "subAgentFinished" ||
    // Compatibility with events emitted by already-running older agent pods.
    event.type === "waitingForAgent"
  ) {
    const result =
      event.response &&
      typeof event.response === "object" &&
      !Array.isArray(event.response)
        ? (event.response as Record<string, unknown>)
        : undefined;
    const id = responseText(result?.id ?? event.response);
    return {
      ...state,
      items: upsert(state.items, {
        id: `sub-agent-${id}`,
        label: `Sub-agent ${id} finished`,
        status: "complete",
      }),
    };
  }

  if (event.type === "subAgentFailed") {
    const result =
      event.response &&
      typeof event.response === "object" &&
      !Array.isArray(event.response)
        ? (event.response as Record<string, unknown>)
        : {};
    const id = responseText(result.id) || "unknown";
    const status = responseText(result.status);
    return {
      ...state,
      items: upsert(state.items, {
        id: `sub-agent-${id}`,
        label:
          status === "MERGE_CONFLICT"
            ? `Sub-agent ${id} has merge conflicts`
            : `Sub-agent ${id} failed`,
        status: "error",
      }),
    };
  }

  if (event.type === "askInput") {
    const questions = parseAgentQuestions(event.response);
    return {
      ...state,
      items: upsert(state.items, {
        id: `question-${event.uuid ?? "current"}`,
        label:
          questions.length === 1
            ? `Waiting for your response: ${questions[0]!.question}`
            : `Waiting for your responses to ${questions.length} questions`,
        status: "active",
      }),
    };
  }

  const nextSequence = state.sequence + 1;
  const label = responseText(event.response);
  return {
    sequence: nextSequence,
    items: [
      ...state.items,
      {
        id: `event-${nextSequence}`,
        label: label ? `${event.type}: ${label}` : event.type,
        status: "active",
      },
    ],
  };
}
