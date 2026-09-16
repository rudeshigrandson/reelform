import { describe, expect, it } from "vitest";
import { readWebmDurationMs } from "../../src/recording/webmDuration";
import { type WebmFileOps, fixWebmDurationFile } from "./webmDurationFile";

const HEAD = [
  // EBML header (DocType "webm")
  0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
  // Segment, unknown size
  0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  // Info { TimecodeScale 1ms }
  0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
  // Cluster (unknown size) + payload
  0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xa3, 0x81, 0x07,
];

function memFs(initial: number[]): WebmFileOps & { data: Uint8Array; ops: string[] } {
  const fs = {
    data: new Uint8Array(initial),
    ops: [] as string[],
    readHead: async (_p: string, max: number) => fs.data.slice(0, max),
    writeHead: async (_p: string, bytes: Uint8Array) => {
      fs.ops.push("writeHead");
      fs.data.set(bytes, 0);
    },
    replaceHead: async (_p: string, replaced: number, head: Uint8Array) => {
      fs.ops.push("replaceHead");
      const rest = fs.data.slice(replaced);
      const next = new Uint8Array(head.length + rest.length);
      next.set(head, 0);
      next.set(rest, head.length);
      fs.data = next;
    },
  };
  return fs;
}

describe("fixWebmDurationFile", () => {
  it("rewrites the head once to add a Duration, then overwrites it in place", async () => {
    const fs = memFs(HEAD);
    expect(await fixWebmDurationFile(fs, "/rec/screen.webm", 5000)).toBe(true);
    expect(fs.ops).toEqual(["replaceHead"]);
    expect(readWebmDurationMs(fs.data)).toBe(5000);
    expect(Array.from(fs.data.slice(-3))).toEqual([0xa3, 0x81, 0x07]);

    expect(await fixWebmDurationFile(fs, "/rec/screen.webm", 6000)).toBe(true);
    expect(fs.ops).toEqual(["replaceHead", "writeHead"]);
    expect(readWebmDurationMs(fs.data)).toBe(6000);
  });

  it("leaves files it cannot parse untouched", async () => {
    const fs = memFs([0, 1, 2, 3]);
    expect(await fixWebmDurationFile(fs, "/rec/x.webm", 10)).toBe(false);
    expect(fs.ops).toEqual([]);
  });
});
