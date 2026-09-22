import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCoverage } from "../src/coverage.js";
import { registerAdapter } from "../src/adapter.js";
import { parseContract } from "../src/schema.js";
import { verify } from "../src/verify.js";
import type { AcceptanceContract, ScenarioReport } from "../src/model.js";

const contract: AcceptanceContract = parseContract({
  version: 1,
  target: { kind: "fake-coverage" },
  scenarios: [{ id: "desktop" }, { id: "mobile" }],
  checks: [
    { id: "status", type: "status", severity: "must", equals: 200 },
    { id: "mobile-only", type: "visible", severity: "must", scenarios: ["mobile"], selector: "h1" },
  ],
});

function scenario(id: "desktop" | "mobile", missing = false): ScenarioReport {
  const checks: ScenarioReport["checks"] = [
    { id: "status", type: "status", severity: "must", verdict: "PASS", message: "matched" },
    ...(!missing
      ? [{
          id: "mobile-only",
          type: "visible",
          severity: "must" as const,
          verdict: id === "mobile" ? "PASS" as const : "SKIPPED" as const,
          message: "scoped",
        }]
      : []),
  ];
  return { id, verdict: "PASS", evidence: {}, checks };
}

describe("execution coverage", () => {
  test("accepts correctly scoped must checks", () => {
    expect(auditCoverage(contract, [scenario("desktop"), scenario("mobile")]))
      .toEqual({ complete: true, problems: [] });
  });

  test("blocks a missing declared scenario", () => {
    const result = auditCoverage(contract, [scenario("desktop")]);
    expect(result.complete).toBe(false);
    expect(result.problems).toContain("missing scenario result: mobile");
  });

  test("blocks a missing declared check", () => {
    const result = auditCoverage(contract, [scenario("desktop"), scenario("mobile", true)]);
    expect(result.complete).toBe(false);
    expect(result.problems).toContain("missing check mobile-only in mobile");
  });

  test("blocks a selected check silently marked SKIPPED", () => {
    const mobile = scenario("mobile");
    const check = mobile.checks.find((item) => item.id === "mobile-only");
    if (!check) throw new Error("fixture missing");
    check.verdict = "SKIPPED";
    const result = auditCoverage(contract, [scenario("desktop"), mobile]);
    expect(result.complete).toBe(false);
    expect(result.problems).toContain("selected check skipped: mobile/mobile-only");
  });

  test("blocks duplicate scenario reports", () => {
    const result = auditCoverage(contract, [scenario("desktop"), scenario("desktop"), scenario("mobile")]);
    expect(result.problems).toContain("duplicate scenario result: desktop");
  });
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify is fail-closed on partial adapter execution", () => {
  test("does not issue PASS when the adapter omits a scenario", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "youbrowser-coverage-"));
    dirs.push(cwd);
    registerAdapter({
      kind: "coverage-example",
      async run() {
        return [scenario("desktop")];
      },
    });
    const report = await verify(
      {
        ...contract,
        target: { kind: "coverage-example" },
        evidence: { dir: ".evidence" },
      },
      { cwd },
    );
    expect(report.verdict).toBe("BLOCKED");
    expect(report.coverage.complete).toBe(false);
    expect(report.summary.blocked).toBeGreaterThan(0);
  });
});
