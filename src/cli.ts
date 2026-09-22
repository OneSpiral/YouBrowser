#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import "./index.js";
import { capture } from "./capture.js";
import { parseCaptureContract, parseContract } from "./schema.js";
import { verify } from "./verify.js";

function usage(): never {
  console.error("Usage: youbrowser <verify|capture> <contract.json>");
  process.exit(64);
}

async function main() {
  const [command, contractPath] = process.argv.slice(2);
  if (!contractPath || (command !== "verify" && command !== "capture")) usage();

  try {
    const absolute = resolve(process.cwd(), contractPath);
    const source = await readFile(absolute, "utf8");
    const input = JSON.parse(source);

    if (command === "capture") {
      const contract = parseCaptureContract(input);
      const report = await capture(contract);
      console.log(`CAPTURE · ${report.summary.captured} captured · ${report.summary.blocked} blocked`);
      console.log(`Evidence: ${resolve(process.cwd(), contract.evidence?.dir ?? ".youbrowser")}`);
      if (report.summary.blocked > 0) process.exitCode = 2;
      return;
    }

    const contract = parseContract(input);
    const report = await verify(contract);

    console.log(
      `${report.verdict} · ${report.summary.pass} pass · ${report.summary.fail} fail · ${report.summary.blocked} blocked · ${report.summary.warnings} warning(s)`,
    );
    console.log(`Evidence: ${resolve(process.cwd(), contract.evidence?.dir ?? ".youbrowser")}`);

    if (report.verdict === "FAIL") process.exit(1);
    if (report.verdict === "BLOCKED") process.exit(2);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

await main();
