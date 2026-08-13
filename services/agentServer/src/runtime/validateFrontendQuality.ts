import { createHash } from "node:crypto";
import type { AppRuntimeState } from "./AppRuntimeMonitor";
import {
  listWorkspaceFiles,
  type WorkspaceFile,
} from "./workspaceFiles";

export interface FrontendQualityReview {
  passed: boolean;
  issues: string[];
}

const sourceExtension = /\.(?:css|scss|sass|less|js|jsx|ts|tsx|vue)$/i;
const stylesheetExtension = /\.(?:css|scss|sass|less)$/i;

export function reviewFrontendQuality(
  files: WorkspaceFile[],
): FrontendQualityReview {
  const sourceFiles = files.filter(
    (file) => file.path.startsWith("src/") && sourceExtension.test(file.path),
  );
  const source = sourceFiles.map((file) => file.content).join("\n");
  const styles = sourceFiles
    .filter(
      (file) =>
        stylesheetExtension.test(file.path) ||
        /<style(?:\s[^>]*)?>/i.test(file.content),
    )
    .map((file) => file.content)
    .join("\n");
  const packageJson =
    files.find((file) => file.path === "package.json")?.content ?? "";
  const issues: string[] = [];

  const starterMarkers = [
    /\bVite\s*\+\s*(?:React|Vue)\b/i,
    /\b(?:reactLogo|viteLogo)\b/,
    /\bcount is\s*\{?count/i,
    /\bEdit\s+(?:src\/)?App\.(?:jsx|tsx|vue)\b/i,
    /\blogo-spin\b/i,
  ];
  if (starterMarkers.some((pattern) => pattern.test(source))) {
    issues.push(
      "Remove all remaining Vite/framework demo content, imports, and starter styles.",
    );
  }

  const establishedUiSystem =
    /(?:tailwindcss|@mui\/|@chakra-ui\/|antd|bootstrap|styled-components|@emotion\/|vuetify|primevue|radix-ui|shadcn)/i.test(
      packageJson,
    ) &&
    /(?:className=|class=|\bsx=|styled\s*\(|<Grid\b|<Stack\b|<Flex\b|<Button\b)/i.test(
      source,
    );
  const cssInJs =
    /(?:styled\s*\(|createTheme\s*\(|\bsx=\{\{|style=\{\{)/.test(source);

  if (styles.length < 800 && !establishedUiSystem && !cssInJs) {
    issues.push(
      "Add a substantive styling system; the interface is still too close to unstyled/default browser output.",
    );
  }

  const hasDesignTokens =
    /--[a-z][\w-]*\s*:/i.test(styles) ||
    /(?:createTheme\s*\(|ThemeProvider\b|tailwind\.config|@theme\b)/i.test(
      `${source}\n${packageJson}`,
    );
  if (!hasDesignTokens && !establishedUiSystem) {
    issues.push(
      "Define and reuse design tokens for color, spacing, typography, radii, and elevation.",
    );
  }

  const hasResponsiveIntent =
    /@media\s*\([^)]*(?:min|max)-width/i.test(styles) ||
    /\b(?:clamp|minmax)\s*\(|\bauto-(?:fit|fill)\b/i.test(styles) ||
    /\b(?:sm|md|lg|xl|2xl):[\w-]+/.test(source) ||
    /\buseMediaQuery\s*\(|\b(?:xs|sm|md|lg|xl)\s*=\s*\{/i.test(source);
  if (!hasResponsiveIntent) {
    issues.push(
      "Add an explicit mobile/desktop responsive layout using breakpoints, fluid sizing, or adaptive grids.",
    );
  }

  const hasInteractionStates =
    /:(?:hover|focus-visible|active|disabled|checked)\b/i.test(styles) ||
    /\b(?:hover|focus-visible|active|disabled):[\w-]+/.test(source) ||
    /\btransition(?:Property|Duration)?\b|\bwhileHover\b/i.test(source);
  if (!hasInteractionStates) {
    issues.push(
      "Style interactive hover, keyboard-focus, active, and disabled/completed states.",
    );
  }

  const hasComposedLayout =
    /display\s*:\s*(?:grid|flex)/i.test(styles) ||
    /\b(?:grid|flex)(?:\s|\")|\bgrid-cols-|\bflex-(?:col|row)/.test(source) ||
    /<(?:Grid|Stack|Flex|Container)\b/.test(source);
  if (!hasComposedLayout) {
    issues.push(
      "Compose the page with purposeful grid/flex regions instead of a plain document flow or centered stack.",
    );
  }

  return { passed: issues.length === 0, issues };
}

export async function validateFrontendQuality(
  workspacePath: string,
): Promise<AppRuntimeState | undefined> {
  const review = reviewFrontendQuality(
    await listWorkspaceFiles(workspacePath),
  );
  if (review.passed) return undefined;

  const logs = [
    "[FRONTEND QUALITY REVIEW]",
    ...review.issues.map((issue) => `- ${issue}`),
    "Inspect the current source and improve the implementation. Run the production build again before completing.",
  ].join("\n");

  return {
    status: "unhealthy",
    failureScope: "application",
    repairableByAgent: true,
    reason: "Frontend quality review did not meet the completion bar",
    logs,
    observedAt: new Date().toISOString(),
    fingerprint: createHash("sha256").update(logs).digest("hex"),
  };
}
