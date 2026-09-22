#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import "./index.js";
import { parseContract } from "./schema.js";
import { verify } from "./verify.js";

async function main() {
  const [command, contractPath] = process.argv.slice(2);

  if (command !== "verify" || !contractPath) {
    console.error("Usage: youbrowser verify <contract.json>");
    process.exit(64);
  }

  try {
    const absolute = resolve(process.cwd(), contractPath);
    const source = await readFile(absolute, "utf8");
    const contract = parseContract(JSON.parse(source));
    const report = await verify(contract);

    console.log(`${report.verdict} · ${report.summary.pass} pass · ${report.summary.fail} fail · ${report.summary.blocked} blocked · ${report.summary.warnings} warning(s)`);
    console.log(`Evidence: ${resolve(process.cwd(), contract.evidence?.dir ?? ".youbrowser")}`);

    if (report.verdict === "FAIL") process.exit(1);
    if (report.verdict === "BLOCKED") process.exit(2);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

await main();
