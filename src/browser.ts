import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium } from "playwright";
import type { Adapter, RunContext } from "./adapter.js";
import { parseBrowserContract } from "./browser-contract.js";
import { evaluateCheck } from "./check.js";
import { scenarioVerdict } from "./result.js";
import type {
  AcceptanceContract,
  BrowserCheck,
  BrowserScenario,
  ScenarioReport,
  WebTarget,
} from "./model.js";

function scenarioUrl(target: WebTarget, scenario: BrowserScenario): string {
  return new URL(scenario.path ?? "/", target.baseUrl).toString();
}

export const browserAdapter: Adapter = {
  kind: "web",

  async run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]> {
    const browserContract = parseBrowserContract(contract);
    const target = browserContract.target;

    await mkdir(context.evidenceDir, { recursive: true });
    const browser = await chromium.launch();

    try {
      const reports: ScenarioReport[] = [];

      for (const scenario of browserContract.scenarios) {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const browserContext = await browser.newContext({
          viewport: scenario.viewport ?? { width: 1440, height: 900 },
          colorScheme: scenario.colorScheme ?? "light",
          reducedMotion: scenario.reducedMotion ?? "no-preference",
          ...(scenario.locale ? { locale: scenario.locale } : {}),
        });
        const page = await browserContext.newPage();
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => pageErrors.push(error.message));

        const url = scenarioUrl(target, scenario);
        let status: number | undefined;
        let title: string | undefined;
        let screenshot: string | undefined;
        let scenarioBlocked: string | null = null;

        try {
          const response = await page.goto(url, { waitUntil: "domcontentloaded" });
          status = response?.status();

          if (scenario.wait?.networkIdle) {
            await page.waitForLoadState("networkidle");
          }
          if (scenario.wait?.selector) {
            await page.locator(scenario.wait.selector).first().waitFor({ state: "visible" });
          }
          if (scenario.wait?.timeoutMs) {
            await page.waitForTimeout(scenario.wait.timeoutMs);
          }

          title = await page.title();

          if (browserContract.evidence?.screenshots !== false) {
            screenshot = resolve(context.evidenceDir, `${scenario.id}.png`);
            await page.screenshot({
              path: screenshot,
              fullPage: browserContract.evidence?.fullPage ?? true,
            });
          }
        } catch (error) {
          scenarioBlocked = error instanceof Error ? error.message : String(error);
        }

        let checks: ScenarioReport["checks"] = [];
        if (scenarioBlocked) {
          checks = browserContract.checks.map((check) => ({
            id: check.id,
            type: check.type,
            severity: check.severity ?? "must",
            verdict: "BLOCKED" as const,
            message: scenarioBlocked!,
          }));
        } else {
          for (const check of browserContract.checks as BrowserCheck[]) {
            checks.push(
              await evaluateCheck(page, scenario, check, {
                ...(status === undefined ? {} : { status }),
                ...(title === undefined ? {} : { title }),
                consoleErrors,
                pageErrors,
              }),
            );
          }
        }

        reports.push({
          id: scenario.id,
          verdict: scenarioVerdict(checks),
          evidence: {
            url,
            ...(status === undefined ? {} : { status }),
            ...(title === undefined ? {} : { title }),
            consoleErrors,
            pageErrors,
            ...(screenshot ? { screenshot: relative(context.cwd, screenshot) } : {}),
            ...(scenarioBlocked ? { error: scenarioBlocked } : {}),
          },
          checks,
        });

        await browserContext.close();
      }

      return reports;
    } finally {
      await browser.close();
    }
  },
};
