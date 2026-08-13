import {
  Box,
  Users,
  ListChecks,
  Save,
  Route,
  BrainCircuit,
  ScrollText,
  Eye,
  CheckCircle2,
} from "lucide-react";

export const features = [
  {
    icon: Box,
    status: "DEDICATED",
    title: "Kubernetes Runtime",
    description:
      "Every project gets dedicated workspace, agent and recovery workloads.",
    detail: "Shared namespace · project-scoped services",
  },
  {
    icon: Save,
    status: "RESTORABLE",
    title: "Project Recovery",
    description:
      "Resume a saved project with its code, conversation and runtime restored.",
    detail: "PVC · GCS snapshots · tool replay",
  },
  {
    icon: Eye,
    status: "LIVE",
    title: "Live Preview & Source",
    description:
      "See the running frontend and browse its generated files in one editor.",
    detail: "Readiness-gated iframe · file browser",
  },
  {
    icon: ListChecks,
    status: "ORDERED",
    title: "Task Planning",
    description:
      "Substantive builds are broken into clear outcomes before implementation.",
    detail: "3–6 ordered execution steps",
  },
  {
    icon: BrainCircuit,
    status: "AWARE",
    title: "Contextualisation",
    description:
      "Uses the existing frontend workspace and saved conversation while coding.",
    detail: "Workspace-aware prompting",
  },
  {
    icon: ScrollText,
    status: "CONDENSED",
    title: "Summarisation",
    description:
      "Large tool payloads are archived so long builds retain useful context.",
    detail: "Context archives · compact history",
  },
  {
    icon: Users,
    status: "BRANCHED",
    title: "Sub-Agents & Worktrees",
    description:
      "Independent tasks can run in isolated Git branches and worktrees.",
    detail: "One branch and worktree per sub-agent",
  },
  {
    icon: CheckCircle2,
    status: "VERIFIED",
    title: "Runtime Validation",
    description:
      "The production build and live workspace are checked before completion.",
    detail: "Build diagnostics · health monitoring",
  },
  {
    icon: Route,
    status: "ROUTED",
    title: "Dynamic Nginx Routing",
    description:
      "Ingress and Nginx route each preview path to the correct workspace.",
    detail: "Per-project service routing",
  },
];
