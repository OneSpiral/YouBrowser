import type { CheckResult, CheckSpec, Severity, Verdict } from "./model.js";

export function severityOf(check: CheckSpec): Severity {
  return check.severity ?? "must";
}

export function checkResult(
  check: CheckSpec,
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

export function matches(
  actual: string,
  mode: "equals" | "contains" | "regex",
  expected: string,
): boolean {
  if (mode === "equals") return actual === expected;
  if (mode === "contains") return actual.includes(expected);
  return new RegExp(expected).test(actual);
}

export function scenarioVerdict(checks: CheckResult[]): Verdict {
  const must = checks.filter((check) => check.severity === "must");
  if (must.some((check) => check.verdict === "FAIL")) return "FAIL";
  if (must.some((check) => check.verdict === "BLOCKED")) return "BLOCKED";
  if (must.length === 0 || must.every((check) => check.verdict === "SKIPPED")) return "SKIPPED";
  return "PASS";
}
