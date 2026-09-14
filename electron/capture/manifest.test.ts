import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type VerifyDeps, verifyHelperBinary } from "./manifest";

const bin = new TextEncoder().encode("helper-binary");
const hash = createHash("sha256").update(bin).digest("hex");

const deps = (files: Record<string, Uint8Array | string>): VerifyDeps => ({
  join: (...p) => p.join("/"),
  sha256: (b) => createHash("sha256").update(b).digest("hex"),
  readFile: async (p) => {
    const f = files[p];
    if (f === undefined) throw new Error("ENOENT");
    return typeof f === "string" ? new TextEncoder().encode(f) : f;
  },
});

const input = { binDir: "/bin", platformArch: "darwin-arm64", name: "reelform-sck" };
const manifest = (sha: string) =>
  JSON.stringify({ version: "1.0.0", files: { "reelform-sck": { sha256: sha } } });

describe("verifyHelperBinary", () => {
  it("accepts a matching binary (case-insensitive hex)", async () => {
    const r = await verifyHelperBinary(
      input,
      deps({
        "/bin/darwin-arm64/manifest.json": manifest(hash.toUpperCase()),
        "/bin/darwin-arm64/reelform-sck": bin,
      }),
    );
    expect(r).toEqual({ ok: true, path: "/bin/darwin-arm64/reelform-sck" });
  });

  it.each([
    ["missing manifest", {}, "helper manifest missing (darwin-arm64)"],
    [
      "unparseable manifest",
      { "/bin/darwin-arm64/manifest.json": "{" },
      "helper manifest missing (darwin-arm64)",
    ],
    [
      "schema-invalid manifest",
      { "/bin/darwin-arm64/manifest.json": manifest("nothex") },
      "helper manifest invalid (darwin-arm64)",
    ],
    [
      "binary not listed",
      { "/bin/darwin-arm64/manifest.json": JSON.stringify({ files: {} }) },
      "reelform-sck not listed in manifest",
    ],
    [
      "binary missing",
      { "/bin/darwin-arm64/manifest.json": manifest(hash) },
      "reelform-sck binary missing",
    ],
    [
      "hash mismatch",
      {
        "/bin/darwin-arm64/manifest.json": manifest(hash),
        "/bin/darwin-arm64/reelform-sck": new TextEncoder().encode("tampered"),
      },
      "reelform-sck checksum mismatch",
    ],
  ])("unavailable when %s", async (_label, files, reason) => {
    expect(await verifyHelperBinary(input, deps(files))).toEqual({ ok: false, reason });
  });
});
