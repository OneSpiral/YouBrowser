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
import { checkResult, scenarioVerdict } from "./result.js";

type JsonTarget = Target & {
  kind: "json";
  root?: string;
  maxBytes: number;
};

type JsonScenario = ScenarioSpec & {
  path: string;
};

type JsonCheck =
  | (CheckSpec & { type: "exists"; path: string; equals: boolean })
  | (CheckSpec & { type: "equals"; path: string; value: unknown })
  | (CheckSpec & {
      type: "type";
      path: string;
      equals: "array" | "object" | "string" | "number" | "boolean" | "null";
    })
  | (CheckSpec & { type: "count"; path: string; equals?: number; min?: number; max?: number })
  | (CheckSpec & { type: "unique"; path: string; key?: string; maxDuplicates: number })
  | (CheckSpec & { type: "nulls"; path: string; key?: string; max: number });

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const HARD_MAX_BYTES = 256 * 1024 * 1024;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}

function integer(value: unknown, path: string): number {
  const result = number(value, path);
  if (!Number.isInteger(result)) throw new Error(`${path} must be an integer`);
  return result;
}

function parseTarget(contract: AcceptanceContract): JsonTarget {
  if (contract.target.kind !== "json") throw new Error("json adapter requires target.kind=json");
  const maxBytes =
    contract.target.maxBytes === undefined
      ? DEFAULT_MAX_BYTES
      : integer(contract.target.maxBytes, "target.maxBytes");
  if (maxBytes < 1 || maxBytes > HARD_MAX_BYTES) {
    throw new Error(`target.maxBytes must be 1..${HARD_MAX_BYTES}`);
  }
  return {
    ...contract.target,
    kind: "json",
    ...(contract.target.root === undefined ? {} : { root: string(contract.target.root, "target.root") }),
    maxBytes,
  };
}

function parseScenario(value: ScenarioSpec, index: number): JsonScenario {
  const raw = value as Record<string, unknown>;
  return {
    id: value.id,
    path: string(raw.path, `scenarios[${index}].path`),
  };
}

function pathValue(root: unknown, path: string): { exists: boolean; value?: unknown } {
  if (path === "" || path === "$") return { exists: true, value: root };
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      const index = Number(part);
      if (index >= current.length) return { exists: false };
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== "object" || !(part in current)) {
      return { exists: false };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

function parseCheck(value: CheckSpec, index: number): JsonCheck {
  const raw = value as Record<string, unknown>;
  const common = {
    id: value.id,
    severity: (value.severity ?? "must") as Severity,
    ...(value.scenarios ? { scenarios: value.scenarios } : {}),
  };
  const path = raw.path === undefined ? "$" : string(raw.path, `checks[${index}].path`);

  switch (value.type) {
    case "exists":
      if (typeof raw.equals !== "boolean") throw new Error(`checks[${index}].equals must be boolean`);
      return { ...common, type: "exists", path, equals: raw.equals };
    case "equals":
      if (!("value" in raw)) throw new Error(`checks[${index}].value is required`);
      return { ...common, type: "equals", path, value: raw.value };
    case "type": {
      const equals = string(raw.equals, `checks[${index}].equals`);
      if (!["array", "object", "string", "number", "boolean", "null"].includes(equals)) {
        throw new Error(`checks[${index}].equals is not a JSON type`);
      }
      return {
        ...common,
        type: "type",
        path,
        equals: equals as "array" | "object" | "string" | "number" | "boolean" | "null",
      };
    }
    case "count": {
      if (raw.equals === undefined && raw.min === undefined && raw.max === undefined) {
        throw new Error(`checks[${index}] count requires equals, min, or max`);
      }
      return {
        ...common,
        type: "count",
        path,
        ...(raw.equals === undefined ? {} : { equals: integer(raw.equals, `checks[${index}].equals`) }),
        ...(raw.min === undefined ? {} : { min: integer(raw.min, `checks[${index}].min`) }),
        ...(raw.max === undefined ? {} : { max: integer(raw.max, `checks[${index}].max`) }),
      };
    }
    case "unique":
      return {
        ...common,
        type: "unique",
        path,
        ...(raw.key === undefined ? {} : { key: string(raw.key, `checks[${index}].key`) }),
        maxDuplicates:
          raw.maxDuplicates === undefined ? 0 : integer(raw.maxDuplicates, `checks[${index}].maxDuplicates`),
      };
    case "nulls":
      return {
        ...common,
        type: "nulls",
        path,
        ...(raw.key === undefined ? {} : { key: string(raw.key, `checks[${index}].key`) }),
        max: raw.max === undefined ? 0 : integer(raw.max, `checks[${index}].max`),
      };
    default:
      throw new Error(`json adapter does not support check type: ${value.type}`);
  }
}

function selected(check: JsonCheck, scenario: JsonScenario): boolean {
  return !check.scenarios || check.scenarios.includes(scenario.id);
}

function jsonType(value: unknown): "array" | "object" | "string" | "number" | "boolean" | "null" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  throw new Error("value is not valid JSON");
}

function collectionSize(value: unknown): number | null {
  if (Array.isArray(value) || typeof value === "string") return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  return null;
}

function projected(array: unknown[], key?: string): Array<{ exists: boolean; value?: unknown }> {
  if (!key) return array.map((value) => ({ exists: true, value }));
  return array.map((value) => pathValue(value, key));
}

export const jsonAdapter: Adapter = {
  kind: "json",

  async run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]> {
    const target = parseTarget(contract);
    const scenarios = contract.scenarios.map(parseScenario);
    const checks = contract.checks.map(parseCheck);
    const reports: ScenarioReport[] = [];

    for (const scenario of scenarios) {
      const root = target.root
        ? isAbsolute(target.root)
          ? target.root
          : resolve(context.cwd, target.root)
        : context.cwd;
      const absolute = isAbsolute(scenario.path) ? scenario.path : resolve(root, scenario.path);
      let bytes: Buffer | null = null;
      let data: unknown;
      let error: string | null = null;

      try {
        const metadata = await stat(absolute);
        if (!metadata.isFile()) throw new Error("JSON source is not a regular file");
        if (metadata.size > target.maxBytes) {
          throw new Error(`JSON source exceeds target.maxBytes=${target.maxBytes}`);
        }
        bytes = await readFile(absolute);
        data = JSON.parse(bytes.toString("utf8"));
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }

      const results: CheckResult[] = [];
      for (const check of checks) {
        if (!selected(check, scenario)) {
          results.push(checkResult(check, "SKIPPED", `not selected for scenario ${scenario.id}`));
          continue;
        }
        if (error || !bytes) {
          results.push(checkResult(check, "BLOCKED", error ?? "JSON source is unavailable"));
          continue;
        }

        const found = pathValue(data, check.path);
        if (check.type === "exists") {
          const pass = found.exists === check.equals;
          results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "path existence matched" : "path existence differed", check.equals, found.exists));
          continue;
        }
        if (!found.exists) {
          results.push(checkResult(check, "FAIL", "JSON path does not exist", check.path, false));
          continue;
        }

        if (check.type === "equals") {
          const pass = JSON.stringify(found.value) === JSON.stringify(check.value);
          results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "value matched" : "value differed", check.value, found.value));
        } else if (check.type === "type") {
          const actual = jsonType(found.value);
          results.push(checkResult(check, actual === check.equals ? "PASS" : "FAIL", actual === check.equals ? "type matched" : "type differed", check.equals, actual));
        } else if (check.type === "count") {
          const actual = collectionSize(found.value);
          if (actual === null) {
            results.push(checkResult(check, "BLOCKED", "count requires an array, object, or string"));
            continue;
          }
          const pass =
            (check.equals === undefined || actual === check.equals) &&
            (check.min === undefined || actual >= check.min) &&
            (check.max === undefined || actual <= check.max);
          results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "count satisfied constraints" : "count violated constraints", { equals: check.equals, min: check.min, max: check.max }, actual));
        } else {
          if (!Array.isArray(found.value)) {
            results.push(checkResult(check, "BLOCKED", `${check.type} requires an array at ${check.path}`));
            continue;
          }
          const values = projected(found.value, check.key);
          if (check.type === "unique") {
            const seen = new Set<string>();
            let duplicates = 0;
            for (const item of values) {
              const fingerprint = item.exists ? JSON.stringify(item.value) : "__MISSING__";
              if (seen.has(fingerprint)) duplicates++;
              else seen.add(fingerprint);
            }
            const pass = duplicates <= check.maxDuplicates;
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "duplicate budget satisfied" : "duplicate budget exceeded", { key: check.key, maxDuplicates: check.maxDuplicates }, { duplicates, records: values.length }));
          } else {
            const nulls = values.filter((item) => !item.exists || item.value === null).length;
            const pass = nulls <= check.max;
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "null budget satisfied" : "null budget exceeded", { key: check.key, max: check.max }, { nulls, records: values.length }));
          }
        }
      }

      reports.push({
        id: scenario.id,
        verdict: scenarioVerdict(results),
        evidence: {
          path: absolute,
          ...(bytes
            ? {
                bytes: bytes.byteLength,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                rootType: jsonType(data),
              }
            : {}),
          maxBytes: target.maxBytes,
          ...(error ? { error } : {}),
        },
        checks: results,
      });
    }

    return reports;
  },
};
