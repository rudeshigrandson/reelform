import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CURSOR_CAPS,
  CURSOR_KINDS,
  CursorEvent,
  CursorPackManifest,
  CursorPermissions,
  HELPER_PROTOCOL_VERSION,
  MODIFIER,
  SCK_CAPS,
  type SckCommand,
  SckEvent,
  SckPermissions,
  createLineDecoder,
  encodeCursorCommand,
  encodeSckCommand,
  parseCursorCommand,
  parseCursorEvent,
  parseSckCommand,
  parseSckEvent,
} from "./protocol";

interface GoldenEntry {
  helper: "sck" | "cursor";
  direction: "in" | "out";
  line: string;
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/protocol-golden.json", import.meta.url)), "utf8"),
) as GoldenEntry[];

const isPermissions = (line: string) => line.startsWith('{"t":"permissions"');

describe("golden fixture (written by the Swift self-check)", () => {
  it("covers every sck outbound type and every cursor outbound type", () => {
    const types = (helper: string) =>
      new Set(
        golden
          .filter((g) => g.helper === helper && g.direction === "out")
          .map((g) => (JSON.parse(g.line) as { t: string }).t),
      );
    expect([...types("sck")].sort()).toEqual(
      [
        "error",
        "interrupted",
        "permissions",
        "pong",
        "ready",
        "started",
        "stats",
        "stopped",
      ].sort(),
    );
    expect([...types("cursor")].sort()).toEqual(
      [
        "click",
        "cursorsExported",
        "error",
        "key",
        "move",
        "permissions",
        "pong",
        "ready",
        "scroll",
        "started",
        "stopped",
      ].sort(),
    );
  });

  it.each(golden.map((g) => [`${g.helper} ${g.direction} ${g.line}`, g] as const))(
    "validates %s",
    (_name, g) => {
      if (g.direction === "in") {
        const parsed = g.helper === "sck" ? parseSckCommand(g.line) : parseCursorCommand(g.line);
        expect(parsed.ok).toBe(true);
        return;
      }
      if (isPermissions(g.line)) {
        const schema = g.helper === "sck" ? SckPermissions : CursorPermissions;
        expect(schema.safeParse(JSON.parse(g.line)).success).toBe(true);
        return;
      }
      const parsed = g.helper === "sck" ? parseSckEvent(g.line) : parseCursorEvent(g.line);
      if (!parsed.ok) throw new Error(parsed.message);
      // zod strips nothing: every field the helper emits is modelled.
      expect(parsed.value).toEqual(JSON.parse(g.line));
    },
  );

  it("TS-encoded sck commands match Swift-encoded lines byte for byte", () => {
    for (const g of golden.filter((e) => e.helper === "sck" && e.direction === "in")) {
      const parsed = parseSckCommand(g.line);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(encodeSckCommand(parsed.value)).toBe(`${g.line}\n`);
    }
  });

  it("pong advertises the protocol version and caps", () => {
    const sckPong = golden.find((g) => g.helper === "sck" && g.line.includes('"pong"'));
    const cursorPong = golden.find((g) => g.helper === "cursor" && g.line.includes('"pong"'));
    expect(JSON.parse(sckPong?.line ?? "{}")).toMatchObject({
      version: HELPER_PROTOCOL_VERSION,
      caps: [...SCK_CAPS],
    });
    expect(JSON.parse(cursorPong?.line ?? "{}")).toMatchObject({
      version: HELPER_PROTOCOL_VERSION,
      caps: [...CURSOR_CAPS],
    });
  });
});

describe("sck commands", () => {
  const start: SckCommand = {
    t: "start",
    id: 1,
    outputDir: "/rec",
    source: { kind: "display", displayId: 1, excludePids: [42] },
    fps: 60,
    audio: { system: true },
  };

  it("encodes one newline-terminated line", () => {
    const line = encodeSckCommand(start);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
  });

  it("rejects fps other than 30/60", () => {
    expect(parseSckCommand(JSON.stringify({ ...start, fps: 24 })).ok).toBe(false);
  });

  it("rejects a region on a window source", () => {
    const bad = {
      ...start,
      source: { kind: "window", windowId: 3 },
      region: { x: 0, y: 0, width: 10, height: 10 },
    };
    expect(parseSckCommand(JSON.stringify(bad)).ok).toBe(false);
  });

  it("rejects zero-size regions, negative ids and empty outputDir", () => {
    const zero = { ...start, region: { x: 0, y: 0, width: 0, height: 10 } };
    expect(parseSckCommand(JSON.stringify(zero)).ok).toBe(false);
    expect(parseSckCommand(JSON.stringify({ ...start, id: -1 })).ok).toBe(false);
    expect(parseSckCommand(JSON.stringify({ ...start, outputDir: "" })).ok).toBe(false);
  });

  it("encode throws on invalid commands instead of sending them", () => {
    expect(() => encodeSckCommand({ ...start, fps: 25 } as unknown as SckCommand)).toThrow();
  });

  it("round-trips arbitrary valid starts", () => {
    const arb = fc.record({
      t: fc.constant("start" as const),
      id: fc.nat(),
      outputDir: fc.string({ minLength: 1 }),
      source: fc.constantFrom({ kind: "display" as const, displayId: 7 }),
      region: fc.record({
        x: fc.double({ noNaN: true, noDefaultInfinity: true }),
        y: fc.double({ noNaN: true, noDefaultInfinity: true }),
        width: fc.double({ min: 1, max: 10_000, noNaN: true }),
        height: fc.double({ min: 1, max: 10_000, noNaN: true }),
      }),
      fps: fc.constantFrom(30 as const, 60 as const),
      audio: fc.record({ system: fc.boolean(), mic: fc.string({ minLength: 1 }) }),
    });
    fc.assert(
      fc.property(arb, (cmd) => {
        const parsed = parseSckCommand(encodeSckCommand(cmd).trimEnd());
        return (
          parsed.ok &&
          JSON.stringify(parsed.value) === JSON.stringify(JSON.parse(JSON.stringify(cmd)))
        );
      }),
    );
  });
});

describe("sck events", () => {
  it("reports invalid JSON distinctly from schema violations", () => {
    expect(parseSckEvent("{nope")).toMatchObject({ ok: false, error: "invalidJson" });
    expect(parseSckEvent('{"t":"stats","fps":-1,"droppedFrames":0,"fileBytes":0}')).toMatchObject({
      ok: false,
      error: "invalidMessage",
    });
  });

  it("rejects unknown message types and unknown interrupt reasons", () => {
    expect(parseSckEvent('{"t":"explode"}').ok).toBe(false);
    expect(parseSckEvent('{"t":"interrupted","reason":"cosmicRay","message":""}').ok).toBe(false);
  });

  it("rejects inverted paused ranges", () => {
    const stopped = {
      t: "stopped",
      durationMs: 1,
      paths: {},
      pausedRanges: [{ startNs: 10, endNs: 5 }],
      discarded: false,
    };
    expect(SckEvent.safeParse(stopped).success).toBe(false);
  });

  it("accepts host-clock ns beyond 2^53 as integers", () => {
    const started = {
      t: "started",
      firstFramePtsNs: 2 ** 60,
      startHostTimeNs: 2 ** 60,
      width: 2,
      height: 2,
      scaleFactor: 1,
    };
    expect(SckEvent.safeParse(started).success).toBe(true);
  });
});

describe("cursor events", () => {
  it("never accepts characters on key events", () => {
    const withChars = { t: "key", tNs: 1, keyCode: 0, modifiers: 0, characters: "a" };
    const parsed = CursorEvent.safeParse(withChars);
    // Extra fields are stripped, so a helper leaking characters can't reach main.
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ t: "key", tNs: 1, keyCode: 0, modifiers: 0 });
    expect("characters" in parsed.data).toBe(false);
  });

  it("bounds the modifier mask to known bits", () => {
    const all = Object.values(MODIFIER).reduce((a, b) => a | b, 0);
    expect(all).toBe(63);
    expect(CursorEvent.safeParse({ t: "key", tNs: 1, keyCode: 36, modifiers: 64 }).success).toBe(
      false,
    );
  });

  it("allows negative global coordinates (displays left of/above primary)", () => {
    expect(parseCursorEvent('{"t":"move","tNs":1,"x":-1440,"y":-900,"cursor":"arrow"}').ok).toBe(
      true,
    );
  });

  it("rejects unknown cursor kinds and buttons", () => {
    expect(parseCursorEvent('{"t":"move","tNs":1,"x":0,"y":0,"cursor":"wait"}').ok).toBe(false);
    expect(
      parseCursorEvent('{"t":"click","tNs":1,"x":0,"y":0,"button":"back","phase":"down"}').ok,
    ).toBe(false);
  });

  it("encodes exportCursors and rejects an empty dir", () => {
    expect(encodeCursorCommand({ t: "exportCursors", id: 3, dir: "/c" })).toBe(
      '{"t":"exportCursors","id":3,"dir":"/c"}\n',
    );
    expect(() => encodeCursorCommand({ t: "exportCursors", dir: "" })).toThrow();
  });

  it("validates a pack.json with every cursor kind", () => {
    const cursors = Object.fromEntries(
      CURSOR_KINDS.map((k) => [k, { file: `${k}@2x.png`, hotspot: [1, 2], size: [16, 16] }]),
    );
    expect(CursorPackManifest.safeParse({ name: "macOS", scale: 2, cursors }).success).toBe(true);
  });
});

describe("createLineDecoder", () => {
  const lines = ['{"t":"ready"}', '{"t":"stats","fps":60,"droppedFrames":0,"fileBytes":1}', "x"];

  it("handles CRLF, blank lines and a trailing partial line", () => {
    const d = createLineDecoder();
    expect(d.push('{"t":"ready"}\r\n\n  \n{"t":')).toEqual(['{"t":"ready"}']);
    expect(d.end()).toEqual(['{"t":']);
    expect(d.end()).toEqual([]);
  });

  it("yields the same lines for any chunking of the stream", () => {
    const stream = `${lines.join("\n")}\n`;
    fc.assert(
      fc.property(fc.array(fc.nat(stream.length), { maxLength: 20 }), (cuts) => {
        const points = [...new Set(cuts)].sort((a, b) => a - b);
        const d = createLineDecoder();
        const out: string[] = [];
        let prev = 0;
        for (const p of [...points, stream.length]) {
          out.push(...d.push(stream.slice(prev, p)));
          prev = p;
        }
        out.push(...d.end());
        expect(out).toEqual(lines);
      }),
    );
  });

  it("drops overlong lines (whole or streamed) and recovers", () => {
    const d = createLineDecoder(8);
    expect(d.push("0123456789\nok\n")).toEqual(["ok"]);
    expect(d.overflowCount).toBe(1);
    expect(d.push("aaaaaaaaaaaa")).toEqual([]);
    expect(d.push("bbbb\nafter\n")).toEqual(["after"]);
    expect(d.overflowCount).toBe(2);
    expect(d.push("aaaaaaaaaaaa")).toEqual([]);
    expect(d.end()).toEqual([]);
  });
});
