import { Sparkles, ArrowDown, X, Clock, ArrowRight, Check, Loader2 } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useAuthStore } from "~/store/authStore";
import { useNavigate } from "react-router";
import { useEffect, useState, useRef } from "react";
import { features } from "../features";
import { toast } from "sonner";

type Project = {
  id: string;
  title: string;
  feLibrary: "react" | "vue";
  createdAt: string;
  updatedAt: string;
};

const FE_LIBRARIES = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
] as const;

type FeLibrary = (typeof FE_LIBRARIES)[number]["value"];

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function LandingPage() {
  const { login, loading } = useAuth();
  const isAuthenticated = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const [showProjects, setShowProjects] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedLibrary, setSelectedLibrary] = useState<FeLibrary | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {}, [isAuthenticated]);

  useEffect(() => {
    if (showNewProjectModal) nameInputRef.current?.focus();
  }, [showNewProjectModal]);

  const openProjectList = async () => {
    setShowProjects(true);
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      const res = await fetch("http://localhost:3001/projects", {
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to load projects");
      }

      const json = await res.json();
      console.log(json)
      setProjects(json.data ?? []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setProjectsError(message);
    } finally {
      setLoadingProjects(false);
    }
  };

  const resumeProject = (projectId: string) => {
    setShowProjects(false);
    navigate(`/app?project=${projectId}`);
  };

  const closeNewProjectModal = () => {
    if (creatingProject) return;
    setShowNewProjectModal(false);
    setProjectName("");
    setSelectedLibrary(null);
  };

  const submitNewProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = projectName.trim();
    if (!title || !selectedLibrary || creatingProject) return;

    setCreatingProject(true);
    try {
      const res = await fetch("http://localhost:3001/createProject", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, feLibrary: selectedLibrary }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create project");
      }

      const json = await res.json();
      const newProject: Project = json.data;

      navigate(`/app?project=${newProject.id}&name=${encodeURIComponent(newProject.title)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(message);
    } finally {
      setCreatingProject(false);
    }
  };

  return (
    <div className="bg-[#070707] text-white">
      <div className="h-auto w-screen overflow-hidden relative flex flex-col">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] bg-size-[48px_48px]" />
        <div className="absolute -top-32 -left-32 w-96 h-72 bg-radial-[at_50%_75%] from-sky-200 via-blue-400 to-indigo-900 to-90% blur-[180px] rounded-full" />

        <nav className="relative z-10 h-16 px-10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="text-cyan-400" size={18} />
            <h1 className="font-black tracking-[0.25em] text-lg">SKY</h1>
          </div>
          <div className="flex gap-3">
            {isAuthenticated ? (
              <button className="px-4 py-1.5 text-sm border border-cyan-300 text-cyan-300 transition cursor-pointer">
                {isAuthenticated.username.toUpperCase()}
              </button>
            ) : (
              <button
                onClick={login}
                className="px-4 py-1.5 text-sm border hover:border-cyan-300 hover:text-cyan-300 border-white transition cursor-pointer"
              >
                {loading ? "SIGNING" : "SIGN UP"}
              </button>
            )}
          </div>
        </nav>

        <main className="relative z-10 flex-1 min-h-0 flex items-stretch">
          <section className="w-[32%] px-10 flex flex-col justify-center relative shrink-0">
            <p className="text-cyan-400 uppercase tracking-[0.3em] text-xs mb-5">AI Application Builder</p>

            <h1 className="text-5xl leading-[0.9] font-black tracking-[-0.06em] uppercase">
              Make
              <br />
              Software
              <br />
              <span className="text-zinc-500">Fast.</span>
            </h1>

            <p className="mt-6 max-w-sm text-zinc-500 text-sm leading-6">
              Describe an idea. SKY generates modern applications, APIs,
              authentication, dashboards and production-ready interfaces.
            </p>

            {isAuthenticated && (
              <div className="mt-8 flex flex-col gap-3 items-start">
                <button
                  onClick={() => setShowNewProjectModal(true)}
                  className="px-4 py-1.5 text-sm hover:bg-cyan-300 hover:text-[#070707] border-cyan-300 border text-cyan-300 transition cursor-pointer"
                >
                  Start New Project
                </button>

                <button
                  onClick={openProjectList}
                  className="px-4 py-1.5 text-sm border hover:border-white hover:text-[#070707] border-white hover:bg-white transition cursor-pointer"
                >
                  Resume Project
                </button>
              </div>
            )}
          </section>

          <section className="flex-1 min-h-0 flex flex-col justify-center px-10 py-8 gap-6">
            <div className="shrink-0">
              <p className="text-cyan-400 uppercase tracking-[0.3em] text-xs mb-2">Infrastructure</p>
              <h2 className="text-2xl font-black uppercase tracking-tight">
                Built on real infrastructure.
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {features.map(({ icon: Icon, status, title, description, detail }) => (
                <div
                  key={title}
                  className="group bg-[#0c0c0c] border border-zinc-800/80 rounded-lg p-4 hover:border-cyan-400/40 hover:bg-[#111] transition-colors duration-300 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 flex items-center justify-center border border-zinc-800 rounded-md group-hover:border-cyan-400/40 transition-colors">
                      <Icon className="text-cyan-400" size={15} strokeWidth={1.75} />
                    </div>
                    <span className="font-mono text-[8px] tracking-widest text-green-400/90">
                      [{status}]
                    </span>
                  </div>
                  <h3 className="font-black uppercase tracking-wide text-xs mb-1">{title}</h3>
                  <p className="text-white text-[11px] leading-4 mb-3">{description}</p>
                  <p className="mt-auto pt-2 border-t border-zinc-800/60 font-mono text-[9px] text-zinc-600 tracking-wide">
                    {detail}
                  </p>
                </div>
              ))}

              <a
                href="#architecture"
                className="group animate-pulse hover:animate-none bg-[#0c0c0c] border rounded-lg p-4 border-cyan-400/40 hover:bg-[#111] transition-colors duration-300 flex flex-col justify-between"
              >
                <p className="text-cyan-400 uppercase tracking-[0.2em] text-[9px] mb-2">Full system</p>
                <div>
                  <h3 className="font-black uppercase tracking-wide text-xs mb-1">View Architecture</h3>
                  <p className="text-white text-[11px] leading-4">See how it all fits together.</p>
                </div>
                <ArrowDown className="text-cyan-400 mt-3 group-hover:translate-y-0.5 transition-transform" size={16} />
              </a>
            </div>
          </section>
        </main>

        <section id="architecture" className="px-10 py-20 flex flex-col justify-center w-full">
          <div className="max-w-2xl mb-16">
            <p className="text-cyan-400 uppercase tracking-[0.3em] text-xs mb-4">System Design</p>
            <h2 className="text-4xl font-black uppercase tracking-tight">
              One request, <span className="text-zinc-500">start to finish.</span>
            </h2>
            <p className="mt-4 text-zinc-500 text-sm leading-6 max-w-lg">
              Every prompt travels through the same production path your users will —
              no shortcuts, no separate "preview" environment.
            </p>
          </div>

          <div className="border border-zinc-800 rounded-xl p-3 max-w-4xl mx-auto w-full">
            <img
              src="./architecture-diagram.png"
              alt="SKY system architecture diagram"
              className="w-auto h-full rounded-lg"
            />
          </div>
        </section>
      

      {/* NEW PROJECT MODAL */}
      {showNewProjectModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeNewProjectModal}
        >
          <div
            className="bg-[#0c0c0c] border border-zinc-800 rounded-xl w-full max-w-md flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
              <h3 className="font-black uppercase tracking-wide text-sm">New Project</h3>
              <button
                onClick={closeNewProjectModal}
                disabled={creatingProject}
                className="text-zinc-500 hover:text-white transition cursor-pointer disabled:opacity-30"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={submitNewProject} className="p-5 flex flex-col gap-5">
              <div>
                <label className="block text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
                  Project name
                </label>
                <input
                  ref={nameInputRef}
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-awesome-app"
                  disabled={creatingProject}
                  className="w-full px-3 py-2 text-sm bg-[#070707] border border-zinc-800 focus:border-cyan-300 text-white placeholder:text-zinc-600 outline-none rounded-md transition disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
                  Framework
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {FE_LIBRARIES.map((lib) => {
                    const active = selectedLibrary === lib.value;
                    return (
                      <button
                        key={lib.value}
                        type="button"
                        disabled={creatingProject}
                        onClick={() => setSelectedLibrary(lib.value)}
                        className={`relative flex items-center justify-center gap-2 py-3 rounded-md border text-sm font-bold transition cursor-pointer disabled:opacity-50 ${
                          active
                            ? "border-cyan-300 bg-cyan-300/10 text-cyan-300"
                            : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
                        }`}
                      >
                        {active && (
                          <Check size={12} className="absolute top-1.5 right-1.5 text-cyan-300" />
                        )}
                        {lib.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={!projectName.trim() || !selectedLibrary || creatingProject}
                className="mt-1 w-full flex items-center justify-center gap-2 py-2 text-sm border border-cyan-300 text-cyan-300 hover:bg-cyan-300 hover:text-[#070707] transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-cyan-300"
              >
                {creatingProject ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Creating...
                  </>
                ) : (
                  <>
                    Create Project <ArrowRight size={14} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* RESUME PROJECT MODAL */}
      {showProjects && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setShowProjects(false)}
        >
          <div
            className="bg-[#0c0c0c] border border-zinc-800 rounded-xl w-full max-w-md max-h-[70vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="font-black uppercase tracking-wide text-sm">Your Projects</h3>
              <button
                onClick={() => setShowProjects(false)}
                className="text-zinc-500 hover:text-white transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingProjects ? (
                <div className="p-6 text-center text-zinc-600 text-sm">Loading projects...</div>
              ) : projectsError ? (
                <div className="p-6 text-center text-red-400 text-sm">{projectsError}</div>
              ) : projects.length === 0 ? (
                <div className="p-6 text-center text-zinc-600 text-sm">
                  No projects yet. Start a new one to see it here.
                </div>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => resumeProject(project.id)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-lg hover:bg-[#161616] transition text-left cursor-pointer"
                  >
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-sm text-zinc-200 truncate max-w-[220px]">
                        {project.title}
                      </span>
                      <span className="text-[10px] font-mono uppercase text-zinc-600">
                        {project.feLibrary}
                      </span>
                    </div>
                    <span className="flex items-center gap-1 text-[11px] text-zinc-600 font-mono shrink-0">
                      <Clock size={11} />
                      {formatRelativeTime(project.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}