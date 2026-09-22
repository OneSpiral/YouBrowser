export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type Severity = "must" | "should" | "observe";
export type ColorScheme = "light" | "dark";
export type ReducedMotion = "no-preference" | "reduce";

export type Target = {
  kind: string;
  [key: string]: unknown;
};

export type ScenarioSpec = {
  id: string;
  [key: string]: unknown;
};

export type CheckSpec = {
  id: string;
  type: string;
  severity?: Severity;
  scenarios?: string[];
  [key: string]: unknown;
};

export type EvidenceConfig = {
  dir?: string;
  [key: string]: unknown;
};

export type AcceptanceContract = {
  version: 1;
  target: Target;
  scenarios: ScenarioSpec[];
  checks: CheckSpec[];
  evidence?: EvidenceConfig;
};

export type CaptureContract = {
  version: 1;
  target: Target;
  scenarios: ScenarioSpec[];
  evidence?: EvidenceConfig;
};

export type CheckResult = {
  id: string;
  type: string;
  severity: Severity;
  verdict: Verdict;
  message: string;
  expected?: unknown;
  observed?: unknown;
};

export type ScenarioEvidence = {
  artifacts?: string[];
  [key: string]: unknown;
};

export type ScenarioReport = {
  id: string;
  verdict: Verdict;
  evidence: ScenarioEvidence;
  checks: CheckResult[];
};

export type CaptureReport = {
  version: 1;
  target: Target;
  startedAt: string;
  finishedAt: string;
  scenarios: Array<{
    id: string;
    evidence: ScenarioEvidence;
  }>;
};

export type AcceptanceReceipt = {
  version: 1;
  protocol: 1;
  kind: "acceptance";
  targetKind: string;
  verdict: Verdict;
  contractSha256: string;
  reportSha256: string;
  startedAt: string;
  finishedAt: string;
  summary: AcceptanceReport["summary"];
  scenarios: Array<{
    id: string;
    verdict: Verdict;
  }>;
  receiptSha256: string;
};

export type AcceptanceReport = {
  version: 1;
  target: Target;
  verdict: Verdict;
  startedAt: string;
  finishedAt: string;
  scenarios: ScenarioReport[];
  summary: {
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    warnings: number;
  };
};

export type WebTarget = Target & {
  kind: "web";
  baseUrl: string;
};

export type Wait = {
  selector?: string;
  timeoutMs?: number;
  networkIdle?: boolean;
};

export type BrowserScenario = ScenarioSpec & {
  path?: string;
  viewport?: {
    width: number;
    height: number;
  };
  colorScheme?: ColorScheme;
  reducedMotion?: ReducedMotion;
  locale?: string;
  wait?: Wait;
};

type BrowserCheckBase = CheckSpec & {
  severity?: Severity;
  scenarios?: string[];
};

export type StatusCheck = BrowserCheckBase & {
  type: "status";
  equals: number;
};

export type TitleCheck = BrowserCheckBase & {
  type: "title";
  match: "equals" | "contains" | "regex";
  value: string;
};

export type VisibleCheck = BrowserCheckBase & {
  type: "visible";
  selector: string;
};

export type TextCheck = BrowserCheckBase & {
  type: "text";
  selector: string;
  match: "equals" | "contains" | "regex";
  value: string;
};

export type CountCheck = BrowserCheckBase & {
  type: "count";
  selector: string;
  equals?: number;
  min?: number;
  max?: number;
};

export type AttributeCheck = BrowserCheckBase & {
  type: "attribute";
  selector: string;
  name: string;
  match: "equals" | "contains" | "regex";
  value: string;
};

export type ConsoleCheck = BrowserCheckBase & {
  type: "console";
  maxErrors: number;
};

export type OverflowCheck = BrowserCheckBase & {
  type: "overflow";
  axis: "x" | "y";
  maxPx?: number;
};

export type BrowserCheck =
  | StatusCheck
  | TitleCheck
  | VisibleCheck
  | TextCheck
  | CountCheck
  | AttributeCheck
  | ConsoleCheck
  | OverflowCheck;
