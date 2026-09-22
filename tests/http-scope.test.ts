import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../src/index.js";
import { capture } from "../src/capture.js";
import { verify } from "../src/verify.js";
import { parseCaptureContract, parseContract } from "../src/schema.js";

const servers: Server[] = [];
const dirs: string[] = [];
async function fixture() {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "http://127.0.0.1:9/outside" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("abcd");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing HTTP port");
  const cwd = await mkdtemp(join(tmpdir(), "youbrowser-batch-"));
  dirs.push(cwd);
  return { url: `http://127.0.0.1:${address.port}`, cwd, count: () => requests };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>(
    (resolve) => server.close(() => resolve()),
  )));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("scoped multi-request HTTP capture", () => {
  test("refuses an undeclared origin without requesting it", async () => {
    const env = await fixture();
    const contract = parseContract({
      version: 1,
      target: { kind: "http", baseUrl: env.url },
      scenarios: [{ id: "outside", path: "http://127.0.0.1:9/other" }],
      checks: [{ id: "status", type: "status", equals: 200, severity: "must" }],
      evidence: { dir: ".evidence" },
    });
    const report = await verify(contract, { cwd: env.cwd });
    expect(report.verdict).toBe("BLOCKED");
    expect(report.scenarios[0]?.evidence.error).toContain("outside scope");
    expect(env.count()).toBe(0);
  });

  test("blocks collection when a shared byte budget is exhausted", async () => {
    const env = await fixture();
    const contract = parseCaptureContract({
      version: 1,
      target: {
        kind: "http",
        baseUrl: env.url,
        scope: { maxRequests: 2, maxTotalBytes: 6 },
      },
      scenarios: [{ id: "first", path: "/first" }, { id: "second", path: "/second" }],
      evidence: { dir: ".evidence", body: true },
    });
    const report = await capture(contract, { cwd: env.cwd });
    expect(report.summary).toEqual({ captured: 1, blocked: 1 });
    expect(report.scenarios[0]?.evidence.bodyBytes).toBe(4);
    expect(report.scenarios[1]?.evidence.error).toContain("maxBytes");
    expect(report.artifacts).toHaveLength(1);
    expect(env.count()).toBe(2);
  });

  test("does not follow redirects outside the declared origin", async () => {
    const env = await fixture();
    const contract = parseCaptureContract({
      version: 1, target: { kind: "http", baseUrl: env.url },
      scenarios: [{ id: "redirect", path: "/redirect" }],
      evidence: { dir: ".evidence" },
    });
    const report = await capture(contract, { cwd: env.cwd });
    expect(report.summary).toEqual({ captured: 1, blocked: 0 });
    expect(report.scenarios[0]?.evidence.status).toBe(302);
    expect(report.scenarios[0]?.evidence.redirectPolicy).toBe("manual");
    expect(env.count()).toBe(1);
  });

  test("rejects plans exceeding explicit request count before network access", async () => {
    const env = await fixture();
    const contract = parseCaptureContract({
      version: 1,
      target: { kind: "http", baseUrl: env.url, scope: { maxRequests: 1 } },
      scenarios: [{ id: "first" }, { id: "second" }],
    });
    await expect(capture(contract, { cwd: env.cwd })).rejects.toThrow("maxRequests");
    expect(env.count()).toBe(0);
  });

  test("does not allow unsafe names through the public capture API", async () => {
    const env = await fixture();
    await expect(capture({
      version: 1,
      target: { kind: "http", baseUrl: env.url },
      scenarios: [{ id: "../escape" }],
      evidence: { body: true },
    }, { cwd: env.cwd })).rejects.toThrow("safe identifier");
    expect(env.count()).toBe(0);
  });
});
