import { Sparkles, Loader2, Eye, Code2 } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

type ChatMessage = {
  id: string;
  from: "user" | "assistant";
  message: string;
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

  useEffect(() => {
    // New projects already carry the name in the URL — nothing to fetch.
    if (nameFromUrl) {
      setResolvedName(nameFromUrl);
      return;
    }

    // Resumed projects only have ?project=id — look up the real title.
    if (!projectId) return;

    let cancelled = false;

    const fetchProjectName = async () => {
      setLoadingName(true);
      try {
        // TODO: swap for a single-project endpoint once available, e.g.
        // GET /projects/:id → avoids fetching the whole list just for a name.
        const res = await fetch("http://localhost:3001/projects", {
          credentials: "include",
        });

        if (!res.ok) throw new Error("Failed to load project");

        const json = await res.json();
        const match = (json.data ?? []).find(
          (p: { id: string; title: string }) => p.id === projectId
        );

        if (!cancelled) {
          setResolvedName(match ? match.title : null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Unknown error";
          toast.error(message);
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const isFirstMessage = messages.length === 0;

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isGenerating]);

  const sendPrompt = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    if (!projectId) {
      toast.error("Missing project — go back and start or resume a project first.");
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      from: "user",
      message: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsGenerating(true);

    try {
      if (isFirstMessage) {
        const res = await fetch("http://localhost:3001/newChat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, initialPrompt: trimmed }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to start chat");
        }

        const json = await res.json();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            from: "assistant",
            message: json.data?.message ?? "Got it — building your project now.",
          },
        ]);
      } else {
        // TODO: subsequent messages need their own endpoint (e.g. /sendMessage)
        await new Promise((r) => setTimeout(r, 1000));
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            from: "assistant",
            message: `Working on "${trimmed}" — wire up the follow-up message endpoint here.`,
          },
        ]);
      }
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : "Something went wrong";
      toast.error(errMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPrompt(message);
  };

  return (
    <div className="bg-[#070707] text-white w-screen h-screen flex flex-col">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-size-[48px_48px]" />

      <nav className="relative z-10 h-16 px-10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Sparkles className="text-cyan-400" size={18} />
          <a href="/" className="font-black tracking-[0.25em] text-lg">SKY</a>
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
              {messages.length === 0 && !isGenerating && (
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

              {messages.map((m) =>
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
              <button
                type="submit"
                disabled={isGenerating || !message.trim()}
                className="px-3 text-cyan-300 disabled:text-zinc-700 disabled:cursor-not-allowed"
              >
                →
              </button>
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
              ) : activeTab === "preview" ? (
                <iframe title="app-preview" className="w-full h-full rounded-b-lg bg-white" src="about:blank" />
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