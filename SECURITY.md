# Security boundary

YouBrowser executes **trusted local contracts**. It is not a sandbox for
arbitrary contracts supplied by strangers. Treat a contract like executable
code before running it.

## Execution

- `command` launches the declared executable without a shell. This prevents
  accidental shell interpretation, **not** arbitrary code execution. Its
  arguments, working directory and environment are controlled by the contract.
- `http` and `web` can access addresses reachable from the runner. Do not
  accept untrusted URLs: this release does not promise SSRF isolation,
  private-network filtering or sandboxed browser execution.
- Run unknown workloads in separately permissioned, disposable infrastructure.
  Use timeouts, network restrictions and resource limits outside YouBrowser.
- HTTP reads are bounded to 16 MiB per scenario by default (at most 100 MiB),
  with a 50-request / 64-MiB aggregate default and hard limits of 500 requests
  / 256 MiB per run. The adapter enforces explicit allowed origins and does
  not follow redirects. These limits are not SSRF isolation, robots handling,
  global infrastructure quotas, or proof that the target permits collection.

## Evidence

- Scenario identifiers reject path separators and traversal, so generated
  screenshot/body names cannot escape the evidence directory.
- Retained artifacts are hashed, and paths resolving outside the evidence
  directory are rejected. A local receipt can be rechecked with
  `youbrowser receipt contract.json`.
- A receipt is a local integrity check, not a digital signature, third-party
  attestation, trusted timestamp or immutable audit log. Someone able to
  rewrite the report, artifacts and receipt together can fabricate a coherent
  bundle. Retain independent copies or use external signing if needed.
- The original contract is fingerprinted but not copied into the report.
  Credential-bearing target fields and HTTP response headers are redacted
  from report JSON. Redaction is best effort; values may still appear in
  response bodies, URLs, stdout/stderr or page content.
- Raw response-body capture is opt-in (`evidence.body: true`). It can contain
  personal information and secrets. Keep `.youbrowser*/` out of version control,
  restrict artifact access, and apply your own retention policy.
- Do not confuse runtime diagnostics with durable business/domain evidence.
  Consumer systems own their canonical data and approval records.

## Limits

This release does not implement robots-aware crawling, distributed load
generation, scheduled monitoring, secret vaulting, multi-tenant isolation,
untrusted-code sandboxing, or unrestricted performance claims. Future adapters
must earn their status through bounded contracts and real end-to-end evidence.

To report a suspected vulnerability, use the repository's private security
reporting channel when available; avoid publishing credentials or exploit
details in a public issue.
