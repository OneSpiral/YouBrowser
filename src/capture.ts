import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAdapter } from "./adapter.js";
import { digestArtifacts } from "./artifact.js";
import type {
  AcceptanceContract,
  CaptureContract,
  CaptureReport,
} from "./model.js";

export async function capture(
  contract: CaptureContract,
  options: { cwd?: string } = {},
): Promise<CaptureReport> {
  const cwd = options.cwd ?? process.cwd();
  const evidenceDir = resolve(cwd, contract.evidence?.dir ?? ".youbrowser");
  const startedAt = new Date().toISOString();
  const adapter = getAdapter(contract.target.kind);

  const executionContract: AcceptanceContract = {
    version: 1,
    target: contract.target,
    scenarios: contract.scenarios,
    checks: [],
    ...(contract.evidence ? { evidence: contract.evidence } : {}),
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
  const artifacts = await digestArtifacts(scenarios, evidenceDir, cwd);
  const report: CaptureReport = {
    version: 1,
    target: contract.target,
    startedAt,
    finishedAt,
    artifacts,
    summary: {
      captured: scenarios.filter((scenario) => scenario.state === "CAPTURED").length,
      blocked: scenarios.filter((scenario) => scenario.state === "BLOCKED").length,
    },
    scenarios,
  };

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    resolve(evidenceDir, "capture.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
