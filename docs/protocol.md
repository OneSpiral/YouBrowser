# Acceptance Protocol

YouBrowser separates five things that are often collapsed into one word: "validation".

```text
Target → Scenario → Observation → Check → Evidence → Verdict
```

## Target

The thing being accepted. A target has a `kind` owned by an adapter.

Version 0.1 ships the `web` adapter. The protocol is intentionally open to future
`http`, `file`, `json`, `image`, `command`, `repo`, `research`, and
`content` adapters without changing the verdict model.

## Scenario

A bounded execution condition. For the browser this includes route, viewport,
colour scheme, reduced motion, locale, and waits.

A scenario is not evidence that another state was tested. Loading, error, hover,
focus, drag, auth, or business states need their own explicit scenarios or adapter
actions when supported.

## Observation

Facts collected from the target: response status, DOM state, text, attributes,
console errors, page errors, geometry, screenshots, and later other adapter-specific facts.

Observation is not acceptance.

## Check

A predicate over observations.

Checks have three severities:

- `must` — failure makes the run fail.
- `should` — failure is reported as a warning but does not redefine the required contract.
- `observe` — records a result without affecting acceptance.

A check may be scoped to selected scenarios.

## Evidence

Evidence is retained material that lets a human or agent inspect what actually happened.

Evidence is not canonical truth and is not the verdict itself.

## Verdict

The protocol uses four states:

- `PASS` — required checks passed.
- `FAIL` — at least one required check contradicted the contract.
- `BLOCKED` — a required check could not be evaluated.
- `SKIPPED` — the check or scenario was deliberately out of scope.

There is no universal scalar quality score. Qualitative judgment should be represented
by explicit judge adapters with named criteria and retained evidence, not hidden inside
a number.

## Adapter boundary

Adapters own execution and observation for a target kind. They must return scenario
reports in the shared verdict/evidence model.

This keeps the acceptance protocol stable while new result types gain specialized
observation mechanisms.
