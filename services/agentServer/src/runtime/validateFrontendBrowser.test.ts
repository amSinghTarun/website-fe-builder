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
});
