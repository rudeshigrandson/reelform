#!/usr/bin/env node
// Usage: node electron/native/scripts/write-manifest.mjs <platformDir> <version> <helper>...
// Hashes each helper in <platformDir> and writes <platformDir>/manifest.json in the
// format electron/capture/manifest.ts verifies. Requires Node >= 22.18 (type stripping).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildHelperManifest, serializeHelperManifest } from "../manifest.ts";

const [dir, version, ...names] = process.argv.slice(2);
if (!dir || !version || names.length === 0) {
  console.error("usage: write-manifest.mjs <platformDir> <version> <helper>...");
  process.exit(2);
}

const files = await Promise.all(
  names.map(async (name) => ({ name, bytes: new Uint8Array(await readFile(join(dir, name))) })),
);
const manifest = buildHelperManifest(
  files,
  (bytes) => createHash("sha256").update(bytes).digest("hex"),
  version,
);
await writeFile(join(dir, "manifest.json"), serializeHelperManifest(manifest));
for (const [name, { sha256 }] of Object.entries(manifest.files)) console.log(`${sha256}  ${name}`);
