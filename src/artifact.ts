import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ArtifactDigest, ScenarioEvidence } from "./model.js";

/**
 * Retained output artifacts, not arbitrary target/source files.
 * Source files are already fingerprinted by their owning adapter.
 */
export async function digestArtifacts(
  scenarios: Array<{ evidence: ScenarioEvidence }>,
  evidenceDir: string,
  cwd: string,
): Promise<ArtifactDigest[]> {
  const root = await realpath(evidenceDir);
  const paths = new Set<string>();

  for (const { evidence } of scenarios) {
    if (typeof evidence.screenshot === "string") paths.add(evidence.screenshot);
    if (evidence.artifacts !== undefined) {
      if (!Array.isArray(evidence.artifacts) || evidence.artifacts.some((item) => typeof item !== "string")) {
        throw new Error("artifact evidence must be an array of paths");
      }
      for (const path of evidence.artifacts) paths.add(path);
    }
  }

  const digests: ArtifactDigest[] = [];
  for (const path of [...paths].sort()) {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
    const actual = await realpath(absolute);
    const subpath = relative(root, actual);
    if (subpath === "" || subpath === ".." || subpath.startsWith("../") || isAbsolute(subpath)) {
      throw new Error(`artifact escapes evidence directory: ${path}`);
    }

    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(actual)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    digests.push({ path, bytes, sha256: hash.digest("hex") });
  }
  return digests;
}
