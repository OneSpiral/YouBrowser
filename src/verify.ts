import { resolve } from "node:path";
import { getAdapter } from "./adapter.js";
import type {
  AcceptanceContract,
  AcceptanceReport,
  CheckResult,
  Verdict,
} from "./model.js";
import { writeReport } from "./report.js";
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
  const cwd = options.cwd ?? process.cwd();
  const evidenceDir = resolve(cwd, contract.evidence?.dir ?? ".youbrowser");
  const startedAt = new Date().toISOString();
  const adapter = getAdapter(contract.target.kind);
  const scenarios = await adapter.run(contract, { cwd, evidenceDir });
  const results = scenarios.flatMap((scenario) => scenario.checks);
  const finishedAt = new Date().toISOString();

  const report: AcceptanceReport = {
    version: 1,
    target: contract.target,
    verdict: overall(results),
    startedAt,
    finishedAt,
    scenarios,
    summary: {
      pass: results.filter((result) => result.verdict === "PASS").length,
      fail: results.filter((result) => result.verdict === "FAIL").length,
      blocked: results.filter((result) => result.verdict === "BLOCKED").length,
      skipped: results.filter((result) => result.verdict === "SKIPPED").length,
      warnings: results.filter(
        (result) => result.severity === "should" && result.verdict !== "PASS" && result.verdict !== "SKIPPED",
      ).length,
    },
  };

  const written = await writeReport(report, evidenceDir);
  await writeReceipt(contract, report, written.jsonText, evidenceDir);
  return report;
}
