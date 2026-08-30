import { describe, expect, test } from "bun:test";
import { validateFrontendBrowser } from "./validateFrontendBrowser";

describe("validateFrontendBrowser", () => {
  test("accepts a populated app with no page failures", async () => {
    const state = await validateFrontendBrowser(
      { url: "http://preview.test" },
      async () => ({
        httpStatus: 200,
        errors: [],
        mountFound: true,
        mountHasContent: true,
      }),
    );

    expect(state).toBeUndefined();
  });

  test("returns uncaught browser errors to the repair loop", async () => {
    const state = await validateFrontendBrowser(
      { url: "http://preview.test" },
      async () => ({
        httpStatus: 200,
        errors: ["Uncaught error: Column is not defined"],
        mountFound: true,
        mountHasContent: false,
      }),
    );

    expect(state).toMatchObject({
      status: "unhealthy",
      repairableByAgent: true,
      reason: "Browser preview smoke test failed",
    });
    expect(state?.logs).toContain("Column is not defined");
    expect(state?.logs).toContain("rendered no content");
  });

  test("reports a disconnected styling pipeline to the repair loop", async () => {
    const state = await validateFrontendBrowser(
      { url: "http://preview.test" },
      async () => ({
        httpStatus: 200,
        errors: [],
        mountFound: true,
        mountHasContent: true,
        styleCoverage: {
          usedClassCount: 40,
          matchedClassCount: 2,
          prominentClassedElementCount: 8,
          prominentLowCoverageCount: 7,
          missingClassNames: [
            "app-shell",
            "hero",
            "hero-title",
            "primary-button",
            "feature-grid",
            "feature-card",
            "site-nav",
            "site-footer",
          ],
        },
      }),
    );

    expect(state).toMatchObject({
      status: "unhealthy",
      repairableByAgent: true,
      reason: "Browser preview smoke test failed",
    });
    expect(state?.logs).toContain("2/40 matched");
    expect(state?.logs).toContain("hero-title");
  });
});
