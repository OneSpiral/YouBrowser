export type Verdict = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
export type Severity = "must" | "should" | "observe";
export type ColorScheme = "light" | "dark";
export type ReducedMotion = "no-preference" | "reduce";

export type Target = {
  kind: string;
  [key: string]: unknown;
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

export type Scenario = {
  id: string;
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

type CheckBase = {
  id: string;
  severity?: Severity;
  scenarios?: string[];
};

export type StatusCheck = CheckBase & {
  type: "status";
  equals: number;
};

export type TitleCheck = CheckBase & {
  type: "title";
  match: "equals" | "contains" | "regex";
  value: string;
};

export type VisibleCheck = CheckBase & {
  type: "visible";
  selector: string;
};

export type TextCheck = CheckBase & {
  type: "text";
  selector: string;
  match: "equals" | "contains" | "regex";
  value: string;
};

export type CountCheck = CheckBase & {
  type: "count";
  selector: string;
  equals?: number;
  min?: number;
  max?: number;
};

export type AttributeCheck = CheckBase & {
  type: "attribute";
  selector: string;
  name: string;
  match: "equals" | "contains" | "regex";
  value: string;
};

export type ConsoleCheck = CheckBase & {
  type: "console";
  maxErrors: number;
};

export type OverflowCheck = CheckBase & {
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

export type AcceptanceContract = {
  version: 1;
  target: Target;
  scenarios: Scenario[];
  checks: BrowserCheck[];
  evidence?: {
    dir?: string;
    screenshots?: boolean;
  };
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
  screenshot?: string;
  url: string;
  status?: number;
  title?: string;
  consoleErrors: string[];
  pageErrors: string[];
};

export type ScenarioReport = {
  id: string;
  verdict: Verdict;
  evidence: ScenarioEvidence;
  checks: CheckResult[];
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
