import type { Target } from "./model.js";

const sensitive = /authorization|cookie|api[-_]?key|private[-_]?key|password|passwd|secret|credential|token|session/i;
const REDACTED = "[REDACTED]";

/**
 * For persisted reports only. Never mutate the executable contract: its original
 * values are needed by adapters and are fingerprinted by the receipt.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitive.test(key) ? REDACTED : redactSecrets(item),
    ]),
  );
}

export function reportTarget(target: Target): Target {
  return redactSecrets(target) as Target;
}
