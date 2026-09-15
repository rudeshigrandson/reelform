import { z } from "zod";

/**
 * Helper binary verification (ENGINEERING_SPEC §5.5 / §13): every helper is
 * checked against `bin/<platform-arch>/manifest.json` sha256 before use; any
 * mismatch makes the backend unavailable with a reason.
 */

export const HelperManifest = z.object({
  version: z.string().optional(),
  files: z.record(
    z.string(),
    z.object({
      sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
    }),
  ),
});
export type HelperManifest = z.infer<typeof HelperManifest>;

export interface VerifyDeps {
  /** Reads a file; rejects when missing. */
  readFile(path: string): Promise<Uint8Array>;
  /** Lowercase or uppercase hex sha256 of the bytes. */
  sha256(bytes: Uint8Array): string | Promise<string>;
  /** Path join (injected so tests stay platform-neutral). */
  join(...parts: string[]): string;
}

export interface VerifyInput {
  /** `electron/native/bin` (dev) or the unpacked resources dir (packaged). */
  binDir: string;
  /** e.g. `darwin-arm64`, `win32-x64`. */
  platformArch: string;
  /** Binary file name as listed in the manifest, e.g. `reelform-sck`. */
  name: string;
}

export type VerifyResult = { ok: true; path: string } | { ok: false; reason: string };

export async function verifyHelperBinary(
  input: VerifyInput,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const dir = deps.join(input.binDir, input.platformArch);
  const manifestPath = deps.join(dir, "manifest.json");
  let manifest: HelperManifest;
  try {
    const raw = new TextDecoder().decode(await deps.readFile(manifestPath));
    const parsed = HelperManifest.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return { ok: false, reason: `helper manifest invalid (${input.platformArch})` };
    manifest = parsed.data;
  } catch {
    return { ok: false, reason: `helper manifest missing (${input.platformArch})` };
  }

  const entry = manifest.files[input.name];
  if (!entry) return { ok: false, reason: `${input.name} not listed in manifest` };

  const path = deps.join(dir, input.name);
  let bytes: Uint8Array;
  try {
    bytes = await deps.readFile(path);
  } catch {
    return { ok: false, reason: `${input.name} binary missing` };
  }
  const actual = (await deps.sha256(bytes)).toLowerCase();
  if (actual !== entry.sha256.toLowerCase()) {
    return { ok: false, reason: `${input.name} checksum mismatch` };
  }
  return { ok: true, path };
}
