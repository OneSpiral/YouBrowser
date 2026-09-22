import type {
  AcceptanceContract,
  ScenarioReport,
  Severity,
  Verdict,
} from "./model.js";

export type CoverageAudit = {
  complete: boolean;
  problems: string[];
};

/**
 * A successful adapter call is not proof that every required scenario and check ran.
 * Validate the returned execution matrix against the declared contract.
 */
export function auditCoverage(
  contract: AcceptanceContract,
  scenarios: ScenarioReport[],
): CoverageAudit {
  const problems: string[] = [];
  const expected = new Map(contract.scenarios.map((scenario) => [scenario.id, scenario]));
  const seen = new Set<string>();

  for (const scenario of scenarios) {
    if (!expected.has(scenario.id)) {
      problems.push(`unexpected scenario result: ${scenario.id}`);
      continue;
    }
    if (seen.has(scenario.id)) {
      problems.push(`duplicate scenario result: ${scenario.id}`);
      continue;
    }
    seen.add(scenario.id);
    const results = new Map<string, ScenarioReport["checks"][number]>();
    for (const result of scenario.checks) {
      if (results.has(result.id)) problems.push(`duplicate check ${result.id} in ${scenario.id}`);
      results.set(result.id, result);
      if (!contract.checks.some((check) => check.id === result.id)) {
        problems.push(`unexpected check ${result.id} in ${scenario.id}`);
      }
    }

    for (const check of contract.checks) {
      const result = results.get(check.id);
      if (!result) {
        problems.push(`missing check ${check.id} in ${scenario.id}`);
        continue;
      }
      const severity: Severity = check.severity ?? "must";
      if (result.type !== check.type || result.severity !== severity) {
        problems.push(`check contract mismatch: ${scenario.id}/${check.id}`);
      }
      const selected = !check.scenarios || check.scenarios.includes(scenario.id);
      if (selected && result.verdict === "SKIPPED") {
        problems.push(`selected check skipped: ${scenario.id}/${check.id}`);
      }
      if (!selected && result.verdict !== "SKIPPED") {
        problems.push(`unselected check evaluated: ${scenario.id}/${check.id}`);
      }
    }

    const required = scenario.checks.filter(
      (check) => check.severity === "must" && check.verdict !== "SKIPPED",
    );
    const expectedVerdict: Verdict =
      required.some((check) => check.verdict === "FAIL")
        ? "FAIL"
        : required.some((check) => check.verdict === "BLOCKED")
          ? "BLOCKED"
          : required.length === 0
            ? "SKIPPED"
            : "PASS";
    if (scenario.verdict !== expectedVerdict) {
      problems.push(`scenario verdict disagrees with checks: ${scenario.id}`);
    }
  }
  for (const id of expected.keys()) {
    if (!seen.has(id)) problems.push(`missing scenario result: ${id}`);
  }
  return { complete: problems.length === 0, problems };
}
