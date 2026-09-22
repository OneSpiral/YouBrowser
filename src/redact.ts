import type { Target } from "./model.js";

const sensitive = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|secret|password|passwd|credential|.*(?:password|passwd|secret|credential|private[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|session[-_]?token|api[-_]?key).*)$/i;
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
