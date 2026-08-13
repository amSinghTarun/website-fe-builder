import {
  Sparkles,
  Loader2,
  Eye,
  Code2,
  CheckCircle2,
  Circle,
  AlertCircle,
  Square,
} from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { apiUrl } from "../config";
import { createClientId } from "../functions/clientId";
import {
  emptyAgentActivity,
  parseAgentQuestions,
  reduceAgentActivity,
  type AgentQuestion,
  type AgentActivityState,
  type AgentStreamEvent,
} from "../functions/agentActivity";

type ConversationType = string; // narrow this to your actual enum if exported
type MessageFrom = "USER" | "ASSISTANT";

type ChatRecord = {
  id: number;
  projectId: string;
  contents: string;
  type: ConversationType;
  from: MessageFrom;
  output: string | null;
  toolCall: unknown | null;
  completed: boolean | null;
  snapshotCaptured: boolean | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  from: "user" | "assistant";
  message: string;
};

type PendingAgentInput = {
  uuid: string;
  questions: AgentQuestion[];
};

const SUGGESTIONS = [
  "A kanban board with drag and drop",
  "A landing page for a coffee subscription",
  "A dashboard with charts and a data table",
];

export function App() {
  const user = useAuthStore((state) => state.user);
  const [searchParams] = useSearchParams();

  const projectId = searchParams.get("project");
  const nameFromUrl = searchParams.get("name");

  const [resolvedName, setResolvedName] = useState<string | null>(nameFromUrl);
  const [loadingName, setLoadingName] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] =
    useState<AgentActivityState>(emptyAgentActivity);
  const [pendingAgentInput, setPendingAgentInput] =
    useState<PendingAgentInput | null>(null);
  const [agentAnswers, setAgentAnswers] = useState<Record<string, string>>({});
  const [submittingAgentInput, setSubmittingAgentInput] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);

  // Resolve project name (URL param, or look up from /projects when resuming)
  useEffect(() => {
    if (nameFromUrl) {
      setResolvedName(nameFromUrl);
      return;
    }
    if (!projectId) return;

    let cancelled = false;

    const fetchProjectName = async () => {
      setLoadingName(true);
      try {
        // TODO: swap for GET /projects/:id once available
        const res = await fetch(apiUrl("/projects"), {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load project");

        const json = await res.json();
        const match = (json.data ?? []).find(
          (p: { id: string; title: string; workspaceUrl?: string }) =>
            p.id === projectId
        );
        if (!cancelled) {
          setResolvedName(match ? match.title : null);
          setPreviewUrl(match?.workspaceUrl ?? null);
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

    fetchProjectName();
    return () => {
      cancelled = true;
    };
  }, [nameFromUrl, projectId]);

  // Load conversation history whenever a project is selected
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const res = await fetch(
          apiUrl(`/chat?projectId=${encodeURIComponent(projectId)}`),
          { credentials: "include" }
        );

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to load conversation");
        }

        const json = await res.json();
        const records: ChatRecord[] = json.data ?? [];

        const sorted = [...records].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        const mapped: ChatMessage[] = sorted.flatMap((record) => {
          const entries: ChatMessage[] = [
            {
              id: String(record.id),
              from: record.from === "USER" ? "user" : "assistant",
              message: record.contents,
            },
          ];

          if (record.from === "USER" && record.output?.trim()) {
            entries.push({
              id: `${record.id}-output`,
              from: "assistant",
              message: record.output.trim(),
            });
          }

          return entries;
        });

        if (!cancelled) setMessages(mapped);
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isGenerating, pendingAgentInput]);

  useEffect(
    () => () => {
      generationAbortRef.current?.abort();
    },
    [],
  );

  const isFirstMessage = messages.length === 0;

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

    if (!response.body) throw new Error("The project agent returned no stream");

    const assistantId = createClientId();
    let assistantStarted = false;
    let streamError: string | null = null;
    let streamStopped = false;
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

      if (chunk.type === "message" && typeof chunk.response === "string") {
        if (!assistantStarted) {
          assistantStarted = true;
          setMessages((previous) => [
            ...previous,
            { id: assistantId, from: "assistant", message: chunk.response! as string },
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
        toast.error("The generated app is still unhealthy after automatic repairs.");
      }

      if (chunk.type !== "message") {
        setAgentActivity((previous) => reduceAgentActivity(previous, chunk));
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
    if (!assistantStarted && !streamStopped) {
      setMessages((previous) => [
        ...previous,
        {
          id: assistantId,
          from: "assistant",
          message: "The project update completed.",
        },
      ]);
    }
  };

  const sendPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    if (!projectId) {
      toast.error("Missing project — go back and start or resume a project first.");
      return;
    }

    const userMessage: ChatMessage = {
      id: createClientId(),
      from: "user",
      message: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setAgentActivity(emptyAgentActivity);
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
    } catch (err: unknown) {
      if (stopRequestedRef.current || generationController.signal.aborted) return;
      const errMessage = err instanceof Error ? err.message : "Something went wrong";
      setPendingAgentInput(null);
      setAgentAnswers({});
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
            ? { ...item, label: "Your response was sent to the agent", status: "complete" }
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
        <div className="flex items-center gap-3">
          <Sparkles className="text-cyan-400" size={18} />
          <h1 className="font-black tracking-[0.25em] text-lg">SKY</h1>
        </div>
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
                resolvedName?.toUpperCase() ?? "UNTITLED PROJECT"
              )}
            </div>

            <div ref={scrollRef} className="h-full flex-1 flex flex-col gap-2 overflow-y-auto">
              {loadingHistory && (
                <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm gap-2">
                  <Loader2 size={14} className="animate-spin" /> Loading conversation...
                </div>
              )}

              {!loadingHistory && messages.length === 0 && !isGenerating && (
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

              {!loadingHistory &&
                messages.map((m) =>
                  m.from === "user" ? (
                    <div key={m.id} className="w-full flex justify-end">
                      <div className="w-fit max-w-[85%] p-2 px-3 text-right rounded-lg rounded-br-none bg-cyan-300 text-black text-sm">
                        {m.message}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="w-full flex justify-start">
                      <div className="w-fit max-w-[85%] p-2 px-3 rounded-lg rounded-bl-none bg-zinc-900 text-zinc-200 text-sm">
                        {m.message}
                      </div>
                    </div>
                  )
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
                          <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
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
                      <label key={question.id} className="flex flex-col gap-1.5">
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
                  <div className="w-fit p-2 px-3 rounded-lg rounded-bl-none bg-zinc-900 text-cyan-300 text-sm flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Generating...
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex border border-zinc-900 rounded-lg">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1 p-2 outline-none bg-transparent text-sm"
                placeholder="Type a message..."
                disabled={isGenerating}
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
                  disabled={!message.trim()}
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
                  activeTab === "preview" ? "bg-cyan-300 text-black" : "text-zinc-500 hover:text-white"
                }`}
              >
                <Eye size={13} /> Preview
              </button>
              <button
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition ${
                  activeTab === "code" ? "bg-cyan-300 text-black" : "text-zinc-500 hover:text-white"
                }`}
              >
                <Code2 size={13} /> Code
              </button>
            </div>

            <div className="flex-1 flex items-center justify-center">
              {messages.length === 0 ? (
                <div className="text-center text-zinc-600 text-sm">
                  <Sparkles className="mx-auto mb-3 text-zinc-700" size={24} />
                  Your app will appear here once you send a prompt.
                </div>
              ) : activeTab === "preview" && previewUrl ? (
                <iframe
                  title="app-preview"
                  className="w-full h-full rounded-b-lg bg-white"
                  src={previewUrl}
                />
              ) : activeTab === "preview" ? (
                <div className="text-center text-zinc-600 text-sm">
                  The preview will appear when the project runtime is ready.
                </div>
              ) : (
                <pre className="w-full h-full overflow-auto p-4 text-xs text-zinc-400 font-mono">
                  {"// Generated code will render here"}
                </pre>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
