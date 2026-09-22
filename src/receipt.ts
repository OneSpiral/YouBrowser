import { createHash } from "node:crypto";
import { digestArtifacts } from "./artifact.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AcceptanceContract,
  AcceptanceReceipt,
  AcceptanceReport,
} from "./model.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export async function writeReceipt(
  contract: AcceptanceContract,
  report: AcceptanceReport,
  reportJson: string,
  evidenceDir: string,
  cwd: string,
): Promise<AcceptanceReceipt> {
  const artifacts = await digestArtifacts(report.scenarios, evidenceDir, cwd);
  const base = {
    version: 1 as const,
    protocol: 1 as const,
    kind: "acceptance" as const,
    targetKind: contract.target.kind,
    verdict: report.verdict,
    contractSha256: sha256(canonicalJson(contract)),
    reportSha256: sha256(reportJson),
    artifacts,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    summary: report.summary,
    scenarios: report.scenarios.map((scenario) => ({
      id: scenario.id,
      verdict: scenario.verdict,
    })),
  };

  const receipt: AcceptanceReceipt = {
    ...base,
    receiptSha256: sha256(canonicalJson(base)),
  };

  await writeFile(
    resolve(evidenceDir, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

/**
 * Recomputes the local receipt, report and retained-artifact digests.
 * This detects accidental drift/tampering, but it is not an external signature.
 */
export async function inspectReceipt(
  contract: AcceptanceContract,
  evidenceDir: string,
  cwd: string,
): Promise<{ valid: boolean; problems: string[] }> {
  const problems: string[] = [];
  try {
    const [receiptText, reportText] = await Promise.all([
      readFile(resolve(evidenceDir, "receipt.json"), "utf8"),
      readFile(resolve(evidenceDir, "report.json"), "utf8"),
    ]);
    const receipt = JSON.parse(receiptText) as AcceptanceReceipt;
    const report = JSON.parse(reportText) as AcceptanceReport;
    if (receipt.version !== 1 || receipt.protocol !== 1 || receipt.kind !== "acceptance") {
      problems.push("unsupported receipt protocol");
    }
    if (receipt.contractSha256 !== sha256(canonicalJson(contract))) {
      problems.push("contract hash differs");
    }
    if (receipt.reportSha256 !== sha256(reportText)) {
      problems.push("report bytes differ");
    }
    const { receiptSha256, ...unsigned } = receipt;
    if (receiptSha256 !== sha256(canonicalJson(unsigned))) {
      problems.push("receipt hash differs");
    }
    if (receipt.targetKind !== report.target.kind || receipt.verdict !== report.verdict) {
      problems.push("receipt and report disagree");
    }
    try {
      const actual = await digestArtifacts(report.scenarios, evidenceDir, cwd);
      if (canonicalJson(actual) !== canonicalJson(receipt.artifacts)) {
        problems.push("retained artifact bytes differ");
      }
    } catch (error) {
      problems.push(`retained artifact unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    problems.push(`receipt or report unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { valid: problems.length === 0, problems };
}
