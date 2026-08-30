import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chromium } from "playwright-core";
import type { AppRuntimeState } from "./AppRuntimeMonitor";
import { AgentRunCancelledError, throwIfRunCancelled } from "./AgentRunRegistry";

type BrowserObservation = {
  httpStatus?: number;
  errors: string[];
  mountFound: boolean;
  mountHasContent: boolean;
  styleCoverage?: {
    usedClassCount: number;
    matchedClassCount: number;
    prominentClassedElementCount: number;
    prominentLowCoverageCount: number;
    missingClassNames: string[];
  };
};

type PreviewProbe = (
  target: { url: string; internalHostname?: string },
  signal?: AbortSignal,
) => Promise<BrowserObservation>;

async function probeBrowserPreview(
  target: { url: string; internalHostname?: string },
  signal?: AbortSignal,
): Promise<BrowserObservation> {
  throwIfRunCancelled(signal);
  const browserHost = new URL(target.url).hostname;
  const internalAddress = target.internalHostname
    ? (await lookup(target.internalHostname, { family: 4 })).address
    : undefined;
  const browser = await chromium.launch({
    executablePath: process.env["CHROMIUM_PATH"]?.trim() || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      ...(internalAddress
        ? [`--host-resolver-rules=MAP ${browserHost} ${internalAddress}`]
        : []),
    ],
  });
  const onAbort = () => void browser.close();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`Uncaught error: ${error.message}`));
    page.on("requestfailed", (request) => {
      if (["document", "script", "stylesheet"].includes(request.resourceType())) {
        errors.push(
          `Failed ${request.resourceType()}: ${request.url()} (${request.failure()?.errorText ?? "unknown error"})`,
        );
      }
    });

    const response = await page.goto(target.url, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForTimeout(750);
    throwIfRunCancelled(signal);

    const mount = page.locator("#root, #app").first();
    const mountFound = (await mount.count()) > 0;
    const mountHasContent = mountFound
      ? await mount.evaluate(
          (element) =>
            element.childElementCount > 0 || Boolean(element.textContent?.trim()),
        )
      : false;

    // Verify that rendered class names are backed by rules in the loaded CSS.
    // This is framework-agnostic and catches a disconnected styling pipeline.
    const styleCoverage = await page.locator("body").evaluate((body) => {
      const document = (body as any).ownerDocument as any;
      let loadedCss = "";
      for (const sheet of Array.from<any>(document.styleSheets)) {
        try {
          loadedCss += Array.from<any>(sheet.cssRules ?? [])
            .map((rule) => rule.cssText)
            .join("\n");
        } catch {
          // Cross-origin stylesheets cannot be inspected through CSSOM.
        }
      }

      const elements = Array.from<any>((body as any).querySelectorAll("*"));
      const usedClassNames = Array.from<string>(
        new Set<string>(
          elements.flatMap((element) =>
            Array.from<string>(element.classList),
          ),
        ),
      );
      const escapeClassName = (className: string) =>
        document.defaultView.CSS.escape(className) as string;
      const hasLoadedRule = (className: string) =>
        loadedCss.includes(`.${escapeClassName(className)}`);
      const matchedClassNames = usedClassNames.filter(hasLoadedRule);
      const missingClassNames = usedClassNames.filter(
        (className) => !hasLoadedRule(className),
      );

      const prominentElements = Array.from<any>(
        new Set(
          Array.from<any>(
            (body as any).querySelectorAll(
              "#root > *, #app > *, header, nav, main, section, article, aside, form, footer",
            ),
          ).filter((element) => element.classList.length > 0),
        ),
      ).slice(0, 50);
      const prominentLowCoverageCount = prominentElements.filter((element) => {
        const classNames = Array.from<string>(element.classList);
        const matched = classNames.filter(hasLoadedRule).length;
        return matched / classNames.length < 0.5;
      }).length;

      return {
        usedClassCount: usedClassNames.length,
        matchedClassCount: matchedClassNames.length,
        prominentClassedElementCount: prominentElements.length,
        prominentLowCoverageCount,
        missingClassNames: missingClassNames.slice(0, 40),
      };
    });

    return {
      httpStatus: response?.status(),
      errors,
      mountFound,
      mountHasContent,
      styleCoverage,
    };
  } catch (error) {
    if (signal?.aborted) throw new AgentRunCancelledError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser.close();
  }
}

export async function validateFrontendBrowser(
  options: { url: string; internalHostname?: string; signal?: AbortSignal },
  probe: PreviewProbe = probeBrowserPreview,
): Promise<AppRuntimeState | undefined> {
  let observation: BrowserObservation;
  try {
    observation = await probe(
      { url: options.url, internalHostname: options.internalHostname },
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw new AgentRunCancelledError();
    return {
      status: "unavailable",
      failureScope: "infrastructure",
      repairableByAgent: false,
      reason: `Browser validation could not run: ${error instanceof Error ? error.message : String(error)}`,
      observedAt: new Date().toISOString(),
    };
  }

  const failures = [...observation.errors];
  if ((observation.httpStatus ?? 500) >= 400) {
    failures.push(`Preview returned HTTP ${observation.httpStatus ?? "unknown"}`);
  }
  if (!observation.mountFound) {
    failures.push("The preview has no #root or #app mount element");
  } else if (!observation.mountHasContent) {
    failures.push("The frontend mount element rendered no content");
  }
  const coverage = observation.styleCoverage;
  if (coverage) {
    const matchedRatio =
      coverage.usedClassCount === 0
        ? 1
        : coverage.matchedClassCount / coverage.usedClassCount;
    const prominentLowCoverageRatio =
      coverage.prominentClassedElementCount === 0
        ? 0
        : coverage.prominentLowCoverageCount /
          coverage.prominentClassedElementCount;
    const stylingPipelineDisconnected =
      (coverage.usedClassCount >= 12 && matchedRatio < 0.15) ||
      (coverage.missingClassNames.length >= 8 &&
        coverage.prominentClassedElementCount >= 3 &&
        prominentLowCoverageRatio >= 0.5);

    if (stylingPipelineDisconnected) {
      failures.push(
        `Rendered CSS classes are not backed by loaded style rules (${coverage.matchedClassCount}/${coverage.usedClassCount} matched; ${coverage.prominentLowCoverageCount}/${coverage.prominentClassedElementCount} prominent elements have low class coverage).`,
      );
      failures.push(
        `Missing class rules include: ${coverage.missingClassNames.join(", ")}`,
      );
    }
  }
  if (failures.length === 0) return undefined;

  const logs = failures.join("\n").slice(-16_000);
  return {
    status: "unhealthy",
    failureScope: "application",
    repairableByAgent: true,
    reason: "Browser preview smoke test failed",
    httpStatus: observation.httpStatus,
    logs,
    observedAt: new Date().toISOString(),
    fingerprint: createHash("sha256")
      .update(`frontend-browser:${observation.httpStatus}:${logs}`)
      .digest("hex"),
  };
}
