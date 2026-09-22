import type { AcceptanceContract, ScenarioReport } from "./model.js";

export type RunContext = {
  cwd: string;
  evidenceDir: string;
};

export interface Adapter {
  readonly kind: string;
  run(contract: AcceptanceContract, context: RunContext): Promise<ScenarioReport[]>;
}

const registry = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  if (registry.has(adapter.kind)) throw new Error(`adapter already registered: ${adapter.kind}`);
  registry.set(adapter.kind, adapter);
}

export function getAdapter(kind: string): Adapter {
  const adapter = registry.get(kind);
  if (!adapter) {
    throw new Error(
      `no adapter for target.kind=${kind}; registered: ${[...registry.keys()].sort().join(", ") || "none"}`,
    );
  }
  return adapter;
}

export function adapterKinds(): string[] {
  return [...registry.keys()].sort();
}
