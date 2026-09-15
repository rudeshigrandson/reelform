/**
 * Writes `bin/<platform-arch>/manifest.json` for native helpers (ENGINEERING_SPEC
 * §5.5 / §13). The shape is exactly what `electron/capture/manifest.ts`
 * (`HelperManifest` + `verifyHelperBinary`) checks at startup:
 *
 *   { "version": "1.0.0", "files": { "reelform-sck": { "sha256": "<64 hex>" }, … } }
 *
 * Dependency-free and type-strippable so `scripts/write-manifest.mjs` can run it
 * directly with Node (no build step). Hashing is injected.
 */

export interface HelperManifestFile {
  /** File name inside the platform directory, e.g. `reelform-sck`. */
  name: string;
  bytes: Uint8Array;
}

export interface HelperManifestJson {
  version: string;
  files: Record<string, { sha256: string }>;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Node's `process.arch` for a Swift/clang arch name (`x86_64` → `x64`). */
export function nodeArchFor(arch: string): string {
  switch (arch) {
    case "x86_64":
    case "amd64":
    case "x64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      throw new Error(`unsupported arch "${arch}"`);
  }
}

/** Directory name main resolves: `${process.platform}-${process.arch}`. */
export function platformArchDir(platform: string, arch: string): string {
  return `${platform}-${nodeArchFor(arch)}`;
}

export function buildHelperManifest(
  files: readonly HelperManifestFile[],
  sha256: (bytes: Uint8Array) => string,
  version: string,
): HelperManifestJson {
  if (files.length === 0) throw new Error("manifest needs at least one helper");
  if (version.trim().length === 0) throw new Error("manifest version is empty");
  const out: Record<string, { sha256: string }> = {};
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!NAME.test(f.name) || f.name === "manifest.json")
      throw new Error(`invalid helper file name "${f.name}"`);
    if (Object.hasOwn(out, f.name)) throw new Error(`duplicate helper "${f.name}"`);
    if (f.bytes.byteLength === 0) throw new Error(`helper "${f.name}" is empty`);
    const hash = sha256(f.bytes).toLowerCase();
    if (!HEX64.test(hash)) throw new Error(`sha256 for "${f.name}" is not 64 hex chars`);
    out[f.name] = { sha256: hash };
  }
  return { version, files: out };
}

/** Stable, newline-terminated JSON. */
export function serializeHelperManifest(manifest: HelperManifestJson): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
