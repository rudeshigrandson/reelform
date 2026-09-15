import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HelperManifest, type VerifyDeps, verifyHelperBinary } from "../capture/manifest";
import {
  buildHelperManifest,
  nodeArchFor,
  platformArchDir,
  serializeHelperManifest,
} from "./manifest";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);

const memDeps = (files: Record<string, Uint8Array>): VerifyDeps => ({
  join: (...p) => p.join("/"),
  sha256,
  readFile: async (p) => {
    const f = files[p];
    if (!f) throw new Error("ENOENT");
    return f;
  },
});

describe("buildHelperManifest → verifyHelperBinary round trip", () => {
  const sck = enc("sck-binary");
  const cursor = enc("cursor-binary");

  it("every listed helper verifies against the serialized manifest", async () => {
    const manifest = buildHelperManifest(
      [
        { name: "reelform-sck", bytes: sck },
        { name: "reelform-cursor-monitor", bytes: cursor },
      ],
      (b) => sha256(b).toUpperCase(),
      "0.1.0",
    );
    const json = serializeHelperManifest(manifest);
    expect(json.endsWith("}\n")).toBe(true);
    expect(HelperManifest.safeParse(JSON.parse(json)).success).toBe(true);
    // Sorted, lowercase: byte-stable across builds of the same binaries.
    expect(Object.keys(manifest.files)).toEqual(["reelform-cursor-monitor", "reelform-sck"]);
    expect(manifest.files["reelform-sck"]?.sha256).toBe(sha256(sck));

    const files = {
      "/bin/darwin-arm64/manifest.json": enc(json),
      "/bin/darwin-arm64/reelform-sck": sck,
      "/bin/darwin-arm64/reelform-cursor-monitor": cursor,
    };
    for (const name of ["reelform-sck", "reelform-cursor-monitor"]) {
      expect(
        await verifyHelperBinary(
          { binDir: "/bin", platformArch: "darwin-arm64", name },
          memDeps(files),
        ),
      ).toEqual({ ok: true, path: `/bin/darwin-arm64/${name}` });
    }
    expect(
      await verifyHelperBinary(
        { binDir: "/bin", platformArch: "darwin-arm64", name: "reelform-sck" },
        memDeps({ ...files, "/bin/darwin-arm64/reelform-sck": enc("rebuilt") }),
      ),
    ).toEqual({ ok: false, reason: "reelform-sck checksum mismatch" });
  });

  it.each([
    ["no helpers", [], "0.1.0", /at least one/],
    ["empty version", [{ name: "a", bytes: enc("x") }], " ", /version/],
    ["path traversal", [{ name: "../a", bytes: enc("x") }], "1", /invalid helper file name/],
    ["nested path", [{ name: "sub/a", bytes: enc("x") }], "1", /invalid helper file name/],
    ["manifest itself", [{ name: "manifest.json", bytes: enc("x") }], "1", /invalid/],
    [
      "duplicate",
      [
        { name: "a", bytes: enc("x") },
        { name: "a", bytes: enc("y") },
      ],
      "1",
      /duplicate/,
    ],
    ["empty binary", [{ name: "a", bytes: new Uint8Array() }], "1", /empty/],
  ])("rejects %s", (_label, files, version, error) => {
    expect(() => buildHelperManifest(files, sha256, version)).toThrow(error);
  });

  it("rejects a hash function that does not return sha256 hex", () => {
    expect(() => buildHelperManifest([{ name: "a", bytes: enc("x") }], () => "abc", "1")).toThrow(
      /64 hex/,
    );
  });

  it("maps toolchain arch names to the directory main resolves", () => {
    expect(nodeArchFor("x86_64")).toBe("x64");
    expect(nodeArchFor("arm64")).toBe("arm64");
    expect(nodeArchFor("aarch64")).toBe("arm64");
    expect(platformArchDir("darwin", "x86_64")).toBe("darwin-x64");
    expect(platformArchDir("win32", "amd64")).toBe("win32-x64");
    expect(() => nodeArchFor("ppc")).toThrow(/unsupported/);
  });
});

describe("scripts/write-manifest.mjs", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("writes a manifest that verifyHelperBinary accepts for the files on disk", async () => {
    dir = mkdtempSync(join(tmpdir(), "reelform-manifest-"));
    const platformDir = join(dir, "darwin-arm64");
    execFileSync("mkdir", ["-p", platformDir]);
    writeFileSync(join(platformDir, "reelform-sck"), "sck");
    writeFileSync(join(platformDir, "reelform-cursor-monitor"), "cursor");
    const script = fileURLToPath(new URL("./scripts/write-manifest.mjs", import.meta.url));
    const stdout = execFileSync(
      process.execPath,
      [script, platformDir, "9.9.9", "reelform-sck", "reelform-cursor-monitor"],
      { encoding: "utf8" },
    );
    expect(stdout).toContain(`${sha256(enc("sck"))}  reelform-sck`);
    const written = JSON.parse(readFileSync(join(platformDir, "manifest.json"), "utf8"));
    expect(written.version).toBe("9.9.9");

    const deps: VerifyDeps = {
      join,
      sha256,
      readFile: async (p) => new Uint8Array(readFileSync(p)),
    };
    expect(
      await verifyHelperBinary(
        { binDir: dir, platformArch: "darwin-arm64", name: "reelform-cursor-monitor" },
        deps,
      ),
    ).toEqual({ ok: true, path: join(platformDir, "reelform-cursor-monitor") });
  });

  it("exits non-zero with usage when arguments are missing", () => {
    const script = fileURLToPath(new URL("./scripts/write-manifest.mjs", import.meta.url));
    expect(() =>
      execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  });
});
