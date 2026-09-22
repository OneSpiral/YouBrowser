import type { AcceptanceContract, BrowserCheck, Scenario } from "./model.js";

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  return value as number;
}

function parseScenario(value: unknown, index: number): Scenario {
  const raw = object(value, `scenarios[${index}]`);
  const scenario: Scenario = { id: string(raw.id, `scenarios[${index}].id`) };

  if (raw.path !== undefined) scenario.path = string(raw.path, `scenarios[${index}].path`);
  if (raw.colorScheme !== undefined) {
    if (raw.colorScheme !== "light" && raw.colorScheme !== "dark") {
      throw new Error(`scenarios[${index}].colorScheme must be light or dark`);
    }
    scenario.colorScheme = raw.colorScheme;
  }
  if (raw.reducedMotion !== undefined) {
    if (raw.reducedMotion !== "no-preference" && raw.reducedMotion !== "reduce") {
      throw new Error(`scenarios[${index}].reducedMotion must be no-preference or reduce`);
    }
    scenario.reducedMotion = raw.reducedMotion;
  }
  if (raw.locale !== undefined) scenario.locale = string(raw.locale, `scenarios[${index}].locale`);

  if (raw.viewport !== undefined) {
    const viewport = object(raw.viewport, `scenarios[${index}].viewport`);
    const width = integer(viewport.width, `scenarios[${index}].viewport.width`);
    const height = integer(viewport.height, `scenarios[${index}].viewport.height`);
    if (width <= 0 || height <= 0) throw new Error(`scenarios[${index}].viewport must be positive`);
    scenario.viewport = { width, height };
  }

  if (raw.wait !== undefined) {
    const waitRaw = object(raw.wait, `scenarios[${index}].wait`);
    const wait: NonNullable<Scenario["wait"]> = {};
    if (waitRaw.selector !== undefined) {
      wait.selector = string(waitRaw.selector, `scenarios[${index}].wait.selector`);
    }
    if (waitRaw.timeoutMs !== undefined) {
      const timeoutMs = integer(waitRaw.timeoutMs, `scenarios[${index}].wait.timeoutMs`);
      if (timeoutMs < 0) throw new Error(`scenarios[${index}].wait.timeoutMs must be >= 0`);
      wait.timeoutMs = timeoutMs;
    }
    if (waitRaw.networkIdle !== undefined) {
      if (typeof waitRaw.networkIdle !== "boolean") {
        throw new Error(`scenarios[${index}].wait.networkIdle must be boolean`);
      }
      wait.networkIdle = waitRaw.networkIdle;
    }
    scenario.wait = wait;
  }

  return scenario;
}

function parseCheck(value: unknown, index: number): BrowserCheck {
  const raw = object(value, `checks[${index}]`);
  const id = string(raw.id, `checks[${index}].id`);
  const type = string(raw.type, `checks[${index}].type`);
  const severity = raw.severity ?? "must";
  if (!["must", "should", "observe"].includes(String(severity))) {
    throw new Error(`checks[${index}].severity must be must, should, or observe`);
  }

  const common = {
    id,
    severity: severity as BrowserCheck["severity"],
    ...(raw.scenarios === undefined
      ? {}
      : {
          scenarios: (() => {
            if (!Array.isArray(raw.scenarios)) {
              throw new Error(`checks[${index}].scenarios must be an array`);
            }
            return raw.scenarios.map((item, itemIndex) =>
              string(item, `checks[${index}].scenarios[${itemIndex}]`),
            );
          })(),
        }),
  };

  const match = () => {
    if (!["equals", "contains", "regex"].includes(String(raw.match))) {
      throw new Error(`checks[${index}].match must be equals, contains, or regex`);
    }
    return raw.match as "equals" | "contains" | "regex";
  };

  switch (type) {
    case "status":
      return { ...common, type, equals: integer(raw.equals, `checks[${index}].equals`) };
    case "title":
      return { ...common, type, match: match(), value: string(raw.value, `checks[${index}].value`) };
    case "visible":
      return { ...common, type, selector: string(raw.selector, `checks[${index}].selector`) };
    case "text":
      return {
        ...common,
        type,
        selector: string(raw.selector, `checks[${index}].selector`),
        match: match(),
        value: string(raw.value, `checks[${index}].value`),
      };
    case "count": {
      const check = {
        ...common,
        type,
        selector: string(raw.selector, `checks[${index}].selector`),
      } as Extract<BrowserCheck, { type: "count" }>;
      if (raw.equals !== undefined) check.equals = integer(raw.equals, `checks[${index}].equals`);
      if (raw.min !== undefined) check.min = integer(raw.min, `checks[${index}].min`);
      if (raw.max !== undefined) check.max = integer(raw.max, `checks[${index}].max`);
      if (check.equals === undefined && check.min === undefined && check.max === undefined) {
        throw new Error(`checks[${index}] count needs equals, min, or max`);
      }
      return check;
    }
    case "attribute":
      return {
        ...common,
        type,
        selector: string(raw.selector, `checks[${index}].selector`),
        name: string(raw.name, `checks[${index}].name`),
        match: match(),
        value: string(raw.value, `checks[${index}].value`),
      };
    case "console":
      return {
        ...common,
        type,
        maxErrors: integer(raw.maxErrors, `checks[${index}].maxErrors`),
      };
    case "overflow":
      if (raw.axis !== "x" && raw.axis !== "y") {
        throw new Error(`checks[${index}].axis must be x or y`);
      }
      return {
        ...common,
        type,
        axis: raw.axis,
        ...(raw.maxPx === undefined ? {} : { maxPx: integer(raw.maxPx, `checks[${index}].maxPx`) }),
      };
    default:
      throw new Error(`checks[${index}].type is unsupported: ${type}`);
  }
}

export function parseContract(value: unknown): AcceptanceContract {
  const raw = object(value, "contract");
  if (raw.version !== 1) throw new Error("contract.version must be 1");

  const target = object(raw.target, "target");
  string(target.kind, "target.kind");

  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error("contract.scenarios must contain at least one scenario");
  }
  if (!Array.isArray(raw.checks)) throw new Error("contract.checks must be an array");

  const scenarios = raw.scenarios.map(parseScenario);
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }

  const checks = raw.checks.map(parseCheck);
  const checkIds = new Set<string>();
  for (const check of checks) {
    if (checkIds.has(check.id)) throw new Error(`duplicate check id: ${check.id}`);
    checkIds.add(check.id);
    for (const scenarioId of check.scenarios ?? []) {
      if (!ids.has(scenarioId)) {
        throw new Error(`check ${check.id} references unknown scenario: ${scenarioId}`);
      }
    }
  }

  let evidence: AcceptanceContract["evidence"];
  if (raw.evidence !== undefined) {
    const evidenceRaw = object(raw.evidence, "evidence");
    evidence = {};
    if (evidenceRaw.dir !== undefined) evidence.dir = string(evidenceRaw.dir, "evidence.dir");
    if (evidenceRaw.screenshots !== undefined) {
      if (typeof evidenceRaw.screenshots !== "boolean") {
        throw new Error("evidence.screenshots must be boolean");
      }
      evidence.screenshots = evidenceRaw.screenshots;
    }
  }

  return {
    version: 1,
    target,
    scenarios,
    checks,
    ...(evidence ? { evidence } : {}),
  };
}
