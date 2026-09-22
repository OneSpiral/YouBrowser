import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
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
): Promise<AcceptanceReceipt> {
  const base = {
    version: 1 as const,
    protocol: 1 as const,
    kind: "acceptance" as const,
    targetKind: contract.target.kind,
    verdict: report.verdict,
    contractSha256: sha256(canonicalJson(contract)),
    reportSha256: sha256(reportJson),
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
