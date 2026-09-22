import { resolve } from "node:path";
import { getAdapter } from "./adapter.js";
import { auditCoverage } from "./coverage.js";
import { parseContract } from "./schema.js";
import type {
  AcceptanceContract,
  AcceptanceReport,
  CheckResult,
  Verdict,
} from "./model.js";
import { writeReport } from "./report.js";
import { reportTarget } from "./redact.js";
import { writeReceipt } from "./receipt.js";

function overall(results: CheckResult[]): Verdict {
  const must = results.filter((result) => result.severity === "must");
  if (must.some((result) => result.verdict === "FAIL")) return "FAIL";
  if (must.some((result) => result.verdict === "BLOCKED")) return "BLOCKED";
  if (must.length > 0 && must.every((result) => result.verdict === "SKIPPED")) return "SKIPPED";
  return "PASS";
}

export async function verify(
  contract: AcceptanceContract,
  options: { cwd?: string } = {},
): Promise<AcceptanceReport> {
  const validated = parseContract(contract);
  const cwd = options.cwd ?? process.cwd();
  const evidenceDir = resolve(cwd, validated.evidence?.dir ?? ".youbrowser");
  const startedAt = new Date().toISOString();
  const adapter = getAdapter(validated.target.kind);
  const scenarios = await adapter.run(validated, { cwd, evidenceDir });
  const coverage = auditCoverage(validated, scenarios);
  const results = scenarios.flatMap((scenario) => scenario.checks);
  const finishedAt = new Date().toISOString();

  const report: AcceptanceReport = {
    version: 1,
    target: reportTarget(validated.target),
    verdict: !coverage.complete && overall(results) !== "FAIL" ? "BLOCKED" : overall(results),
    coverage,
    startedAt,
    finishedAt,
    scenarios,
    summary: {
      pass: results.filter((result) => result.verdict === "PASS").length,
      fail: results.filter((result) => result.verdict === "FAIL").length,
      blocked: results.filter((result) => result.verdict === "BLOCKED").length + coverage.problems.length,
      skipped: results.filter((result) => result.verdict === "SKIPPED").length,
      warnings: results.filter(
        (result) => result.severity === "should" && result.verdict !== "PASS" && result.verdict !== "SKIPPED",
      ).length,
    },
  };

  const written = await writeReport(report, evidenceDir);
  await writeReceipt(validated, report, written.jsonText, evidenceDir, cwd);
  return report;
}
