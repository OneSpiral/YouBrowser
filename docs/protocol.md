# Acceptance Protocol

YouBrowser separates five things that are often collapsed into one word: "validation".

```text
capture: Target → Scenario → Observation → Evidence
verify:  Target → Scenario → Observation → Check → Evidence → Verdict → Receipt
```

## Target

The thing being accepted. A target has a `kind` owned by an adapter.

The current draft implements `web`, `http`, `file`, and `command`.
Other target kinds remain planned until they satisfy the adapter promotion
rule in [adapters.md](adapters.md).

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

Evidence is not canonical truth and is not the verdict itself. Capture
reports retain observation states (`CAPTURED` / `BLOCKED`), never acceptance
verdicts. Verify reports retain individual check results and an overall
verdict. Retained screenshot/body artifacts are fingerprinted by SHA-256,
and local receipt inspection rechecks their bytes. A receipt is not a
signature or external attestation.

## Verdict

The protocol uses four states:

- `PASS` — required checks passed.
- `FAIL` — at least one required check contradicted the contract.
- `BLOCKED` — a required check could not be evaluated.
- `SKIPPED` — the check or scenario was deliberately out of scope.

There is no universal scalar quality score. Qualitative judgment should be represented
by explicit judge adapters with named criteria and retained evidence, not hidden inside
a number.

## Declared coverage

A contract is not satisfied merely because an adapter returned a collection
of passing results. The runner audits the complete declared scenario × check
matrix, including scope, check identity, type and severity. A missing/duplicate
scenario or check, a selected check marked SKIPPED, or a mismatched scenario
verdict is recorded in `coverage.problems`. Incomplete coverage blocks the
overall verdict unless an actual required check already establishes FAIL.
Scenarios with no applicable must checks are SKIPPED, not PASS.

## Receipt

`verify` writes `report.json`, `report.md` and `receipt.json`.
The receipt records the canonical original contract digest, exact report
bytes digest, and retained artifact digests. `receipt` mode rechecks these
facts without rerunning the target. If an artifact is unavailable or changed,
the inspection is invalid. A failed verification run may still emit a
traceable receipt; receipt validity never turns `FAIL` into `PASS`.

## Adapter boundary

Adapters own execution and observation for a target kind. They must return scenario
reports in the shared verdict/evidence model.

This keeps the acceptance protocol stable while new result types gain specialized
observation mechanisms.
