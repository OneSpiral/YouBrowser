import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../src/index.js";
import { capture } from "../src/capture.js";
import { verify } from "../src/verify.js";
import { parseCaptureContract, parseContract } from "../src/schema.js";

const dirs: string[] = [];
async function workspace() {
  const cwd = await mkdtemp(join(tmpdir(), "youbrowser-command-"));
  dirs.push(cwd);
  return cwd;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bounded command execution", () => {
  const target = {
    kind: "command",
    executable: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(32768))"],
  };
  test("treats output overflow as unavailable capture", async () => {
    const cwd = await workspace();
    const contract = parseCaptureContract({
      version: 1,
      target,
      scenarios: [{ id: "overflow", timeoutMs: 5000, maxOutputBytes: 1024 }],
      evidence: { dir: ".capture" },
    });
    const report = await capture(contract, { cwd });
    expect(report.summary).toEqual({ captured: 0, blocked: 1 });
    expect(report.scenarios[0]?.evidence.error).toContain("maxOutputBytes");
    expect(report.scenarios[0]?.evidence.maxOutputBytes).toBe(1024);
  });

  test("cannot PASS using only duration when the process failed", async () => {
    const cwd = await workspace();
    const contract = parseContract({
      version: 1,
      target,
      scenarios: [{ id: "overflow", timeoutMs: 5000, maxOutputBytes: 1024 }],
      checks: [{ id: "fast", type: "duration", maxMs: 5000, severity: "must" }],
      evidence: { dir: ".verify" },
    });
    const report = await verify(contract, { cwd });
    expect(report.verdict).toBe("BLOCKED");
    expect(report.scenarios[0]?.checks[0]?.verdict).toBe("BLOCKED");
  });

  test("rejects invalid output budgets before execution", async () => {
    const cwd = await workspace();
    const contract = parseCaptureContract({
      version: 1,
      target,
      scenarios: [{ id: "invalid", maxOutputBytes: 0 }],
    });
    await expect(capture(contract, { cwd })).rejects.toThrow("maxOutputBytes");
  });
});
