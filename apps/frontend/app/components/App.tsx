import {
  Sparkles,
  Loader2,
  Eye,
  Code2,
  CheckCircle2,
  Circle,
  AlertCircle,
  Square,
  FileCode2,
  RefreshCw,
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { apiUrl } from "../config";
import { createClientId } from "../functions/clientId";
import {
  emptyAgentActivity,
  parseAgentQuestions,
  parseToolActivity,
  reduceAgentActivity,
  type AgentQuestion,
  type AgentActivityState,
  type AgentStreamEvent,
  type ToolActivity,
} from "../functions/agentActivity";
import {
  mapChatHistory,
  type ChatMessage,
  type PersistedChatRecord,
} from "../functions/chatHistory";

type PendingAgentInput = {
  uuid: string;
  questions: AgentQuestion[];
};

type ProjectFile = {
  path: string;
  content: string;
  size: number;
};

function runtimeStartupSummary(runtime: {
  workspaceReady?: boolean;
  agentReady?: boolean;
}): string {
  if (runtime.workspaceReady && !runtime.agentReady) {
    return "Preview is ready; waiting for the coding agent";
  }
  if (!runtime.workspaceReady && runtime.agentReady) {
    return "Coding agent is ready; waiting for the preview";
  }
  return "Starting the preview and coding agent";
}

const SUGGESTIONS = [
  "A kanban board with drag and drop",
  "A landing page for a coffee subscription",
  "A dashboard with charts and a data table",
];

export function App() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const projectId = searchParams.get("project");
  const nameFromUrl = searchParams.get("name");
  const resumeRequested = searchParams.get("resume") === "1";

  const [resolvedName, setResolvedName] = useState<string | null>(nameFromUrl);
  const [loadingName, setLoadingName] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoad, setHistoryLoad] = useState<{
    projectId: string | null;
    status: "loading" | "loaded" | "error";
  }>({ projectId: null, status: "loading" });
  const historyStatus =
    historyLoad.projectId === projectId ? historyLoad.status : "loading";
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [agentActivity, setAgentActivity] =
    useState<AgentActivityState>(emptyAgentActivity);
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null);
  const [pendingAgentInput, setPendingAgentInput] =
    useState<PendingAgentInput | null>(null);
  const [agentAnswers, setAgentAnswers] = useState<Record<string, string>>({});
  const [submittingAgentInput, setSubmittingAgentInput] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<
    "idle" | "starting" | "ready" | "error"
  >(resumeRequested ? "starting" : "idle");

  const scrollRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const toolActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const loadProjectFiles = useCallback(async () => {
    if (!projectId) return;

    setLoadingFiles(true);
    setFileError(null);
    try {
      const response = await fetch(
        apiUrl(
          `/getServerFilesAndCode?projectId=${encodeURIComponent(projectId)}`,
        ),
        { credentials: "include" },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          result?.message || result?.error || "Unable to load files",
        );
      }

      const files = (result?.data ?? []) as ProjectFile[];
      setProjectFiles(files);
      setSelectedFilePath((current) => {
        if (current && files.some((file) => file.path === current))
          return current;
        return (
          files.find((file) =>
            /(^|\/)src\/App\.(tsx|ts|jsx|js)$/.test(file.path),
          )?.path ??
          files[0]?.path ??
          null
        );
      });
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Unable to load files",
      );
    } finally {
      setLoadingFiles(false);
    }
  }, [projectId]);

  // Always load project metadata. The URL can provide a name immediately, but
  // only the API knows whether this project already has a preview runtime.
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const fetchProject = async () => {
      setLoadingName(true);
      if (nameFromUrl) setResolvedName(nameFromUrl);
      try {
        const res = await fetch(apiUrl("/projects"), {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load project");

        const json = await res.json();
        const match = (json.data ?? []).find(
          (p: {
            id: string;
            title: string;
            initialPrompt?: string | null;
            workspaceUrl?: string;
          }) => p.id === projectId,
        );
        if (!cancelled) {
          setResolvedName(match ? match.title : null);
          if (!resumeRequested) {
            setPreviewUrl(
              match?.initialPrompt ? (match.workspaceUrl ?? null) : null,
            );
          }
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoadingName(false);
      }
    };

    void fetchProject();
    return () => {
      cancelled = true;
    };
  }, [nameFromUrl, projectId, resumeRequested]);

  useEffect(() => {
    if (!projectId || !resumeRequested) {
      setResumeStatus("idle");
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let nextPoll: ReturnType<typeof setTimeout> | null = null;

    setResumeStatus("starting");
    setPreviewUrl(null);
    setProjectFiles([]);
    setSelectedFilePath(null);
    setFileError(null);

    const pollRuntime = async () => {
      attempts += 1;

      try {
        const response = await fetch(
          apiUrl(`/runtimeStatus?projectId=${encodeURIComponent(projectId)}`),
          { credentials: "include" },
        );
        const result = await response.json().catch(() => null);

        if (response.status === 401 || response.status === 404) {
          throw new Error(result?.message || "Project runtime is unavailable");
        }

        if (response.ok && result?.data?.status === "ready") {
          if (cancelled) return;
          setPreviewUrl(result.data.workspaceUrl ?? null);
          setPreviewRevision((current) => current + 1);
          setResumeStatus("ready");
          void loadProjectFiles();
          return;
        }

        if (attempts >= 60) {
          throw new Error("The project runtime did not become ready in time");
        }

        if (!cancelled) nextPoll = setTimeout(() => void pollRuntime(), 2_000);
      } catch (error) {
        if (cancelled) return;

        if (
          attempts < 60 &&
          !(
            error instanceof Error &&
            /not found|unavailable/i.test(error.message)
          )
        ) {
          nextPoll = setTimeout(() => void pollRuntime(), 2_000);
          return;
        }

        setResumeStatus("error");
        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to restore project runtime",
        );
      }
    };

    void pollRuntime();

    return () => {
      cancelled = true;
      if (nextPoll) clearTimeout(nextPoll);
    };
  }, [loadProjectFiles, projectId, resumeRequested]);

  // Load conversation history whenever a project is selected
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const fetchHistory = async () => {
      setMessages([]);
      setHistoryLoad({ projectId, status: "loading" });
      try {
        const res = await fetch(
          apiUrl(`/chat?projectId=${encodeURIComponent(projectId)}`),
          { credentials: "include" },
        );

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to load conversation");
        }

        const json = await res.json();
        const records: PersistedChatRecord[] = json.data ?? [];

        if (!cancelled) {
          setMessages(mapChatHistory(records));
          setHistoryLoad({ projectId, status: "loaded" });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setHistoryLoad({ projectId, status: "error" });
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast.error(msg);
        }
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isGenerating, pendingAgentInput, toolActivity]);

  // The agent stream cannot emit tool activity until its pod is reachable.
  // Poll runtime readiness so startup progress replaces the generic loader too.
  useEffect(() => {
    if (!projectId || !isGenerating) {
      setToolActivity((current) =>
        current?.id === "runtime-startup" ? null : current,
      );
      return;
    }

    let cancelled = false;
    let nextPoll: ReturnType<typeof setTimeout> | null = null;

    const pollRuntime = async () => {
      try {
        const response = await fetch(
          apiUrl(`/runtimeStatus?projectId=${encodeURIComponent(projectId)}`),
          { credentials: "include" },
        );
        const result = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !result?.data) {
          throw new Error("Runtime status is temporarily unavailable");
        }

        const runtime = result.data as {
          workspaceReady?: boolean;
          agentReady?: boolean;
        };
        const ready = runtime.workspaceReady && runtime.agentReady;
        setToolActivity((current) =>
          current && current.id !== "runtime-startup"
            ? current
            : {
                id: "runtime-startup",
                phase: ready ? "completed" : "started",
                summary: ready
                  ? "Preview and coding agent are ready"
                  : runtimeStartupSummary(runtime),
              },
        );

        if (ready) return;
      } catch {
        // The next poll will retry while the generation request remains active.
      }

      if (!cancelled) nextPoll = setTimeout(() => void pollRuntime(), 2_000);
    };

    void pollRuntime();
    return () => {
      cancelled = true;
      if (nextPoll) clearTimeout(nextPoll);
    };
  }, [isGenerating, projectId]);

  useEffect(
    () => () => {
      generationAbortRef.current?.abort();
      if (toolActivityTimerRef.current) {
        clearTimeout(toolActivityTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeTab === "code" && !isGenerating) {
      void loadProjectFiles();
    }
  }, [activeTab, isGenerating, loadProjectFiles]);

  const isFirstMessage = historyStatus === "loaded" && messages.length === 0;
  const selectedFile =
    projectFiles.find((file) => file.path === selectedFilePath) ?? null;

  const consumeAgentResponse = useCallback(async (response: Response) => {
    if (!response.body) throw new Error("The project agent returned no stream");

    const assistantId = createClientId();
    let assistantStarted = false;
    let streamError: string | null = null;
    let streamStopped = false;
    let streamBlocked = false;
    let buffer = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const consumeEvent = (event: string) => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;

      const chunk = JSON.parse(data) as AgentStreamEvent;

      if (chunk.type === "toolActivity") {
        const activity = parseToolActivity(chunk.response);
        if (activity) {
          if (toolActivityTimerRef.current) {
            clearTimeout(toolActivityTimerRef.current);
            toolActivityTimerRef.current = null;
          }
          setToolActivity(activity);

          if (activity.phase !== "started") {
            toolActivityTimerRef.current = setTimeout(() => {
              setToolActivity((current) =>
                current?.id === activity.id ? null : current,
              );
              toolActivityTimerRef.current = null;
            }, 2_000);
          }
        }
      }

      if (chunk.type === "message" && typeof chunk.response === "string") {
        if (!assistantStarted) {
          assistantStarted = true;
          setMessages((previous) => [
            ...previous,
            {
              id: assistantId,
              from: "assistant",
              message: chunk.response! as string,
            },
          ]);
        } else {
          setMessages((previous) =>
            previous.map((entry) =>
              entry.id === assistantId
                ? { ...entry, message: entry.message + chunk.response }
                : entry,
            ),
          );
        }
      }

      if (chunk.type === "runtimeBlocked") {
        streamBlocked = true;
        toast.error(
          "The generated app is still unhealthy after automatic repairs.",
        );
      }

      if (chunk.type !== "message" && chunk.type !== "toolActivity") {
        setAgentActivity((previous) => reduceAgentActivity(previous, chunk));
      }

      if (
        chunk.type === "runtime" &&
        chunk.response &&
        typeof chunk.response === "object" &&
        "status" in chunk.response &&
        chunk.response.status === "running"
      ) {
        setPreviewRevision((current) => current + 1);
      }

      if (chunk.type === "askInput" && chunk.uuid) {
        const questions = parseAgentQuestions(chunk.response);
        if (questions.length > 0) {
          setPendingAgentInput({ uuid: chunk.uuid, questions });
          setAgentAnswers(
            Object.fromEntries(questions.map((question) => [question.id, ""])),
          );
        }
      }

      if (chunk.type === "error") {
        streamError =
          typeof chunk.response === "string"
            ? chunk.response
            : "The project agent encountered an error";
      }

      if (chunk.type === "stopped") streamStopped = true;
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      events.forEach(consumeEvent);

      if (done) break;
    }

    if (buffer.trim()) consumeEvent(buffer);
    if (streamError) throw new Error(streamError);
    if (!assistantStarted && !streamStopped && !streamBlocked) {
      setMessages((previous) => [
        ...previous,
        {
          id: assistantId,
          from: "assistant",
          message: "The project update completed.",
        },
      ]);
    }
  }, []);

  const streamAgentMessage = async (prompt: string, signal: AbortSignal) => {
    const response = await fetch(apiUrl("/sendUserMessage"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, message: prompt }),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || "The project agent could not start");
    }

    await consumeAgentResponse(response);
  };

  // Reattach to an in-progress run after refresh without resending its prompt.
  useEffect(() => {
    if (!projectId || historyStatus !== "loaded") return;

    const reconnectController = new AbortController();
    let attached = false;

    const reconnect = async () => {
      try {
        const response = await fetch(
          apiUrl(
            `/agentRunStream?projectId=${encodeURIComponent(projectId)}`,
          ),
          {
            credentials: "include",
            signal: reconnectController.signal,
          },
        );

        if (response.status === 204) return;
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(error?.message || "Unable to reconnect to the agent");
        }

        attached = true;
        generationAbortRef.current = reconnectController;
        setAgentActivity(emptyAgentActivity);
        setIsGenerating(true);
        await consumeAgentResponse(response);
        setPreviewRevision((current) => current + 1);
      } catch (error) {
        if (!reconnectController.signal.aborted) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to reconnect to the agent",
          );
        }
      } finally {
        if (attached) {
          if (generationAbortRef.current === reconnectController) {
            generationAbortRef.current = null;
          }
          setIsGenerating(false);
          setIsStopping(false);
        }
      }
    };

    void reconnect();
    return () => reconnectController.abort();
  }, [consumeAgentResponse, historyStatus, projectId]);

  const sendPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    if (historyStatus !== "loaded") {
      toast.error("Wait for the saved conversation to finish loading.");
      return;
    }

    if (!projectId) {
      toast.error(
        "Missing project — go back and start or resume a project first.",
      );
      return;
    }

    const userMessage: ChatMessage = {
      id: createClientId(),
      from: "user",
      message: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setAgentActivity(emptyAgentActivity);
    if (toolActivityTimerRef.current) {
      clearTimeout(toolActivityTimerRef.current);
      toolActivityTimerRef.current = null;
    }
    setToolActivity(null);
    setPendingAgentInput(null);
    setAgentAnswers({});
    setMessage("");
    stopRequestedRef.current = false;
    const generationController = new AbortController();
    generationAbortRef.current = generationController;
    setIsGenerating(true);

    try {
      if (isFirstMessage) {
        const res = await fetch(apiUrl("/newChat"), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, initialPrompt: trimmed }),
          signal: generationController.signal,
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to start chat");
        }

        const json = await res.json();
        setPreviewUrl(json.data?.workspaceUrl ?? null);
      }

      if (stopRequestedRef.current) return;
      await streamAgentMessage(trimmed, generationController.signal);
      setPreviewRevision((current) => current + 1);
    } catch (err: unknown) {
      if (stopRequestedRef.current || generationController.signal.aborted)
        return;
      const errMessage =
        err instanceof Error ? err.message : "Something went wrong";
      setPendingAgentInput(null);
      setAgentAnswers({});
      setAgentActivity((previous) =>
        reduceAgentActivity(previous, {
          type: "error",
          response: errMessage,
        }),
      );
      toast.error(errMessage);
    } finally {
      if (generationAbortRef.current === generationController) {
        generationAbortRef.current = null;
      }
      setIsGenerating(false);
      setIsStopping(false);
    }
  };

  const stopGeneration = async () => {
    if (!projectId || !isGenerating || isStopping) return;

    setIsStopping(true);
    stopRequestedRef.current = true;
    setPendingAgentInput(null);
    setAgentAnswers({});
    setSubmittingAgentInput(false);
    if (toolActivityTimerRef.current) {
      clearTimeout(toolActivityTimerRef.current);
      toolActivityTimerRef.current = null;
    }
    setToolActivity(null);
    setAgentActivity((previous) =>
      reduceAgentActivity(previous, {
        type: "stopped",
        response: "Generation stopped by user.",
      }),
    );

    const stopRequest = fetch(apiUrl("/stop"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    generationAbortRef.current?.abort();

    try {
      const response = await stopRequest;
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Unable to stop generation");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to stop generation",
      );
    } finally {
      setIsStopping(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPrompt(message);
  };

  const submitAgentInput = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !pendingAgentInput || submittingAgentInput) return;

    const unanswered = pendingAgentInput.questions.some(
      (question) => !agentAnswers[question.id]?.trim(),
    );
    if (unanswered) {
      toast.error("Please answer every question before continuing.");
      return;
    }

    const answer = pendingAgentInput.questions
      .map((question) => `${question.id}: ${agentAnswers[question.id]!.trim()}`)
      .join("\n");
    const requestUuid = pendingAgentInput.uuid;

    setSubmittingAgentInput(true);
    try {
      const response = await fetch(apiUrl("/continue"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          uuid: requestUuid,
          message: answer,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "Unable to send your response");
      }

      setPendingAgentInput(null);
      setAgentAnswers({});
      setAgentActivity((previous) => ({
        ...previous,
        items: previous.items.map((item) =>
          item.id === `question-${requestUuid}`
            ? {
                ...item,
                label: "Your response was sent to the agent",
                status: "complete",
              }
            : item,
        ),
      }));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send your response",
      );
    } finally {
      setSubmittingAgentInput(false);
    }
  };

  return (
    <div className="bg-[#070707] text-white w-screen h-screen flex flex-col">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-size-[48px_48px]" />

      <nav className="relative z-10 h-16 px-10 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={() => navigate("/")}
          aria-label="Go to SKY home"
          className="flex items-center gap-3 cursor-pointer"
        >
          <Sparkles className="text-cyan-400" size={18} />
          <h1 className="font-black tracking-[0.25em] text-lg">SKY</h1>
        </button>
        <div className="flex gap-3">
          {user && (
            <button className="px-4 py-1.5 text-sm border border-cyan-300 text-cyan-300 transition cursor-pointer">
              {user.username.toUpperCase()}
            </button>
          )}
        </div>
      </nav>

      <main className="overflow-hidden relative flex flex-1 flex-row p-3 gap-3">
        <section className="w-[35%]">
          <div className="h-full flex flex-col border border-stone-900 rounded-lg p-3 gap-3">
            <div className="flex w-fit max-w-full px-4 h-10 text-cyan-300 backdrop-blur-2xl items-center rounded-lg truncate">
              {loadingName ? (
                <span className="flex items-center gap-2 text-sm">
                  <Loader2 size={13} className="animate-spin" /> Loading...
                </span>
              ) : (
                (resolvedName?.toUpperCase() ?? "UNTITLED PROJECT")
              )}
            </div>

            <div
              ref={scrollRef}
              className="h-full flex-1 flex flex-col gap-2 overflow-y-auto"
            >
              {historyStatus === "loading" && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading
                  conversation...
                </div>
              )}

              {historyStatus === "error" && (
                <div className="flex-1 flex items-center justify-center px-6 text-center text-sm text-red-400">
                  The saved conversation could not be loaded. Reopen the project
                  to retry.
                </div>
              )}

              {historyStatus === "loaded" &&
                messages.length === 0 &&
                !isGenerating && (
                  <div className="flex-1 flex flex-col justify-center gap-3">
                    <p className="text-zinc-600 text-xs uppercase tracking-[0.2em] mb-1">
                      Try something like
                    </p>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => sendPrompt(s)}
                        className="text-left text-sm text-zinc-400 border border-zinc-900 rounded-lg px-3 py-2 hover:border-cyan-400/40 hover:text-cyan-300 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

              {historyStatus === "loaded" &&
                messages.map((m) =>
                  m.from === "user" ? (
                    <div key={m.id} className="w-full flex justify-end">
                      <div className="w-fit max-w-[85%] p-2 px-3 text-right rounded-lg rounded-br-none bg-cyan-300 text-black text-sm">
                        {m.message}
                      </div>
                    </div>
                  ) : m.from === "assistant" ? (
                    <div key={m.id} className="w-full flex justify-start">
                      <div className="w-fit max-w-[85%] p-2 px-3 rounded-lg rounded-bl-none bg-zinc-900 text-zinc-200 text-sm">
                        {m.message}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="w-full flex justify-start">
                      <div
                        className={`w-fit max-w-[85%] rounded-lg border px-3 py-2 text-xs ${
                          m.tone === "error"
                            ? "border-red-900/70 bg-red-950/30 text-red-300"
                            : m.tone === "warning"
                              ? "border-amber-900/70 bg-amber-950/30 text-amber-300"
                              : "border-zinc-800 bg-zinc-950 text-zinc-500"
                        }`}
                      >
                        {m.message}
                      </div>
                    </div>
                  ),
                )}

              {agentActivity.items.length > 0 && (
                <div className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Build activity
                  </p>
                  <div className="flex flex-col gap-2">
                    {agentActivity.items.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-2 text-xs ${
                          item.status === "error"
                            ? "text-red-400"
                            : item.status === "complete"
                              ? "text-emerald-400"
                              : "text-zinc-400"
                        }`}
                      >
                        {item.status === "error" ? (
                          <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        ) : item.status === "complete" ? (
                          <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                        ) : isGenerating ? (
                          <Loader2
                            size={13}
                            className="mt-0.5 shrink-0 animate-spin"
                          />
                        ) : (
                          <Circle size={13} className="mt-0.5 shrink-0" />
                        )}
                        <span className="leading-4">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendingAgentInput && (
                <form
                  onSubmit={submitAgentInput}
                  className="w-full rounded-lg border border-cyan-400/40 bg-cyan-400/5 p-3"
                >
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                    Agent needs your input
                  </p>
                  <div className="flex flex-col gap-3">
                    {pendingAgentInput.questions.map((question) => (
                      <label
                        key={question.id}
                        className="flex flex-col gap-1.5"
                      >
                        <span className="text-xs leading-4 text-zinc-300">
                          {question.question}
                        </span>
                        <textarea
                          value={agentAnswers[question.id] ?? ""}
                          onChange={(event) =>
                            setAgentAnswers((previous) => ({
                              ...previous,
                              [question.id]: event.target.value,
                            }))
                          }
                          rows={2}
                          disabled={submittingAgentInput}
                          className="resize-y rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-xs text-white outline-none transition focus:border-cyan-300 disabled:opacity-50"
                          placeholder="Type your answer..."
                        />
                      </label>
                    ))}
                    <button
                      type="submit"
                      disabled={
                        submittingAgentInput ||
                        pendingAgentInput.questions.some(
                          (question) => !agentAnswers[question.id]?.trim(),
                        )
                      }
                      className="flex items-center justify-center gap-2 rounded-md border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-300 hover:text-black disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cyan-300"
                    >
                      {submittingAgentInput && (
                        <Loader2 size={13} className="animate-spin" />
                      )}
                      Send response
                    </button>
                  </div>
                </form>
              )}

              {isGenerating && (
                <div className="w-full flex justify-start">
                  <div
                    aria-live="polite"
                    className="flex w-fit max-w-full items-start gap-2 rounded-lg rounded-bl-none bg-zinc-900 p-2 px-3 text-sm text-cyan-300"
                  >
                    <Loader2
                      size={14}
                      className="mt-0.5 shrink-0 animate-spin"
                    />
                    {toolActivity?.summary && (
                      <span>{toolActivity.summary}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex border border-zinc-900 rounded-lg"
            >
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1 p-2 outline-none bg-transparent text-sm"
                placeholder="Type a message..."
                disabled={isGenerating || historyStatus !== "loaded"}
              />
              {isGenerating ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  disabled={isStopping}
                  className="flex items-center gap-1.5 px-3 text-red-400 transition hover:text-red-300 disabled:cursor-not-allowed disabled:text-zinc-700"
                >
                  {isStopping ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Square size={12} fill="currentColor" />
                  )}
                  <span className="text-xs font-semibold">Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!message.trim() || historyStatus !== "loaded"}
                  className="px-3 text-cyan-300 disabled:text-zinc-700 disabled:cursor-not-allowed"
                >
                  →
                </button>
              )}
            </form>
          </div>
        </section>

        <section className="flex-1">
          <div className="h-full w-full border border-stone-900 rounded-lg flex flex-col">
            <div className="flex items-center gap-1 p-2 border-b border-stone-900 shrink-0">
              <button
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  activeTab === "preview"
                    ? "bg-cyan-300 text-black"
                    : "text-zinc-500 hover:text-white"
                }`}
              >
                <Eye size={13} /> Preview
              </button>
              <button
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  activeTab === "code"
                    ? "bg-cyan-300 text-black"
                    : "text-zinc-500 hover:text-white"
                }`}
              >
                <Code2 size={13} /> Code
              </button>
              <div className="ml-2 min-w-0 flex-1">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={previewUrl}
                    className="block truncate rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:border-zinc-700 hover:text-cyan-300"
                  >
                    {previewUrl}
                  </a>
                )}
              </div>
              {activeTab === "code" && (
                <button
                  type="button"
                  onClick={() => void loadProjectFiles()}
                  disabled={loadingFiles || isGenerating}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    size={13}
                    className={loadingFiles ? "animate-spin" : ""}
                  />
                  Refresh files
                </button>
              )}
              {activeTab === "preview" && previewUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewRevision((current) => current + 1)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition hover:text-cyan-300"
                >
                  <RefreshCw size={13} />
                  Refresh preview
                </button>
              )}
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center">
              {resumeStatus === "starting" ? (
                <div className="max-w-sm px-6 text-center">
                  <Loader2
                    className="mx-auto mb-3 animate-spin text-cyan-300"
                    size={24}
                  />
                  <p className="text-sm text-zinc-300">
                    Restoring your project
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-600">
                    Recovering saved code and starting the preview and coding
                    agent.
                  </p>
                </div>
              ) : resumeStatus === "error" ? (
                <div className="max-w-sm px-6 text-center">
                  <AlertCircle
                    className="mx-auto mb-3 text-red-400"
                    size={24}
                  />
                  <p className="text-sm text-red-400">
                    The project could not be restored.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="mt-3 text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    Return home and try again
                  </button>
                </div>
              ) : activeTab === "code" ? (
                loadingFiles && projectFiles.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 size={14} className="animate-spin" /> Loading
                    generated files...
                  </div>
                ) : fileError && projectFiles.length === 0 ? (
                  <div className="max-w-sm px-6 text-center text-sm text-red-400">
                    {fileError}
                  </div>
                ) : projectFiles.length === 0 ? (
                  <div className="text-center text-sm text-zinc-600">
                    No generated source files are available yet.
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 w-full overflow-hidden rounded-b-lg bg-[#090909]">
                    <aside className="w-60 shrink-0 overflow-y-auto border-r border-stone-900 py-2">
                      <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                        Files · {projectFiles.length}
                      </div>
                      {projectFiles.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          title={file.path}
                          onClick={() => setSelectedFilePath(file.path)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ${
                            selectedFilePath === file.path
                              ? "bg-cyan-300/10 text-cyan-300"
                              : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
                          }`}
                        >
                          <FileCode2 size={13} className="shrink-0" />
                          <span className="truncate">{file.path}</span>
                        </button>
                      ))}
                    </aside>
                    <section className="flex min-w-0 flex-1 flex-col">
                      <div className="flex h-9 shrink-0 items-center justify-between border-b border-stone-900 px-3 text-xs text-zinc-500">
                        <span className="truncate">{selectedFile?.path}</span>
                        {selectedFile && (
                          <span className="ml-3 shrink-0 text-[10px] text-zinc-700">
                            {selectedFile.size.toLocaleString()} bytes
                          </span>
                        )}
                      </div>
                      <pre className="min-h-0 flex-1 overflow-auto p-4 text-xs leading-5 text-zinc-300">
                        <code>{selectedFile?.content ?? ""}</code>
                      </pre>
                    </section>
                  </div>
                )
              ) : previewUrl ? (
                <iframe
                  key={`${previewUrl}-${previewRevision}`}
                  title="app-preview"
                  className="w-full h-full rounded-b-lg bg-white"
                  src={previewUrl}
                />
              ) : historyStatus === "loaded" && messages.length === 0 ? (
                <div className="text-center text-zinc-600 text-sm">
                  <Sparkles className="mx-auto mb-3 text-zinc-700" size={24} />
                  Your app will appear here once you send a prompt.
                </div>
              ) : (
                <div className="text-center text-zinc-600 text-sm">
                  The preview will appear when the project runtime is ready.
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
