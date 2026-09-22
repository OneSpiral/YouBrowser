import { spawn } from "node:child_process";
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

type CommandTarget = Target & {
  kind: "command";
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

type CommandScenario = ScenarioSpec & {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type CommandCheck =
  | (CheckSpec & { type: "exit"; equals: number })
  | (CheckSpec & { type: "stdout"; match: "equals" | "contains" | "regex"; value: string })
  | (CheckSpec & { type: "stderr"; match: "equals" | "contains" | "regex"; value: string })
  | (CheckSpec & { type: "duration"; maxMs: number });

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}
function strings(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be a string array`);
  return value as string[];
}
function env(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new Error(`${path}.${key} must be a string`);
    out[key] = item;
  }
  return out;
}

function target(contract: AcceptanceContract): CommandTarget {
  if (contract.target.kind !== "command") throw new Error("command adapter requires target.kind=command");
  return {
    ...contract.target,
    kind: "command",
    executable: text(contract.target.executable, "target.executable"),
    ...(contract.target.args === undefined ? {} : { args: strings(contract.target.args, "target.args") }),
    ...(contract.target.cwd === undefined ? {} : { cwd: text(contract.target.cwd, "target.cwd") }),
    ...(contract.target.env === undefined ? {} : { env: env(contract.target.env, "target.env") }),
  };
}
function scenario(value: ScenarioSpec, index: number): CommandScenario {
  const raw = value as Record<string, unknown>;
  const timeoutMs = raw.timeoutMs === undefined ? 30_000 : finite(raw.timeoutMs, `scenarios[${index}].timeoutMs`);
  const maxOutputBytes = raw.maxOutputBytes === undefined
    ? DEFAULT_MAX_OUTPUT_BYTES
    : finite(raw.maxOutputBytes, `scenarios[${index}].maxOutputBytes`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new Error(`scenarios[${index}].timeoutMs must be 1..600000`);
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > HARD_MAX_OUTPUT_BYTES) {
    throw new Error(`scenarios[${index}].maxOutputBytes must be 1..${HARD_MAX_OUTPUT_BYTES}`);
  }
  return {
    id: value.id,
    ...(raw.args === undefined ? {} : { args: strings(raw.args, `scenarios[${index}].args`) }),
    ...(raw.cwd === undefined ? {} : { cwd: text(raw.cwd, `scenarios[${index}].cwd`) }),
    ...(raw.env === undefined ? {} : { env: env(raw.env, `scenarios[${index}].env`) }),
    timeoutMs,
    maxOutputBytes,
  };
}
function check(value: CheckSpec, index: number): CommandCheck {
  const raw = value as Record<string, unknown>;
  const common = { id: value.id, severity: (value.severity ?? "must") as Severity, ...(value.scenarios ? { scenarios: value.scenarios } : {}) };
  if (value.type === "exit") return { ...common, type: "exit", equals: finite(raw.equals, `checks[${index}].equals`) };
  if (value.type === "duration") return { ...common, type: "duration", maxMs: finite(raw.maxMs, `checks[${index}].maxMs`) };
  if (value.type === "stdout" || value.type === "stderr") {
    const match = text(raw.match, `checks[${index}].match`);
    if (!["equals","contains","regex"].includes(match)) throw new Error(`checks[${index}].match is invalid`);
    return { ...common, type: value.type, match: match as "equals"|"contains"|"regex", value: text(raw.value, `checks[${index}].value`) };
  }
  throw new Error(`command adapter does not support check type: ${value.type}`);
}

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const HARD_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function run(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxOutputBytes: number;
  },
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  outputBytes: number;
  durationMs: number;
  error?: string;
}> {
  return new Promise((resolveRun) => {
    const started = performance.now();
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let failure: string | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (value: { code: number | null; signal: NodeJS.Signals | null; error?: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveRun({
        ...value,
        stdout,
        stderr,
        outputBytes,
        durationMs: performance.now() - started,
      });
    };
    const append = (chunk: Buffer, stream: "stdout" | "stderr") => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, options.maxOutputBytes - outputBytes);
      const part = buffer.subarray(0, remaining).toString("utf8");
      if (stream === "stdout") stdout += part;
      else stderr += part;
      outputBytes += buffer.byteLength;
      if (outputBytes > options.maxOutputBytes && !failure) {
        failure = `process output exceeded maxOutputBytes=${options.maxOutputBytes}`;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.on("error", (error) => finish({ code: null, signal: null, error: error.message }));
    child.on("close", (code, signal) =>
      finish({ code, signal, ...(failure ? { error: failure } : {}) }));
    timer = setTimeout(() => {
      if (!failure) failure = `timeout after ${options.timeoutMs}ms`;
      if (!child.kill("SIGKILL")) {
        finish({ code: null, signal: null, error: failure });
      }
    }, options.timeoutMs);
  });
}

export const commandAdapter: Adapter = {
  kind: "command",
  async run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]> {
    const base = target(contract);
    const scenarios = contract.scenarios.map(scenario);
    const checks = contract.checks.map(check);
    const reports: ScenarioReport[] = [];

    for (const item of scenarios) {
      const execution = await run(
        base.executable,
        [...(base.args ?? []), ...(item.args ?? [])],
        {
          cwd: item.cwd ?? base.cwd ?? context.cwd,
          env: { ...process.env, ...base.env, ...item.env },
          timeoutMs: item.timeoutMs ?? 30_000,
          maxOutputBytes: item.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        },
      );
      const results: CheckResult[] = [];
      for (const criterion of checks) {
        if (criterion.scenarios && !criterion.scenarios.includes(item.id)) {
          results.push(checkResult(criterion, "SKIPPED", `not selected for scenario ${item.id}`));
          continue;
        }
        if (execution.error) {
          results.push(checkResult(criterion, "BLOCKED", execution.error));
          continue;
        }
        if (criterion.type === "exit") {
          const pass = execution.code === criterion.equals;
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? "exit code matched" : "exit code differed", criterion.equals, execution.code));
        } else if (criterion.type === "duration") {
          const pass = execution.durationMs <= criterion.maxMs;
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? "duration stayed within budget" : "duration exceeded budget", { maxMs: criterion.maxMs }, execution.durationMs));
        } else {
          const actual = criterion.type === "stdout" ? execution.stdout : execution.stderr;
          const pass = matches(actual, criterion.match, criterion.value);
          results.push(checkResult(criterion, pass ? "PASS" : "FAIL", pass ? `${criterion.type} matched` : `${criterion.type} differed`, { match: criterion.match, value: criterion.value }, actual.slice(0, 1000)));
        }
      }
      reports.push({
        id: item.id,
        verdict: scenarioVerdict(results),
        evidence: {
          executable: base.executable,
          args: [...(base.args ?? []), ...(item.args ?? [])],
          exitCode: execution.code,
          signal: execution.signal,
          durationMs: execution.durationMs,
          stdoutBytes: Buffer.byteLength(execution.stdout),
          stderrBytes: Buffer.byteLength(execution.stderr),
          outputBytes: execution.outputBytes,
          maxOutputBytes: item.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
          ...(execution.error ? { error: execution.error } : {}),
        },
        checks: results,
      });
    }
    return reports;
  },
};
