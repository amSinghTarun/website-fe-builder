import {
  Activity,
  ArrowLeft,
  Box,
  Database,
  Network,
  RefreshCw,
  Server,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { apiUrl } from "../config";

type ClusterTopologyData = {
  namespace: string;
  observedAt: string;
  nodes: Array<{
    id: string;
    name: string;
    ready: boolean;
    zone: string | null;
    instanceType: string | null;
    capacity: { cpu: string; memory: string; pods: string };
  }>;
  pods: Array<{
    id: string;
    name: string;
    namespace: string;
    nodeName: string | null;
    phase: string;
    ready: boolean;
    restarts: number;
    owner: string | null;
    createdAt: string | null;
    pvcNames: string[];
    projectId: string | null;
    containers: Array<{
      name: string;
      role: "container" | "sidecar" | "init";
      state: "ready" | "running" | "completed" | "waiting" | "failed";
      ready: boolean;
      restarts: number;
    }>;
  }>;
  services: Array<{
    id: string;
    name: string;
    namespace: string;
    type: string;
    clusterIP: string | null;
    ports: string[];
    selectedPodIds: string[];
    projectId: string | null;
  }>;
  pvcs: Array<{
    id: string;
    name: string;
    namespace: string;
    phase: string;
    capacity: string | null;
    accessModes: string[];
    volumeName: string | null;
    mountedByPodIds: string[];
    projectId: string | null;
  }>;
};

type Point = { x: number; y: number };

const NODE_WIDTH = 360;
const POD_HEIGHT = 88;
const RESOURCE_WIDTH = 230;
const RESOURCE_HEIGHT = 72;

const PROJECT_COLORS = [
  { stroke: "#22d3ee", fill: "#071b22", text: "#67e8f9" },
  { stroke: "#a78bfa", fill: "#171126", text: "#c4b5fd" },
  { stroke: "#fb7185", fill: "#241014", text: "#fda4af" },
  { stroke: "#34d399", fill: "#092019", text: "#6ee7b7" },
  { stroke: "#fbbf24", fill: "#211805", text: "#fde68a" },
  { stroke: "#60a5fa", fill: "#0b172b", text: "#93c5fd" },
  { stroke: "#f472b6", fill: "#25101e", text: "#f9a8d4" },
  { stroke: "#a3e635", fill: "#172006", text: "#bef264" },
] as const;

const PLATFORM_COLOR = { stroke: "#71717a", fill: "#121214", text: "#a1a1aa" };

function colorForProject(projectId: string | null) {
  if (!projectId) return PLATFORM_COLOR;
  const hash = [...projectId].reduce((value, character) =>
    ((value << 5) - value + character.charCodeAt(0)) | 0, 0);
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length] ?? PROJECT_COLORS[0];
}

function projectLabel(projectId: string | null): string {
  return projectId ? `Project ${projectId.slice(0, 8)}` : "Platform";
}

function projectSortKey(resource: { projectId: string | null }): string {
  return resource.projectId ?? "";
}

function displayName(name: string, maxLength = 38): string {
  if (name.length <= maxLength) return name;
  const edgeLength = Math.floor((maxLength - 1) / 2);
  return `${name.slice(0, edgeLength)}…${name.slice(-edgeLength)}`;
}

function podColor(pod: ClusterTopologyData["pods"][number]): string {
  if (pod.ready) return "#22c55e";
  if (pod.phase === "Pending") return "#f59e0b";
  if (pod.phase === "Failed") return "#ef4444";
  return "#71717a";
}

function containerLabel(
  container: ClusterTopologyData["pods"][number]["containers"][number],
): string {
  const shortName = container.name
    .replace(/^sky-[0-9a-f-]+-/i, "")
    .replace(/-cron$/, "");
  return container.role === "sidecar" ? `${shortName} sidecar` : shortName;
}

function containerStateColor(
  state: ClusterTopologyData["pods"][number]["containers"][number]["state"],
): string {
  if (state === "ready" || state === "running" || state === "completed")
    return "#22c55e";
  if (state === "failed") return "#ef4444";
  return "#f59e0b";
}

function TopologyCanvas({ data }: { data: ClusterTopologyData }) {
  const layout = useMemo(() => {
    const scheduledGroups = data.nodes.map((node) => ({
      node,
      pods: data.pods
        .filter((pod) => pod.nodeName === node.name)
        .sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b))),
    }));
    const unscheduled = data.pods.filter((pod) => !pod.nodeName);
    const groups = unscheduled.length
      ? [
          ...scheduledGroups,
          {
            node: {
              id: "unscheduled",
              name: "Unscheduled",
              ready: false,
              zone: null,
              instanceType: null,
              capacity: { cpu: "—", memory: "—", pods: "—" },
            },
            pods: unscheduled,
          },
        ]
      : scheduledGroups;

    const canvasWidth = Math.max(1120, 56 + groups.length * (NODE_WIDTH + 28));
    const podPoints = new Map<string, Point>();
    const nodeLayouts = groups.map((group, index) => {
      const x = 40 + index * (NODE_WIDTH + 28);
      const y = 84;
      const height = 106 + Math.max(1, group.pods.length) * (POD_HEIGHT + 10);
      group.pods.forEach((pod, podIndex) => {
        podPoints.set(pod.id, {
          x: x + NODE_WIDTH / 2,
          y: y + 94 + podIndex * (POD_HEIGHT + 10) + POD_HEIGHT / 2,
        });
      });
      return { ...group, x, y, height };
    });

    const nodesBottom = Math.max(300, ...nodeLayouts.map((node) => node.y + node.height));
    const columns = Math.max(1, Math.floor((canvasWidth - 80) / (RESOURCE_WIDTH + 24)));
    const serviceY = nodesBottom + 112;
    const services = [...data.services]
      .sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b)))
      .map((service, index) => ({
      resource: service,
      x: 40 + (index % columns) * (RESOURCE_WIDTH + 24),
      y: serviceY + Math.floor(index / columns) * (RESOURCE_HEIGHT + 18),
      }));
    const serviceRows = Math.max(1, Math.ceil(data.services.length / columns));
    const pvcY = serviceY + serviceRows * (RESOURCE_HEIGHT + 18) + 110;
    const pvcs = [...data.pvcs]
      .sort((a, b) => projectSortKey(a).localeCompare(projectSortKey(b)))
      .map((pvc, index) => ({
      resource: pvc,
      x: 40 + (index % columns) * (RESOURCE_WIDTH + 24),
      y: pvcY + Math.floor(index / columns) * (RESOURCE_HEIGHT + 18),
      }));
    const pvcRows = Math.max(1, Math.ceil(data.pvcs.length / columns));

    return {
      canvasWidth,
      canvasHeight: pvcY + pvcRows * (RESOURCE_HEIGHT + 18) + 70,
      nodeLayouts,
      podPoints,
      services,
      pvcs,
      serviceY,
      pvcY,
    };
  }, [data]);

  const connectionPath = (from: Point, to: Point) => {
    const bend = Math.max(70, Math.abs(from.y - to.y) * 0.45);
    return `M ${from.x} ${from.y} C ${from.x} ${from.y - bend}, ${to.x} ${to.y + bend}, ${to.x} ${to.y}`;
  };

  return (
    <div className="overflow-auto rounded-2xl border border-zinc-800 bg-[#090909] shadow-2xl shadow-black/40">
      <svg
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        viewBox={`0 0 ${layout.canvasWidth} ${layout.canvasHeight}`}
        role="img"
        aria-label="Kubernetes node, pod, service, and persistent volume claim topology"
        className="block"
      >
        <defs>
          <pattern id="cluster-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#27272a" strokeWidth="0.6" opacity="0.5" />
          </pattern>
          <filter id="topology-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="#090909" />
        <rect width="100%" height="100%" fill="url(#cluster-grid)" />

        <text x="40" y="42" fill="#67e8f9" fontSize="11" fontWeight="700" letterSpacing="2.4">
          COMPUTE / NODES &amp; PODS
        </text>
        <line x1="40" y1="58" x2={layout.canvasWidth - 40} y2="58" stroke="#164e63" strokeDasharray="4 7" />

        {/* Connections are drawn first so resource shapes remain readable. */}
        <g fill="none" strokeLinecap="round">
          {layout.services.flatMap(({ resource, x, y }) =>
            resource.selectedPodIds.flatMap((podId) => {
              const pod = layout.podPoints.get(podId);
              return pod ? (
                <path
                  key={`service-${resource.id}-${podId}`}
                  d={connectionPath({ x: x + RESOURCE_WIDTH / 2, y }, pod)}
                  stroke={colorForProject(resource.projectId).stroke}
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  opacity="0.48"
                />
              ) : [];
            }),
          )}
          {layout.pvcs.flatMap(({ resource, x, y }) =>
            resource.mountedByPodIds.flatMap((podId) => {
              const pod = layout.podPoints.get(podId);
              return pod ? (
                <path
                  key={`pvc-${resource.id}-${podId}`}
                  d={connectionPath({ x: x + RESOURCE_WIDTH / 2, y }, pod)}
                  stroke={colorForProject(resource.projectId).stroke}
                  strokeWidth="2"
                  opacity="0.45"
                />
              ) : [];
            }),
          )}
        </g>

        {layout.nodeLayouts.map(({ node, pods, x, y, height }) => (
          <g key={node.id}>
            <title>{`${node.name}: ${pods.length} visible pod${pods.length === 1 ? "" : "s"}`}</title>
            <rect
              x={x}
              y={y}
              width={NODE_WIDTH}
              height={height}
              rx="18"
              fill="#101012"
              stroke={node.ready ? "#155e75" : "#78350f"}
              strokeWidth="1.5"
            />
            <rect x={x + 1} y={y + 1} width={NODE_WIDTH - 2} height="76" rx="17" fill="#111b20" />
            <circle cx={x + 25} cy={y + 28} r="7" fill={node.ready ? "#22c55e" : "#f59e0b"} filter="url(#topology-glow)" />
            <text x={x + 42} y={y + 25} fill="#fafafa" fontSize="13" fontWeight="800">
              {displayName(node.name, 39)}
            </text>
            <text x={x + 42} y={y + 45} fill="#71717a" fontSize="10">
              {node.instanceType ?? (node.id === "unscheduled" ? "Waiting for scheduler" : "Kubernetes node")}
            </text>
            <text x={x + 18} y={y + 66} fill="#a1a1aa" fontSize="9">
              {node.zone ?? "no zone"}  ·  {node.capacity.cpu} CPU  ·  {node.capacity.memory} RAM  ·  {pods.length}/{node.capacity.pods} pods
            </text>

            {pods.length === 0 ? (
              <g>
                <rect x={x + 16} y={y + 94} width={NODE_WIDTH - 32} height={POD_HEIGHT} rx="10" fill="#0b0b0c" stroke="#27272a" strokeDasharray="5 5" />
                <text x={x + NODE_WIDTH / 2} y={y + 132} textAnchor="middle" fill="#52525b" fontSize="10">No visible pods</text>
              </g>
            ) : pods.map((pod, podIndex) => {
              const podY = y + 94 + podIndex * (POD_HEIGHT + 10);
              const projectColor = colorForProject(pod.projectId);
              const runningContainers = pod.containers.filter(
                (container) => container.role !== "init",
              );
              const startupGates = pod.containers.filter(
                (container) => container.role === "init",
              );
              return (
                <g key={pod.id}>
                  <title>{`${pod.name}\n${pod.owner ?? "No controller"}\n${pod.phase}, ${pod.restarts} restarts\n${pod.containers.map((container) => `${containerLabel(container)}: ${container.state}`).join("\n")}`}</title>
                  <rect x={x + 16} y={podY} width={NODE_WIDTH - 32} height={POD_HEIGHT} rx="10" fill={projectColor.fill} stroke={projectColor.stroke} strokeOpacity="0.72" />
                  <rect x={x + 16} y={podY} width="4" height={POD_HEIGHT} rx="2" fill={podColor(pod)} />
                  <circle cx={x + 38} cy={podY + 22} r="8" fill={projectColor.fill} stroke={projectColor.stroke} />
                  <text x={x + 55} y={podY + 21} fill="#e4e4e7" fontSize="11" fontWeight="700">
                    {displayName(pod.name, 39)}
                  </text>
                  <text x={x + 55} y={podY + 40} fill="#71717a" fontSize="9">
                    {pod.phase} · {pod.ready ? "ready" : "not ready"} · {pod.restarts} restarts
                  </text>
                  <text x={x + NODE_WIDTH - 22} y={podY + 40} textAnchor="end" fill={projectColor.text} fontSize="8">
                    {pod.projectId?.slice(0, 8) ?? "PLATFORM"}
                  </text>
                  <text x={x + 28} y={podY + 60} fill={projectColor.text} fontSize="8.5" fontWeight="600">
                    {runningContainers.length > 0
                      ? `Running: ${runningContainers.map(containerLabel).join(" + ")}`
                      : "container details unavailable"}
                  </text>
                  {startupGates.length > 0 && (
                    <text x={x + 28} y={podY + 76} fill="#71717a" fontSize="8">
                      Startup: {startupGates.map((container) =>
                        `${containerLabel(container)} ${container.state === "completed" ? "✓" : `· ${container.state}`}`
                      ).join(" · ")}
                    </text>
                  )}
                  {pod.containers.map((container, containerIndex) => (
                    <circle key={`${pod.id}-${container.name}`} cx={x + NODE_WIDTH - 28 - containerIndex * 9} cy={podY + 76} r="2.5" fill={containerStateColor(container.state)} />
                  ))}
                </g>
              );
            })}
          </g>
        ))}

        <text x="40" y={layout.serviceY - 48} fill="#67e8f9" fontSize="11" fontWeight="700" letterSpacing="2.4">
          NETWORK / SERVICES
        </text>
        <line x1="40" y1={layout.serviceY - 32} x2={layout.canvasWidth - 40} y2={layout.serviceY - 32} stroke="#164e63" strokeDasharray="4 7" />
        {layout.services.length === 0 && (
          <text x="40" y={layout.serviceY + 24} fill="#52525b" fontSize="10">No Services found</text>
        )}
        {layout.services.map(({ resource, x, y }) => {
          const projectColor = colorForProject(resource.projectId);
          return (
          <g key={resource.id}>
            <title>{`${resource.name}\n${resource.type} ${resource.clusterIP ?? ""}\nRoutes to ${resource.selectedPodIds.length} pod(s)`}</title>
            <path
              d={`M ${x + 14} ${y} H ${x + RESOURCE_WIDTH - 14} L ${x + RESOURCE_WIDTH} ${y + RESOURCE_HEIGHT / 2} L ${x + RESOURCE_WIDTH - 14} ${y + RESOURCE_HEIGHT} H ${x + 14} L ${x} ${y + RESOURCE_HEIGHT / 2} Z`}
              fill={projectColor.fill}
              stroke={projectColor.stroke}
            />
            <circle cx={x + 27} cy={y + 27} r="9" fill={projectColor.fill} stroke={projectColor.stroke} />
            <text x={x + 45} y={y + 25} fill="#e4e4e7" fontSize="10" fontWeight="700">{displayName(resource.name, 27)}</text>
            <text x={x + 45} y={y + 44} fill={projectColor.text} fontSize="8">{resource.type} · {resource.ports.join(", ") || "no ports"}</text>
            <text x={x + 45} y={y + 59} fill="#71717a" fontSize="8">{projectLabel(resource.projectId)} · {resource.selectedPodIds.length} pod{resource.selectedPodIds.length === 1 ? "" : "s"}</text>
          </g>
          );
        })}

        <text x="40" y={layout.pvcY - 48} fill="#c4b5fd" fontSize="11" fontWeight="700" letterSpacing="2.4">
          STORAGE / PERSISTENT VOLUME CLAIMS
        </text>
        <line x1="40" y1={layout.pvcY - 32} x2={layout.canvasWidth - 40} y2={layout.pvcY - 32} stroke="#4c1d95" strokeDasharray="4 7" />
        {layout.pvcs.length === 0 && (
          <text x="40" y={layout.pvcY + 24} fill="#52525b" fontSize="10">No PVCs found</text>
        )}
        {layout.pvcs.map(({ resource, x, y }) => {
          const projectColor = colorForProject(resource.projectId);
          return (
          <g key={resource.id}>
            <title>{`${resource.name}\n${resource.phase} · ${resource.capacity ?? "unknown size"}\nMounted by ${resource.mountedByPodIds.length} pod(s)`}</title>
            <rect x={x} y={y + 9} width={RESOURCE_WIDTH} height={RESOURCE_HEIGHT - 18} fill={projectColor.fill} stroke={projectColor.stroke} />
            <ellipse cx={x + RESOURCE_WIDTH / 2} cy={y + 9} rx={RESOURCE_WIDTH / 2} ry="9" fill={projectColor.fill} stroke={projectColor.stroke} />
            <ellipse cx={x + RESOURCE_WIDTH / 2} cy={y + RESOURCE_HEIGHT - 9} rx={RESOURCE_WIDTH / 2} ry="9" fill={projectColor.fill} stroke={projectColor.stroke} />
            <text x={x + 18} y={y + 33} fill="#e4e4e7" fontSize="10" fontWeight="700">{displayName(resource.name, 30)}</text>
            <text x={x + 18} y={y + 51} fill={projectColor.text} fontSize="8">{resource.phase} · {resource.capacity ?? "unknown size"} · {resource.accessModes.join(", ")}</text>
            <text x={x + RESOURCE_WIDTH - 16} y={y + 51} textAnchor="end" fill={projectColor.text} fontSize="8">{resource.projectId?.slice(0, 8) ?? "PLATFORM"}</text>
          </g>
          );
        })}
      </svg>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Server;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{label}</span>
        <Icon size={16} className="text-cyan-400" />
      </div>
      <div className="text-3xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs text-zinc-600">{detail}</div>
    </div>
  );
}

export function ClusterTopology() {
  const navigate = useNavigate();
  const [data, setData] = useState<ClusterTopologyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTopology = useCallback(async (signal?: AbortSignal) => {
    try {
      setError(null);
      const response = await fetch(apiUrl("/clusterTopology"), {
        credentials: "include",
        signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message ?? "Could not read the cluster");
      setData(result.data);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Could not read the cluster");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadTopology(controller.signal);
    const interval = window.setInterval(() => loadTopology(controller.signal), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadTopology]);

  const readyPods = data?.pods.filter((pod) => pod.ready).length ?? 0;
  const mountedPvcs = data?.pvcs.filter((pvc) => pvc.mountedByPodIds.length > 0).length ?? 0;
  const projectIds = data
    ? [...new Set([
        ...data.pods.map((pod) => pod.projectId),
        ...data.services.map((service) => service.projectId),
        ...data.pvcs.map((pvc) => pvc.projectId),
      ])].sort((a, b) => projectSortKey({ projectId: a }).localeCompare(projectSortKey({ projectId: b })))
    : [];

  return (
    <main className="min-h-screen bg-[#070707] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-size-[48px_48px]" />
      <nav className="relative z-10 flex h-16 items-center justify-between border-b border-zinc-900 px-5 md:px-10">
        <button onClick={() => navigate("/")} className="flex cursor-pointer items-center gap-3" aria-label="Go to SKY home">
          <Sparkles className="text-cyan-400" size={18} />
          <span className="text-lg font-black tracking-[0.25em]">SKY</span>
        </button>
        <button onClick={() => navigate("/")} className="flex cursor-pointer items-center gap-2 text-xs uppercase tracking-[0.18em] text-zinc-500 transition hover:text-white">
          <ArrowLeft size={14} /> Home
        </button>
      </nav>

      <div className="relative z-10 mx-auto max-w-[1800px] px-5 py-8 md:px-10 md:py-12">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-400">
              <Activity size={13} /> Live cluster topology
            </div>
            <h1 className="text-3xl font-black uppercase tracking-[-0.04em] md:text-5xl">See where everything runs.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
              Pods are nested inside their Nodes. Each pod lists its containers, including the Agent + Recovery sidecar control pod. Lines show Service routing and shared PVC mounts.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
                {data.namespace} · {new Date(data.observedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => {
                setLoading(true);
                loadTopology();
              }}
              disabled={loading}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-cyan-400 hover:text-cyan-300 disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </header>

        {data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard icon={Server} label="Nodes" value={data.nodes.length} detail={`${data.nodes.filter((node) => node.ready).length} Ready`} />
              <SummaryCard icon={Box} label="Pods" value={data.pods.length} detail={`${readyPods} Ready in ${data.namespace}`} />
              <SummaryCard icon={Network} label="Services" value={data.services.length} detail={`${data.services.reduce((total, service) => total + service.selectedPodIds.length, 0)} routing links`} />
              <SummaryCard icon={Database} label="PVCs" value={data.pvcs.length} detail={`${mountedPvcs} currently mounted`} />
            </div>
            <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-[#0d0d0f] px-4 py-3">
              <span className="mr-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Resource groups</span>
              {projectIds.map((projectId) => {
                const color = colorForProject(projectId);
                return (
                  <span
                    key={projectId ?? "platform"}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{ borderColor: color.stroke, color: color.text, backgroundColor: color.fill }}
                  >
                    <i className="h-2 w-2 rounded-full" style={{ backgroundColor: color.stroke }} />
                    {projectLabel(projectId)}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {error ? (
          <div className="rounded-2xl border border-red-950 bg-red-950/20 p-8 text-center">
            <p className="font-semibold text-red-300">Cluster topology is unavailable</p>
            <p className="mt-2 text-sm text-red-400/70">{error}</p>
          </div>
        ) : loading && !data ? (
          <div className="flex min-h-96 items-center justify-center rounded-2xl border border-zinc-800 bg-[#090909]">
            <div className="flex items-center gap-3 text-sm text-zinc-500"><RefreshCw size={16} className="animate-spin text-cyan-400" /> Reading Kubernetes resources…</div>
          </div>
        ) : data ? (
          <TopologyCanvas data={data} />
        ) : null}

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.14em] text-zinc-600">
          <span><i className="mr-2 inline-block h-2 w-2 rounded-full bg-green-500" />Ready</span>
          <span><i className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" />Pending</span>
          <span><i className="mr-2 inline-block w-6 border-t border-dashed border-zinc-400 align-middle" />Service → Pod</span>
          <span><i className="mr-2 inline-block h-px w-6 bg-zinc-400 align-middle" />PVC → Pod</span>
        </div>
      </div>
    </main>
  );
}
