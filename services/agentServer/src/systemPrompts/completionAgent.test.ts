import { describe, expect, test } from "bun:test";
import {
  completionAgentPrompt,
  completionFallbackMessage,
  createCompletionRewriteRequest,
  isConciseCompletionMessage,
} from "./completionAgent";

describe("agent completion messages", () => {
  test("requires short outcome-focused responses", () => {
    expect(completionAgentPrompt).toContain("2 or 3 short sentences");
    expect(completionAgentPrompt).toContain("no more than 80 words");
    expect(completionAgentPrompt).toContain("file-by-file summaries");
    expect(completionAgentPrompt).toContain("Do not repeat the user's request");
    expect(completionAgentPrompt).toContain("Do not tell the user to check");
  });

  test("passes only grounded request, draft and verification facts", () => {
    const request = JSON.parse(
      createCompletionRewriteRequest({
        userRequest: "Fix the Kanban layout",
        draft: "Changed the responsive columns and dates.",
        workspaceChanged: true,
        runtimeVerified: true,
      }),
    );

    expect(request).toEqual({
      userRequest: "Fix the Kanban layout",
      draft: "Changed the responsive columns and dates.",
      verifiedFacts: {
        workspaceChanged: true,
        productionBuildAndPreviewHealthy: true,
      },
    });
  });

  test("rejects overlong formatter output and provides a safe fallback", () => {
    expect(isConciseCompletionMessage("Done — the layout is responsive.")).toBe(
      true,
    );
    expect(isConciseCompletionMessage("word ".repeat(81))).toBe(false);
    expect(completionFallbackMessage(true)).toContain(
      "production build and live preview are healthy",
    );
    expect(completionFallbackMessage(false)).not.toContain("healthy");
  });
});
