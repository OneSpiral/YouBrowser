import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAdapter } from "./adapter.js";
import { digestArtifacts } from "./artifact.js";
import { reportTarget } from "./redact.js";
import { parseCaptureContract } from "./schema.js";
import type {
  AcceptanceContract,
  CaptureContract,
  CaptureReport,
} from "./model.js";

export async function capture(
  contract: CaptureContract,
  options: { cwd?: string } = {},
): Promise<CaptureReport> {
  const validated = parseCaptureContract(contract);
  const cwd = options.cwd ?? process.cwd();
  const evidenceDir = resolve(cwd, validated.evidence?.dir ?? ".youbrowser");
  const startedAt = new Date().toISOString();
  const adapter = getAdapter(validated.target.kind);

  const executionContract: AcceptanceContract = {
    version: 1,
    target: validated.target,
    scenarios: validated.scenarios,
    checks: [],
    ...(validated.evidence ? { evidence: validated.evidence } : {}),
  };

  const executed = await adapter.run(executionContract, { cwd, evidenceDir });
  const finishedAt = new Date().toISOString();

  const scenarios = executed.map((scenario) => ({
    id: scenario.id,
    state: (typeof scenario.evidence.error === "string" ? "BLOCKED" : "CAPTURED") as
      | "BLOCKED"
      | "CAPTURED",
    evidence: scenario.evidence,
  }));
  await mkdir(evidenceDir, { recursive: true });
  const artifacts = await digestArtifacts(scenarios, evidenceDir, cwd);
  const report: CaptureReport = {
    version: 1,
    target: reportTarget(validated.target),
    startedAt,
    finishedAt,
    artifacts,
    summary: {
      captured: scenarios.filter((scenario) => scenario.state === "CAPTURED").length,
      blocked: scenarios.filter((scenario) => scenario.state === "BLOCKED").length,
    },
    scenarios,
  };

  await writeFile(
    resolve(evidenceDir, "capture.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
