import type {
  AcceptanceContract,
  BrowserCheck,
  BrowserScenario,
  Severity,
  WebTarget,
} from "./model.js";

export type BrowserContract = Omit<AcceptanceContract, "target" | "scenarios" | "checks"> & {
  target: WebTarget;
  scenarios: BrowserScenario[];
  checks: BrowserCheck[];
  evidence?: AcceptanceContract["evidence"] & {
    screenshots?: boolean;
    fullPage?: boolean;
  };
};

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

function browserScenario(value: unknown, index: number): BrowserScenario {
  const raw = object(value, `scenarios[${index}]`);
  const scenario: BrowserScenario = { id: string(raw.id, `scenarios[${index}].id`) };

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
    const wait: NonNullable<BrowserScenario["wait"]> = {};
    if (waitRaw.selector !== undefined) wait.selector = string(waitRaw.selector, `scenarios[${index}].wait.selector`);
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

function browserCheck(value: unknown, index: number): BrowserCheck {
  const raw = object(value, `checks[${index}]`);
  const id = string(raw.id, `checks[${index}].id`);
  const type = string(raw.type, `checks[${index}].type`);
  const severity = (raw.severity ?? "must") as Severity;
  const scenarios = raw.scenarios as string[] | undefined;
  const common = {
    id,
    severity,
    ...(scenarios ? { scenarios } : {}),
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
      return { ...common, type, maxErrors: integer(raw.maxErrors, `checks[${index}].maxErrors`) };
    case "overflow":
      if (raw.axis !== "x" && raw.axis !== "y") throw new Error(`checks[${index}].axis must be x or y`);
      return {
        ...common,
        type,
        axis: raw.axis,
        ...(raw.maxPx === undefined ? {} : { maxPx: integer(raw.maxPx, `checks[${index}].maxPx`) }),
      };
    default:
      throw new Error(`web adapter does not support check type: ${type}`);
  }
}

export function parseBrowserContract(contract: AcceptanceContract): BrowserContract {
  if (contract.target.kind !== "web") throw new Error("browser adapter requires target.kind=web");
  const baseUrl = string(contract.target.baseUrl, "target.baseUrl");

  const evidenceRaw = contract.evidence ?? {};
  if (evidenceRaw.screenshots !== undefined && typeof evidenceRaw.screenshots !== "boolean") {
    throw new Error("evidence.screenshots must be boolean");
  }
  if (evidenceRaw.fullPage !== undefined && typeof evidenceRaw.fullPage !== "boolean") {
    throw new Error("evidence.fullPage must be boolean");
  }

  return {
    ...contract,
    target: { ...contract.target, kind: "web", baseUrl },
    scenarios: contract.scenarios.map(browserScenario),
    checks: contract.checks.map(browserCheck),
    evidence: {
      ...evidenceRaw,
      ...(evidenceRaw.screenshots === undefined ? {} : { screenshots: evidenceRaw.screenshots }),
      ...(evidenceRaw.fullPage === undefined ? {} : { fullPage: evidenceRaw.fullPage }),
    },
  };
}
