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

    return {
      httpStatus: response?.status(),
      errors,
      mountFound,
      mountHasContent,
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
