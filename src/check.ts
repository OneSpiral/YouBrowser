import type { Page } from "playwright";
import type {
  BrowserCheck,
  CheckResult,
  Scenario,
  Severity,
  Verdict,
} from "./model.js";

type Observation = {
  status?: number;
  title?: string;
  consoleErrors: string[];
};

function severityOf(check: BrowserCheck): Severity {
  return check.severity ?? "must";
}

function result(
  check: BrowserCheck,
  verdict: Verdict,
  message: string,
  expected?: unknown,
  observed?: unknown,
): CheckResult {
  return {
    id: check.id,
    type: check.type,
    severity: severityOf(check),
    verdict,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(observed === undefined ? {} : { observed }),
  };
}

function matches(actual: string, mode: "equals" | "contains" | "regex", expected: string): boolean {
  if (mode === "equals") return actual === expected;
  if (mode === "contains") return actual.includes(expected);
  return new RegExp(expected).test(actual);
}

export async function evaluateCheck(
  page: Page,
  scenario: Scenario,
  check: BrowserCheck,
  observation: Observation,
): Promise<CheckResult> {
  if (check.scenarios && !check.scenarios.includes(scenario.id)) {
    return result(check, "SKIPPED", `not selected for scenario ${scenario.id}`);
  }

  try {
    switch (check.type) {
      case "status": {
        const actual = observation.status;
        const pass = actual === check.equals;
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "HTTP status matched" : "HTTP status differed",
          check.equals,
          actual,
        );
      }
      case "title": {
        const actual = observation.title ?? (await page.title());
        const pass = matches(actual, check.match, check.value);
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "title matched" : "title differed",
          { match: check.match, value: check.value },
          actual,
        );
      }
      case "visible": {
        const visible = await page.locator(check.selector).first().isVisible();
        return result(
          check,
          visible ? "PASS" : "FAIL",
          visible ? "selector is visible" : "selector is not visible",
          true,
          visible,
        );
      }
      case "text": {
        const actual = (await page.locator(check.selector).first().textContent()) ?? "";
        const pass = matches(actual.trim(), check.match, check.value);
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "text matched" : "text differed",
          { match: check.match, value: check.value },
          actual.trim(),
        );
      }
      case "count": {
        const actual = await page.locator(check.selector).count();
        const pass =
          (check.equals === undefined || actual === check.equals) &&
          (check.min === undefined || actual >= check.min) &&
          (check.max === undefined || actual <= check.max);
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "count satisfied constraints" : "count violated constraints",
          { equals: check.equals, min: check.min, max: check.max },
          actual,
        );
      }
      case "attribute": {
        const actual = (await page.locator(check.selector).first().getAttribute(check.name)) ?? "";
        const pass = matches(actual, check.match, check.value);
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "attribute matched" : "attribute differed",
          { name: check.name, match: check.match, value: check.value },
          actual,
        );
      }
      case "console": {
        const actual = observation.consoleErrors.length;
        const pass = actual <= check.maxErrors;
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "console error budget satisfied" : "console error budget exceeded",
          { maxErrors: check.maxErrors },
          actual,
        );
      }
      case "overflow": {
        const observed = await page.evaluate((axis) => {
          const root = document.documentElement;
          return axis === "x"
            ? Math.max(0, root.scrollWidth - root.clientWidth)
            : Math.max(0, root.scrollHeight - root.clientHeight);
        }, check.axis);
        const maxPx = check.maxPx ?? 0;
        const pass = observed <= maxPx;
        return result(
          check,
          pass ? "PASS" : "FAIL",
          pass ? "overflow stayed within budget" : "overflow exceeded budget",
          { axis: check.axis, maxPx },
          observed,
        );
      }
    }
  } catch (error) {
    return result(
      check,
      "BLOCKED",
      error instanceof Error ? error.message : String(error),
    );
  }
}
