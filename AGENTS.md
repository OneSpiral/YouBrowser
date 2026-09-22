# YouBrowser Agent Contract

YouBrowser is an evidence-first acceptance runtime. Its job is to make acceptance
claims traceable, not to manufacture confidence.

## Invariants

- Observation, evidence, check, and verdict are distinct concepts.
- No result is `PASS` merely because a command completed or a screenshot exists.
- Required uncertainty is `BLOCKED`, never silently converted to `PASS`.
- A failed `should` criterion is a warning; it does not secretly become a required failure.
- Do not invent a universal quality score.
- Deterministic assertions and qualitative judgment use different adapters/criteria.
- Every adapter keeps the shared `PASS / FAIL / BLOCKED / SKIPPED` semantics.
- Evidence paths describe what was observed; they are not a second source of domain truth.
- New target kinds extend the adapter registry instead of branching the protocol.

## Current scope

The first adapter is `web`, backed by Playwright. Keep browser-specific behavior
inside the browser adapter and generic acceptance semantics in the shared model.

Future adapters may accept files, APIs, images, commands, repositories, research
artifacts, or content, but only when they can emit honest observations and evidence.
