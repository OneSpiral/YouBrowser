# YouBrowser

**Evidence-first acceptance runtime for agent and software outputs.**

YouBrowser has two deliberately separate modes:

```text
capture: Target → Scenario → Observation → Evidence
verify:  Target → Scenario → Observation → Check → Evidence → Verdict → Receipt
```

`capture` gathers evidence without pretending that observation is acceptance.
`verify` is fail-closed and produces an Acceptance Receipt only after required checks are evaluated.

It starts with real-browser verification, but the protocol is target-agnostic. The long-term goal is one acceptance surface for web products, APIs, files, images, commands, repositories, research artifacts, and generated content.

## Why

Agents are increasingly good at producing outputs and still weak at proving those outputs are correct.

A screenshot is not a pass.  
A successful command is not a pass.  
A generated file is not a pass.  
An LLM saying "looks good" is not a pass.

YouBrowser separates the things that are usually collapsed into "validation":

- **Target** — what is being accepted.
- **Scenario** — the bounded condition under which it is exercised.
- **Observation** — what actually happened.
- **Check** — an explicit predicate over observations.
- **Evidence** — retained material that supports inspection.
- **Verdict** — `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`.

There is no universal quality score.

## Current status

The v0.1 draft establishes the protocol and implements four adapters:

- `web` — real-browser verification via Playwright/Chromium
- `http` — API/data-source verification with status/header/body/JSON/latency checks
- `file` — artifact verification with existence/size/text/JSON checks and SHA-256 evidence
- `command` — shell-free, output-bounded process verification with exit/stdout/stderr/duration checks
- desktop/mobile or arbitrary viewport scenarios
- light/dark colour scheme
- reduced-motion scenarios
- HTTP status checks
- title checks
- visible-element checks
- text checks
- element-count checks
- attribute checks
- console/page-error budgets
- overflow checks
- screenshots
- single-browser-navigation TTFB and DOMContentLoaded observations/checks
- JSON + Markdown evidence reports
- fail-closed contract parsing
- bounded HTTP response collection (16 MiB default, up to 100 MiB per scenario)
- origin-scoped, serial multi-request HTTP capture with request/byte/delay budgets
- binary-safe raw HTTP capture, with per-artifact SHA-256
- receipt inspection that rechecks report and artifact bytes

Future target adapters can extend the same protocol without changing verdict semantics.

## Install

```bash
bun install
bunx playwright install chromium
bun run build
```

The built CLI also runs on Node.js 20+.

## Quick start

Create an acceptance contract:

```json
{
  "version": 1,
  "target": {
    "kind": "web",
    "baseUrl": "https://example.com"
  },
  "scenarios": [
    {
      "id": "desktop",
      "path": "/",
      "viewport": { "width": 1440, "height": 900 },
      "colorScheme": "light",
      "reducedMotion": "no-preference"
    }
  ],
  "checks": [
    {
      "id": "status",
      "type": "status",
      "equals": 200,
      "severity": "must"
    },
    {
      "id": "heading",
      "type": "text",
      "selector": "h1",
      "match": "contains",
      "value": "Example Domain",
      "severity": "must"
    },
    {
      "id": "runtime-errors",
      "type": "console",
      "maxErrors": 0,
      "severity": "should"
    }
  ]
}
```

Run acceptance:

```bash
bun run src/cli.ts verify contract.json
```

Run observation-only capture:

```bash
bun run src/cli.ts capture capture.json
```

or after building:

```bash
youbrowser verify contract.json
youbrowser receipt contract.json  # inspect retained report and artifact bytes
youbrowser capture capture.json
```

Evidence lands in `.youbrowser/` by default:

```text
.youbrowser/
├── desktop.png
├── report.json
├── report.md
└── receipt.json

.youbrowser-capture/
├── capture.json
└── dataset.body.txt
```

## Verdict semantics

| Verdict | Meaning |
| --- | --- |
| `PASS` | All required (`must`) checks were evaluated and passed. |
| `FAIL` | At least one required check contradicted the contract. |
| `BLOCKED` | A required check could not be evaluated honestly. |
| `SKIPPED` | The check/scenario was explicitly outside the current scope. |

Check severity is independent:

- `must`: affects acceptance.
- `should`: becomes a warning when it does not pass.
- `observe`: records evidence without changing acceptance.

A verify contract must contain at least one `must` check. Empty verification cannot become `PASS`.

A capture contract accepts no checks and emits no acceptance verdict. If criteria matter, use `verify`.

The runtime audits the declared scenario/check matrix before issuing PASS.
Missing, duplicate, or wrongly skipped results cause a coverage failure and
`BLOCKED` (unless an actual required check already establishes `FAIL`).

Every completed verify execution writes `receipt.json` with SHA-256 fingerprints for the original normalized contract, the exact JSON report bytes, retained screenshot/body artifacts, and the receipt payload itself. Run `youbrowser receipt contract.json` to recheck local bytes. This detects drift; it is **not** a cryptographic signature, independent attestation, or protection against someone rewriting all files.

Capture reports use `CAPTURED / BLOCKED` *observation states*, not acceptance verdicts. Missing evidence makes the CLI return a non-zero exit code. Sensitive target headers/environment keys and response headers are redacted in persisted reports, without modifying the executable contract. Explicit raw body capture may still contain personal or secret data; protect the evidence directory.

HTTP collection is explicitly origin-scoped (base origin by default), serial,
and governed by request/aggregate-byte budgets. It does not follow redirects
or automatically discover links. This is not a full Crawl adapter.
HTTP capture preserves the original response bytes. Textual responses use `<id>.body.txt`, binary responses use `<id>.body.bin`. `maxBytes` defaults to 16 MiB per scenario (hard cap: 100 MiB); over-budget responses are blocked rather than saved partially.

## Architecture

YouBrowser has two extension axes.

### Adapters — how to observe

```text
web      → browser/DOM/network/runtime evidence       [implemented]
http     → request/response evidence                  [implemented]
file     → filesystem/content/hash evidence           [implemented]
command  → process/output evidence                    [implemented]
json     → schema/value evidence                      [planned]
image    → geometry/perceptual evidence               [planned]
repo     → source/build/test evidence                 [planned]
crawl    → multi-resource collection evidence         [planned]
perf     → single-target performance evidence         [planned]
load     → concurrent/load evidence                   [planned]
research → citation/data/method evidence              [planned]
content  → structure/claim/style evidence             [planned]
```

`web`, `http`, `file`, and `command` are implemented today. `json`, `image`, `repo`, `research`, `content`, `crawl`, `perf`, and `load` remain protocol directions until they satisfy the adapter promotion rule.

### Judges — how to decide

Deterministic checks should stay deterministic.

Qualitative acceptance — visual taste, writing quality, research quality, product fit — should use explicit judge adapters with named criteria and retained evidence. A judge must never hide uncertainty inside a scalar score.

That makes combinations possible without changing the protocol:

```text
web  + accessibility criteria
web  + Holar taste criteria
repo + engineering criteria
paper + research criteria
content + editorial criteria
```

## Design principles

1. **Fail closed.** Missing required evidence is `BLOCKED`, not `PASS`.
2. **Evidence ≠ verdict.** Capturing something does not prove it is acceptable.
3. **Observation ≠ truth.** Adapters report what they observed in a bounded scenario.
4. **No silent scope expansion.** Untested states remain untested.
5. **No universal score.** Keep individual criteria legible.
6. **Protocol before plugins.** New result types extend adapters instead of forking acceptance semantics.
7. **Machine and human judgment stay distinguishable.** A deterministic assertion and a qualitative review are different evidence classes.

See [docs/protocol.md](docs/protocol.md) for the protocol contract and [SECURITY.md](SECURITY.md) for the trusted-contract/evidence boundary.

## Holar

Holar can consume YouBrowser as its execution/evidence layer while keeping Holar-specific rules in Holar.

For example:

```text
YouBrowser
  owns: browser execution, scenarios, observations, evidence, verdict protocol

Holar
  owns: composition canon, taste canon, design criteria, Golden promotion policy
```

That keeps the reusable acceptance engine independent of Holar's domain rules. This public repository is **not yet an open-source release** until an explicit LICENSE is selected and added.

## Development

```bash
bun run check
bun test
bun run build
```

The repository intentionally keeps the v0.1 surface small. New checks and adapters should be added only when they produce an observable fact that can be represented honestly in the shared protocol.
