import {
  Sparkles,
  Box,
  Users,
  ListChecks,
  Save,
  GitBranch,
  Cloud,
  Route,
  ArrowDown,
  BrainCircuit,
  ScrollText,
} from "lucide-react";

export const features = [
  {
    icon: Box,
    status: "ISOLATED",
    title: "Kubernetes Pods",
    description: "Every project runs in its own pod — no noisy neighbors.",
    detail: "Auto-scaled · isolated namespace",
  },
  {
    icon: Users,
    status: "PARALLEL",
    title: "Sub-Agents",
    description: "Specialized agents split the work and run it side by side.",
    detail: "Up to 6 agents per build",
  },
  {
    icon: ListChecks,
    status: "ORDERED",
    title: "Task Planning",
    description: "Your prompt becomes a dependency-ordered build plan first.",
    detail: "DAG-based dependency graph",
  },
  {
    icon: BrainCircuit,
    status: "AWARE",
    title: "Contextualisation",
    description:
      "Reads your existing codebase and conventions before writing a line.",
    detail: "Full-repo context retrieval",
  },
  {
    icon: ScrollText,
    status: "CONDENSED",
    title: "Summarisation",
    description:
      "Long threads and files get condensed so agents never lose the plot.",
    detail: "Auto-compacts context window",
  },
  {
    icon: Route,
    status: "ROUTED",
    title: "Dynamic Reverse Proxy",
    description: "Nginx routes every request to the right pod by project URL.",
    detail: "Zero-downtime hot reload",
  },
  {
    icon: Save,
    status: "CONTINUOUS",
    title: "Auto Backup",
    description: "Every change is snapshotted automatically as you build.",
    detail: "Snapshot on every commit",
  },
  {
    icon: GitBranch,
    status: "BRANCHED",
    title: "Worktrees",
    description: "Every agent gets its own worktree — nothing to stash.",
    detail: "One worktree per branch",
  },
  {
    icon: Cloud,
    status: "SYNCED",
    title: "Cloud Storage",
    description: "Your code lives in durable cloud storage, always reachable.",
    detail: "S3-compatible object store",
  },
];
