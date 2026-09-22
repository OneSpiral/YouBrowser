import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
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
import { redactSecrets } from "./redact.js";

type HttpTarget = Target & {
  kind: "http";
  baseUrl: string;
  headers?: Record<string, string>;
};

type HttpScenario = ScenarioSpec & {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
};

type HttpCheck =
  | (CheckSpec & { type: "status"; equals: number })
  | (CheckSpec & {
      type: "header";
      name: string;
      match: "equals" | "contains" | "regex";
      value: string;
    })
  | (CheckSpec & {
      type: "body";
      match: "equals" | "contains" | "regex";
      value: string;
    })
  | (CheckSpec & {
      type: "json";
      path: string;
      equals?: unknown;
      exists?: boolean;
    })
  | (CheckSpec & { type: "latency"; maxMs: number });

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function headers(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) output[key] = nonEmpty(item, `${path}.${key}`);
  return output;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}

function parseTarget(contract: AcceptanceContract): HttpTarget {
  if (contract.target.kind !== "http") throw new Error("http adapter requires target.kind=http");
  return {
    ...contract.target,
    kind: "http",
    baseUrl: nonEmpty(contract.target.baseUrl, "target.baseUrl"),
    ...(contract.target.headers === undefined
      ? {}
      : { headers: headers(contract.target.headers, "target.headers") }),
  };
}

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const HARD_MAX_BYTES = 100 * 1024 * 1024;

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null && Number.isFinite(Number(length)) && Number(length) > maxBytes) {
    throw new Error(`HTTP body exceeds maxBytes=${maxBytes} (content-length=${length})`);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`HTTP body exceeds maxBytes=${maxBytes}`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

function parseScenario(value: ScenarioSpec, index: number): HttpScenario {
  const raw = value as Record<string, unknown>;
  const timeoutMs = raw.timeoutMs === undefined ? undefined : number(raw.timeoutMs, `scenarios[${index}].timeoutMs`);
  if (timeoutMs !== undefined && timeoutMs <= 0) throw new Error(`scenarios[${index}].timeoutMs must be > 0`);
  const maxBytes = raw.maxBytes === undefined ? DEFAULT_MAX_BYTES : number(raw.maxBytes, `scenarios[${index}].maxBytes`);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > HARD_MAX_BYTES) {
    throw new Error(`scenarios[${index}].maxBytes must be an integer from 1 to ${HARD_MAX_BYTES}`);
  }
  return {
    id: value.id,
    ...(raw.path === undefined ? {} : { path: nonEmpty(raw.path, `scenarios[${index}].path`) }),
    ...(raw.method === undefined ? {} : { method: nonEmpty(raw.method, `scenarios[${index}].method`).toUpperCase() }),
    ...(raw.headers === undefined ? {} : { headers: headers(raw.headers, `scenarios[${index}].headers`) }),
    ...(raw.body === undefined ? {} : { body: nonEmpty(raw.body, `scenarios[${index}].body`) }),
    ...(raw.json === undefined ? {} : { json: raw.json }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    maxBytes,
  };
}

function parseCheck(value: CheckSpec, index: number): HttpCheck {
  const raw = value as Record<string, unknown>;
  const common = {
    id: value.id,
    type: value.type,
    severity: (value.severity ?? "must") as Severity,
    ...(value.scenarios ? { scenarios: value.scenarios } : {}),
  };

  switch (value.type) {
    case "status":
      return { ...common, type: "status", equals: number(raw.equals, `checks[${index}].equals`) };
    case "header": {
      const match = nonEmpty(raw.match, `checks[${index}].match`);
      if (!["equals", "contains", "regex"].includes(match)) throw new Error(`checks[${index}].match is invalid`);
      return {
        ...common,
        type: "header",
        name: nonEmpty(raw.name, `checks[${index}].name`),
        match: match as "equals" | "contains" | "regex",
        value: nonEmpty(raw.value, `checks[${index}].value`),
      };
    }
    case "body": {
      const match = nonEmpty(raw.match, `checks[${index}].match`);
      if (!["equals", "contains", "regex"].includes(match)) throw new Error(`checks[${index}].match is invalid`);
      return {
        ...common,
        type: "body",
        match: match as "equals" | "contains" | "regex",
        value: nonEmpty(raw.value, `checks[${index}].value`),
      };
    }
    case "json":
      if (raw.equals === undefined && raw.exists === undefined) {
        throw new Error(`checks[${index}] json requires equals or exists`);
      }
      if (raw.exists !== undefined && typeof raw.exists !== "boolean") {
        throw new Error(`checks[${index}].exists must be boolean`);
      }
      return {
        ...common,
        type: "json",
        path: nonEmpty(raw.path, `checks[${index}].path`),
        ...(raw.equals === undefined ? {} : { equals: raw.equals }),
        ...(raw.exists === undefined ? {} : { exists: raw.exists }),
      };
    case "latency":
      return { ...common, type: "latency", maxMs: number(raw.maxMs, `checks[${index}].maxMs`) };
    default:
      throw new Error(`http adapter does not support check type: ${value.type}`);
  }
}

function jsonPath(root: unknown, path: string): { exists: boolean; value?: unknown } {
  let current = root;
  for (const part of path.split(".").filter(Boolean)) {
    if (current === null || typeof current !== "object" || !(part in current)) return { exists: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

function selected(check: HttpCheck, scenario: HttpScenario): boolean {
  return !check.scenarios || check.scenarios.includes(scenario.id);
}

export const httpAdapter: Adapter = {
  kind: "http",

  async run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]> {
    const target = parseTarget(contract);
    const scenarios = contract.scenarios.map(parseScenario);
    const checks = contract.checks.map(parseCheck);
    await mkdir(context.evidenceDir, { recursive: true });

    const reports: ScenarioReport[] = [];
    for (const scenario of scenarios) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), scenario.timeoutMs ?? 30_000);
      const url = new URL(scenario.path ?? "/", target.baseUrl).toString();
      const started = performance.now();
      let response: Response | null = null;
      let body = Buffer.alloc(0);
      let text = "";
      let blocked: string | null = null;

      try {
        const requestHeaders = {
          ...(scenario.json !== undefined ? { "content-type": "application/json" } : {}),
          ...target.headers,
          ...scenario.headers,
        };
        response = await fetch(url, {
          method: scenario.method ?? "GET",
          headers: requestHeaders,
          ...(scenario.json !== undefined
            ? { body: JSON.stringify(scenario.json) }
            : scenario.body !== undefined
              ? { body: scenario.body }
              : {}),
          signal: controller.signal,
        });
        body = await readBounded(response, scenario.maxBytes ?? DEFAULT_MAX_BYTES);
        text = body.toString("utf8");
      } catch (error) {
        blocked = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timeout);
      }

      const durationMs = performance.now() - started;
      let parsedJson: unknown = undefined;
      try {
        parsedJson = text ? JSON.parse(text) : undefined;
      } catch {
        // JSON checks will report BLOCKED when parsing is required.
      }

      const results: CheckResult[] = [];
      for (const check of checks) {
        if (!selected(check, scenario)) {
          results.push(checkResult(check, "SKIPPED", `not selected for scenario ${scenario.id}`));
          continue;
        }
        if (blocked || !response) {
          results.push(checkResult(check, "BLOCKED", blocked ?? "no HTTP response"));
          continue;
        }

        switch (check.type) {
          case "status":
            results.push(checkResult(
              check,
              response.status === check.equals ? "PASS" : "FAIL",
              response.status === check.equals ? "HTTP status matched" : "HTTP status differed",
              check.equals,
              response.status,
            ));
            break;
          case "header": {
            const actual = response.headers.get(check.name) ?? "";
            const pass = matches(actual, check.match, check.value);
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "header matched" : "header differed", { match: check.match, value: check.value }, actual));
            break;
          }
          case "body": {
            const mime = response.headers.get("content-type") ?? "";
            if (mime && !/(^text\/|json|xml|javascript|x-www-form-urlencoded)/i.test(mime)) {
              results.push(checkResult(check, "BLOCKED", "text check requires a textual HTTP response"));
              break;
            }
            const pass = matches(text, check.match, check.value);
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "body matched" : "body differed", { match: check.match, value: check.value }, text.slice(0, 500)));
            break;
          }
          case "json": {
            if (parsedJson === undefined) {
              results.push(checkResult(check, "BLOCKED", "response body is not valid JSON"));
              break;
            }
            const found = jsonPath(parsedJson, check.path);
            const existencePass = check.exists === undefined || found.exists === check.exists;
            const equalityPass = check.equals === undefined || (found.exists && JSON.stringify(found.value) === JSON.stringify(check.equals));
            const pass = existencePass && equalityPass;
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "JSON path matched" : "JSON path differed", { path: check.path, equals: check.equals, exists: check.exists }, found));
            break;
          }
          case "latency": {
            const pass = durationMs <= check.maxMs;
            results.push(checkResult(check, pass ? "PASS" : "FAIL", pass ? "latency stayed within budget" : "latency exceeded budget", { maxMs: check.maxMs }, durationMs));
            break;
          }
        }
      }

      const saveBody = contract.evidence?.body === true;
      let bodyArtifact: string | undefined;
      if (saveBody && response && !blocked) {
        const mime = response.headers.get("content-type") ?? "";
        const textual = !mime || /(^text\/|json|xml|javascript|x-www-form-urlencoded)/i.test(mime);
        const absolute = resolve(context.evidenceDir, `${scenario.id}.body.${textual ? "txt" : "bin"}`);
        await writeFile(absolute, body);
        bodyArtifact = relative(context.cwd, absolute);
      }

      reports.push({
        id: scenario.id,
        verdict: scenarioVerdict(results),
        evidence: {
          url,
          method: scenario.method ?? "GET",
          ...(response
            ? {
                status: response.status,
                headers: (() => {
                  const values: Record<string, string> = {};
                  response.headers.forEach((value, key) => {
                    values[key] = value;
                  });
                  return redactSecrets(values);
                })(),
              }
            : {}),
          durationMs,
          bodyBytes: body.byteLength,
          ...(blocked ? {} : { bodySha256: createHash("sha256").update(body).digest("hex") }),
          maxBytes: scenario.maxBytes,
          ...(bodyArtifact ? { artifacts: [bodyArtifact] } : {}),
          ...(blocked ? { error: blocked } : {}),
        },
        checks: results,
      });
    }
    return reports;
  },
};
