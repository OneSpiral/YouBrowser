import type {
  AcceptanceContract,
  CaptureContract,
  CheckSpec,
  EvidenceConfig,
  ScenarioSpec,
  Severity,
  Target,
} from "./model.js";

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

function identifier(value: unknown, path: string): string {
  const id = string(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
    throw new Error(`${path} must be a safe identifier (1–80 ASCII letters, digits, dots, underscores or hyphens; start with a letter or digit)`);
  }
  return id;
}

function parseScenario(value: unknown, index: number): ScenarioSpec {
  const raw = object(value, `scenarios[${index}]`);
  return {
    ...raw,
    id: identifier(raw.id, `scenarios[${index}].id`),
  };
}

function parseCheck(value: unknown, index: number): CheckSpec {
  const raw = object(value, `checks[${index}]`);
  const severity = raw.severity ?? "must";
  if (!["must", "should", "observe"].includes(String(severity))) {
    throw new Error(`checks[${index}].severity must be must, should, or observe`);
  }

  let scenarios: string[] | undefined;
  if (raw.scenarios !== undefined) {
    if (!Array.isArray(raw.scenarios)) {
      throw new Error(`checks[${index}].scenarios must be an array`);
    }
    if (raw.scenarios.length === 0) {
      throw new Error(`checks[${index}].scenarios cannot be empty`);
    }
    scenarios = raw.scenarios.map((item, itemIndex) =>
      identifier(item, `checks[${index}].scenarios[${itemIndex}]`),
    );
  }

  return {
    ...raw,
    id: identifier(raw.id, `checks[${index}].id`),
    type: string(raw.type, `checks[${index}].type`),
    severity: severity as Severity,
    ...(scenarios ? { scenarios } : {}),
  };
}

function parseBase(value: unknown): {
  raw: Record<string, unknown>;
  target: Target;
  scenarios: ScenarioSpec[];
  evidence?: EvidenceConfig;
} {
  const raw = object(value, "contract");
  if (raw.version !== 1) throw new Error("contract.version must be 1");

  const targetRaw = object(raw.target, "target");
  const target: Target = {
    ...targetRaw,
    kind: string(targetRaw.kind, "target.kind"),
  };

  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0) {
    throw new Error("contract.scenarios must contain at least one scenario");
  }
  const scenarios = raw.scenarios.map(parseScenario);
  const scenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) throw new Error(`duplicate scenario id: ${scenario.id}`);
    scenarioIds.add(scenario.id);
  }

  let evidence: EvidenceConfig | undefined;
  if (raw.evidence !== undefined) {
    const evidenceRaw = object(raw.evidence, "evidence");
    evidence = { ...evidenceRaw };
    if (evidenceRaw.dir !== undefined) {
      evidence.dir = string(evidenceRaw.dir, "evidence.dir");
    }
  }

  return {
    raw,
    target,
    scenarios,
    ...(evidence ? { evidence } : {}),
  };
}

export function parseContract(value: unknown): AcceptanceContract {
  const base = parseBase(value);
  const rawChecks = base.raw.checks;
  if (!Array.isArray(rawChecks) || rawChecks.length === 0) {
    throw new Error("contract.checks must contain at least one check");
  }

  const checks = rawChecks.map(parseCheck);
  const scenarioIds = new Set(base.scenarios.map((scenario) => scenario.id));
  const checkIds = new Set<string>();
  for (const check of checks) {
    if (checkIds.has(check.id)) throw new Error(`duplicate check id: ${check.id}`);
    checkIds.add(check.id);
    for (const scenarioId of check.scenarios ?? []) {
      if (!scenarioIds.has(scenarioId)) {
        throw new Error(`check ${check.id} references unknown scenario: ${scenarioId}`);
      }
    }
  }

  if (!checks.some((check) => (check.severity ?? "must") === "must")) {
    throw new Error("verify contracts require at least one must check");
  }

  return {
    version: 1,
    target: base.target,
    scenarios: base.scenarios,
    checks,
    ...(base.evidence ? { evidence: base.evidence } : {}),
  };
}

export function parseCaptureContract(value: unknown): CaptureContract {
  const base = parseBase(value);
  if (base.raw.checks !== undefined) {
    if (!Array.isArray(base.raw.checks) || base.raw.checks.length > 0) {
      throw new Error("capture contracts do not accept checks; use verify for acceptance criteria");
    }
  }
  return {
    version: 1,
    target: base.target,
    scenarios: base.scenarios,
    ...(base.evidence ? { evidence: base.evidence } : {}),
  };
}
