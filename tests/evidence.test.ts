import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import "../src/index.js";
import { capture } from "../src/capture.js";
import { reportHeader, reportTarget, redactSecrets } from "../src/redact.js";
import { parseCaptureContract } from "../src/schema.js";
import { writeReport } from "../src/report.js";
import { inspectReceipt, writeReceipt } from "../src/receipt.js";
import type { AcceptanceContract, AcceptanceReport } from "../src/model.js";

const dirs: string[] = [];
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "youbrowser-evidence-"));
  dirs.push(cwd);
  return cwd;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("capture evidence", () => {
  test("reports missing file as BLOCKED without an acceptance verdict", async () => {
    const cwd = await workspace();
    const contract = parseCaptureContract({
      version: 1,
      target: { kind: "file", root: "." },
      scenarios: [{ id: "missing", path: "never-created.bin" }],
      evidence: { dir: ".evidence" },
    });
    const report = await capture(contract, { cwd });
    expect(report.summary).toEqual({ captured: 0, blocked: 1 });
    expect(report.scenarios[0]?.state).toBe("BLOCKED");
    expect(typeof report.scenarios[0]?.evidence.error).toBe("string");
    const persisted = await readFile(join(cwd, ".evidence", "capture.json"), "utf8");
    expect(persisted).not.toContain('"verdict"');
  });
});

describe("acceptance receipt", () => {
  test("binds retained screenshot bytes and detects modification", async () => {
    const cwd = await workspace();
    const evidenceDir = join(cwd, ".evidence");
    await mkdir(evidenceDir);
    const screenshot = join(evidenceDir, "desktop.png");
    await writeFile(screenshot, Buffer.from("original screenshot bytes"));

    const contract: AcceptanceContract = {
      version: 1,
      target: { kind: "web", baseUrl: "http://127.0.0.1:4173" },
      scenarios: [{ id: "desktop" }],
      checks: [{ id: "status", type: "status", equals: 200, severity: "must" }],
      evidence: { dir: ".evidence" },
    };
    const report: AcceptanceReport = {
      version: 1,
      target: contract.target,
      verdict: "PASS",
      coverage: { complete: true, problems: [] },
      startedAt: "2026-09-22T00:00:00Z",
      finishedAt: "2026-09-22T00:00:01Z",
      scenarios: [{
        id: "desktop",
        verdict: "PASS",
        evidence: { screenshot: relative(cwd, screenshot) },
        checks: [{ id: "status", type: "status", severity: "must", verdict: "PASS", message: "HTTP status matched" }],
      }],
      summary: { pass: 1, fail: 0, blocked: 0, skipped: 0, warnings: 0 },
    };
    const written = await writeReport(report, evidenceDir);
    const receipt = await writeReceipt(contract, report, written.jsonText, evidenceDir, cwd);
    expect(receipt.artifacts).toHaveLength(1);
    expect(receipt.artifacts[0]?.bytes).toBe(Buffer.byteLength("original screenshot bytes"));
    expect((await inspectReceipt(contract, evidenceDir, cwd)).valid).toBe(true);

    await writeFile(screenshot, Buffer.from("modified screenshot bytes"));
    const inspection = await inspectReceipt(contract, evidenceDir, cwd);
    expect(inspection.valid).toBe(false);
    expect(inspection.problems).toContain("retained artifact bytes differ");
  });

  test("rejects artifacts outside the evidence directory", async () => {
    const cwd = await workspace();
    const evidenceDir = join(cwd, ".evidence");
    await mkdir(evidenceDir);
    await writeFile(join(cwd, "outside.png"), "outside");
    const contract: AcceptanceContract = {
      version: 1,
      target: { kind: "web", baseUrl: "http://127.0.0.1:4173" },
      scenarios: [{ id: "desktop" }],
      checks: [{ id: "status", type: "status", equals: 200, severity: "must" }],
    };
    const report: AcceptanceReport = {
      version: 1, target: contract.target, verdict: "PASS",
      coverage: { complete: true, problems: [] },
      startedAt: "2026-09-22T00:00:00Z", finishedAt: "2026-09-22T00:00:01Z",
      scenarios: [{ id: "desktop", verdict: "PASS", evidence: { screenshot: "outside.png" }, checks: [] }],
      summary: { pass: 0, fail: 0, blocked: 0, skipped: 0, warnings: 0 },
    };
    const written = await writeReport(report, evidenceDir);
    await expect(writeReceipt(contract, report, written.jsonText, evidenceDir, cwd))
      .rejects.toThrow("escapes evidence directory");
  });
});

describe("persisted evidence privacy", () => {
  test("redacts credentials without mutating the execution contract", () => {
    const target = {
      kind: "http",
      baseUrl: "https://example.com",
      headers: { Authorization: "Bearer private", "x-api-key": "secret-key", accept: "application/json" },
      env: { PRIVATE_TOKEN: "hidden", APP_MODE: "test" },
    };
    const result = reportTarget(target);
    expect(result.headers).toEqual({
      Authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      accept: "application/json",
    });
    expect(result.env).toEqual({ PRIVATE_TOKEN: "[REDACTED]", APP_MODE: "test" });
    expect(target.headers.Authorization).toBe("Bearer private");
    expect(reportHeader("set-cookie", "sid=private")).toBe("[REDACTED]");
    expect(reportHeader("content-type", "application/json")).toBe("application/json");
    expect(redactSecrets({ "set-cookie": "session=abc", status: 200 }))
      .toEqual({ "set-cookie": "[REDACTED]", status: 200 });
  });
});
