import * as nodePath from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { TelemetryFile } from "../recording/telemetry";
import { telemetryContracts } from "./contracts";
import { type TelemetryDeps, createTelemetryHandlers } from "./handlers";

const SAMPLE: TelemetryFile = {
  version: 1,
  sampleHz: 120,
  origin: "display",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  points: [[0, 0.5, 0.5, "arrow"]],
  clicks: [[10, 0.5, 0.5, 0, "down"]],
  keys: [],
  scrolls: [],
};

const gz = (v: unknown) => new Uint8Array(gzipSync(Buffer.from(JSON.stringify(v))));

function setup() {
  const files = new Map<string, Uint8Array>();
  /** symlink → target */
  const links = new Map<string, string>();
  const dirs = new Set(["/lib/Demo.reelform", "/u/recordings", "/u/recordings/s1"]);
  const deps: TelemetryDeps = {
    path: nodePath.posix,
    readFile: async (p) => {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return f;
    },
    gunzip: async (b) => new Uint8Array(gunzipSync(b)),
    realpath: async (p) => {
      const n = nodePath.posix.normalize(p);
      const linked = links.get(n);
      if (linked) return linked;
      if (files.has(n) || dirs.has(n)) return n;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    resolveProjectDir: async (id) => {
      if (id === "p1") return "/lib/Demo.reelform";
      throw Object.assign(new Error("No project"), { code: "PROJECT_NOT_FOUND" });
    },
    allowedRoots: async () => ["/lib/Demo.reelform", "/u/recordings"],
  };
  return { files, links, deps, handlers: createTelemetryHandlers(deps) };
}

const read = (h: ReturnType<typeof setup>["handlers"], req: unknown) =>
  h["telemetry:read"](telemetryContracts["telemetry:read"].request.parse(req));

describe("telemetry:read", () => {
  it("reads a fresh recording's telemetry by absolute path", async () => {
    const { files, handlers } = setup();
    files.set("/u/recordings/s1/telemetry.json.gz", gz(SAMPLE));
    await expect(read(handlers, { path: "/u/recordings/s1/telemetry.json.gz" })).resolves.toEqual(
      SAMPLE,
    );
  });

  it("reads by projectId + relative ref", async () => {
    const { files, handlers } = setup();
    files.set("/lib/Demo.reelform/media/telemetry.json.gz", gz(SAMPLE));
    const out = await read(handlers, {
      projectId: "p1",
      ref: { path: "media/telemetry.json.gz", sampleHz: 120 },
    });
    expect(out.points).toHaveLength(1);
  });

  it("forbids paths outside the roots, traversal refs and symlink escapes", async () => {
    const { files, links, handlers } = setup();
    files.set("/etc/secret.gz", gz(SAMPLE));
    await expect(read(handlers, { path: "/etc/secret.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_PATH_FORBIDDEN",
    });
    await expect(read(handlers, { path: "/etc/missing.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_PATH_FORBIDDEN",
    });
    await expect(read(handlers, { path: "relative/t.json.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_PATH_FORBIDDEN",
    });
    await expect(
      read(handlers, { projectId: "p1", ref: { path: "../../etc/secret.gz" } }),
    ).rejects.toMatchObject({ code: "TELEMETRY_PATH_FORBIDDEN" });
    // Absolute ref in another allowed root is still confined to the addressed project.
    files.set("/u/recordings/s1/telemetry.json.gz", gz(SAMPLE));
    await expect(
      read(handlers, { projectId: "p1", ref: { path: "/u/recordings/s1/telemetry.json.gz" } }),
    ).rejects.toMatchObject({ code: "TELEMETRY_PATH_FORBIDDEN" });
    links.set("/u/recordings/s1/link.gz", "/etc/secret.gz");
    await expect(read(handlers, { path: "/u/recordings/s1/link.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_PATH_FORBIDDEN",
    });
  });

  it("reports missing, corrupt and schema-invalid files with stable codes", async () => {
    const { files, handlers } = setup();
    await expect(read(handlers, { path: "/u/recordings/s1/none.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_NOT_FOUND",
    });
    files.set("/u/recordings/s1/bad.gz", new Uint8Array([0x1f, 0x8b, 1, 2, 3]));
    await expect(read(handlers, { path: "/u/recordings/s1/bad.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_CORRUPT",
    });
    files.set("/u/recordings/s1/v2.gz", gz({ ...SAMPLE, version: 2 }));
    await expect(read(handlers, { path: "/u/recordings/s1/v2.gz" })).rejects.toMatchObject({
      code: "TELEMETRY_INVALID",
    });
  });

  it("accepts uncompressed JSON and propagates unknown project ids", async () => {
    const { files, handlers } = setup();
    files.set("/u/recordings/s1/t.json", new TextEncoder().encode(JSON.stringify(SAMPLE)));
    await expect(read(handlers, { path: "/u/recordings/s1/t.json" })).resolves.toEqual(SAMPLE);
    await expect(
      read(handlers, { projectId: "nope", ref: { path: "media/t.gz" } }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
