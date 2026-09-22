import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AcceptanceReport, CheckResult } from "./model.js";

function line(check: CheckResult): string {
  const severity = check.severity.toUpperCase();
  return `- [${check.verdict}] [${severity}] ${check.id}: ${check.message}`;
}

export async function writeReport(
  report: AcceptanceReport,
  evidenceDir: string,
): Promise<{ json: string; markdown: string }> {
  await mkdir(evidenceDir, { recursive: true });
  const json = resolve(evidenceDir, "report.json");
  const markdown = resolve(evidenceDir, "report.md");

  const body = [
    "# YouBrowser Acceptance Report",
    "",
    `**Verdict:** ${report.verdict}`,
    "",
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    "",
    "## Summary",
    "",
    `- PASS: ${report.summary.pass}`,
    `- FAIL: ${report.summary.fail}`,
    `- BLOCKED: ${report.summary.blocked}`,
    `- SKIPPED: ${report.summary.skipped}`,
    `- SHOULD warnings: ${report.summary.warnings}`,
    "",
    ...report.scenarios.flatMap((scenario) => [
      `## ${scenario.id} — ${scenario.verdict}`,
      "",
      "### Evidence",
      "",
      "\`\`\`json",
      JSON.stringify(scenario.evidence, null, 2),
      "\`\`\`",
      "",
      ...scenario.checks.map(line),
      "",
    ]),
  ].join("\n");

  await Promise.all([
    writeFile(json, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdown, `${body}\n`),
  ]);

  return { json, markdown };
}
