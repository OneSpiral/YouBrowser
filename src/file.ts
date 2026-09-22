import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Adapter, RunContext } from "./adapter.js";
import type {
  AcceptanceContract,
  CheckResult,
  CheckSpec,
  ScenarioReport,
  ScenarioSpec,
  Severity,
  Target,
} from "./model.js";
import { checkResult, matches, scenarioVerdict } from "./result.js";

type FileTarget = Target & { kind: "file"; root?: string };
type FileScenario = ScenarioSpec & { path: string };
type FileCheck =
  | (CheckSpec & { type: "exists"; equals: boolean })
  | (CheckSpec & { type: "size"; min?: number; max?: number })
  | (CheckSpec & { type: "text"; match: "equals" | "contains" | "regex"; value: string })
  | (CheckSpec & { type: "json"; path: string; equals?: unknown; exists?: boolean });

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}
function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}
function target(contract: AcceptanceContract): FileTarget {
  if (contract.target.kind !== "file") throw new Error("file adapter requires target.kind=file");
  return {
    ...contract.target,
    kind: "file",
    ...(contract.target.root === undefined ? {} : { root: string(contract.target.root, "target.root") }),
  };
}
function scenario(value: ScenarioSpec, index: number): FileScenario {
  return { id: value.id, path: string((value as Record<string, unknown>).path, `scenarios[${index}].path`) };
}
function check(value: CheckSpec, index: number): FileCheck {
  const raw = value as Record<string, unknown>;
  const common = { id: value.id, severity: (value.severity ?? "must") as Severity, ...(value.scenarios ? { scenarios: value.scenarios } : {}) };
  if (value.type === "exists") {
    if (typeof raw.equals !== "boolean") throw new Error(`checks[${index}].equals must be boolean`);
    return { ...common, type: "exists", equals: raw.equals };
  }
  if (value.type === "size") {
    if (raw.min === undefined && raw.max === undefined) throw new Error(`checks[${index}] size requires min or max`);
    return { ...common, type: "size", ...(raw.min === undefined ? {} : { min: number(raw.min, `checks[${index}].min`) }), ...(raw.max === undefined ? {} : { max: number(raw.max, `checks[${index}].max`) }) };
  }
  if (value.type === "text") {
    const match = string(raw.match, `checks[${index}].match`);
    if (!["equals","contains","regex"].includes(match)) throw new Error(`checks[${index}].match is invalid`);
    return { ...common, type: "text", match: match as "equals"|"contains"|"regex", value: string(raw.value, `checks[${index}].value`) };
  }
  if (value.type === "json") {
    if (raw.equals === undefined && raw.exists === undefined) throw new Error(`checks[${index}] json requires equals or exists`);
    if (raw.exists !== undefined && typeof raw.exists !== "boolean") throw new Error(`checks[${index}].exists must be boolean`);
    return { ...common, type: "json", path: string(raw.path, `checks[${index}].path`), ...(raw.equals === undefined ? {} : { equals: raw.equals }), ...(raw.exists === undefined ? {} : { exists: raw.exists }) };
  }
  throw new Error(`file adapter does not support check type: ${value.type}`);
}
function jsonPath(root: unknown, path: string): { exists: boolean; value?: unknown } {
  let current = root;
  for (const part of path.split(".").filter(Boolean)) {
    if (current === null || typeof current !== "object" || !(part in current)) return { exists: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

export const fileAdapter: Adapter = {
  kind: "file",
  async run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]> {
    const base = target(contract);
    const scenarios = contract.scenarios.map(scenario);
    const checks = contract.checks.map(check);
    const reports: ScenarioReport[] = [];

    for (const item of scenarios) {
      const root = base.root ? (isAbsolute(base.root) ? base.root : resolve(context.cwd, base.root)) : context.cwd;
      const absolute = isAbsolute(item.path) ? item.path : resolve(root, item.path);
      let bytes: Buffer | null = null;
      let metadata: Awaited<ReturnType<typeof stat>> | null = null;
      let error: string | null = null;
      try {
        [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }

      const results: CheckResult[] = [];
      for (const criterion of checks) {
        if (criterion.scenarios && !criterion.scenarios.includes(item.id)) {
          results.push(checkResult(criterion, "SKIPPED", `not selected for scenario ${item.id}`));
          continue;
        }
        if (criterion.type === "exists") {
          const exists = bytes !== null && metadata !== null;
          results.push(checkResult(criterion, exists === criterion.equals ? "PASS" : "FAIL", exists === criterion.equals ? "existence matched" : "existence differed", criterion.equals, exists));
          continue;
        }
        if (!bytes || !metadata) {
          results.push(checkResult(criterion, "BLOCKED", error ?? "file is unavailable"));
          continue;
        }
        if (criterion.type === "size") {
          const size = metadata.size;
          const pass = (criterion.min === undefined || size >= criterion.min) && (criterion.max === undefined || size <= criterion.max);
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? "size satisfied constraints" : "size violated constraints", { min: criterion.min, max: criterion.max }, size));
        } else if (criterion.type === "text") {
          const actual = bytes.toString("utf8");
          const pass = matches(actual, criterion.match, criterion.value);
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? "text matched" : "text differed", { match: criterion.match, value: criterion.value }, actual.slice(0, 1000)));
        } else {
          let json: unknown;
          try {
            json = JSON.parse(bytes.toString("utf8"));
          } catch {
            results.push(checkResult(criterion, "BLOCKED", "file is not valid JSON"));
            continue;
          }
          const found = jsonPath(json, criterion.path);
          const existencePass = criterion.exists === undefined || found.exists === criterion.exists;
          const equalityPass = criterion.equals === undefined || (found.exists && JSON.stringify(found.value) === JSON.stringify(criterion.equals));
          const pass = existencePass && equalityPass;
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? "JSON path matched" : "JSON path differed", { path: criterion.path, equals: criterion.equals, exists: criterion.exists }, found));
        }
      }

      reports.push({
        id: item.id,
        verdict: scenarioVerdict(results),
        evidence: {
          path: absolute,
          exists: bytes !== null && metadata !== null,
          ...(metadata ? { size: metadata.size, modifiedAt: metadata.mtime.toISOString() } : {}),
          ...(bytes ? { sha256: createHash("sha256").update(bytes).digest("hex") } : {}),
          ...(error ? { error } : {}),
        },
        checks: results,
      });
    }
    return reports;
  },
};
