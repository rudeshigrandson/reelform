import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HELPER_ERROR_CODES,
  INTERRUPT_REASONS,
  parseCursorEvent,
  parseSckEvent,
} from "../mac/protocol";

// Emitted by the C++ protocol builders: `reelform-native-tests --emit-protocol-fixture`.
// One {"helper":"sck"|"cursor","line":"<outbound helper line>"} per line.
const FIXTURE = readFileSync(
  fileURLToPath(new URL("./tests/fixtures/protocol-sample.txt", import.meta.url)),
  "utf8",
);

interface Entry {
  helper: "sck" | "cursor";
  line: string;
}

const entries: Entry[] = FIXTURE.split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as Entry);

const linesOf = (helper: Entry["helper"]) =>
  entries
    .filter((e) => e.helper === helper)
    .map((e) => JSON.parse(e.line) as Record<string, unknown>);

const typesOf = (helper: Entry["helper"]) => [...new Set(linesOf(helper).map((m) => m.t))].sort();

describe("Windows helper output matches the mac helper protocol (§5.5)", () => {
  it("fixture covers every outbound message type of both helpers", () => {
    expect(typesOf("sck")).toEqual([
      "deviceLost",
      "error",
      "interrupted",
      "paused",
      "pong",
      "ready",
      "resumed",
      "started",
      "stats",
      "stopped",
    ]);
    expect(typesOf("cursor")).toEqual([
      "click",
      "error",
      "key",
      "move",
      "pong",
      "ready",
      "scroll",
      "started",
      "stopped",
    ]);
  });

  it.each(entries.filter((e) => e.helper === "sck").map((e) => e.line))(
    "capture helper line validates as SckEvent: %s",
    (line) => {
      const result = parseSckEvent(line);
      if (!result.ok) throw new Error(result.message);
    },
  );

  it.each(entries.filter((e) => e.helper === "cursor").map((e) => e.line))(
    "cursor monitor line validates as CursorEvent: %s",
    (line) => {
      const result = parseCursorEvent(line);
      if (!result.ok) throw new Error(result.message);
    },
  );

  it("emits only shared interrupt reasons and error codes, and covers the ones Windows uses", () => {
    const sck = linesOf("sck");
    const reasons = sck.filter((m) => m.t === "interrupted").map((m) => m.reason);
    expect([...reasons].sort()).toEqual([...INTERRUPT_REASONS].sort());
    const codes = new Set(sck.filter((m) => m.t === "error").map((m) => m.code));
    for (const code of codes) expect(HELPER_ERROR_CODES).toContain(code);
    expect(codes.size).toBe(HELPER_ERROR_CODES.length - 1); // exportFailed is mac-only
  });

  it("keeps the fields main relies on after schema parsing", () => {
    const started = entries.find((e) => e.line.includes('"t":"started"') && e.helper === "sck");
    const parsed = parseSckEvent(started?.line ?? "");
    expect(parsed.ok && parsed.value.t === "started" && parsed.value).toMatchObject({
      id: 2,
      firstFramePtsNs: 123456789012345,
      startHostTimeNs: 123456700000000,
      width: 2560,
      height: 1440,
      scaleFactor: 1.25,
    });
    const stopped = entries.find(
      (e) => e.line.includes('"id":5') && e.line.includes('"t":"stopped"'),
    );
    const stop = parseSckEvent(stopped?.line ?? "");
    expect(stop.ok && stop.value.t === "stopped" && stop.value).toMatchObject({
      durationMs: 12345,
      paths: {
        screen: "C:\\rec\\screen.mp4",
        system: "C:\\rec\\system.m4a",
        mic: "C:\\rec\\mic.m4a",
      },
      pausedRanges: [{ startNs: 1000, endNs: 3000 }],
      discarded: false,
    });
  });

  it("cursor lines use shared sprite names and buttons only", () => {
    const cursor = linesOf("cursor");
    const kinds = new Set(cursor.filter((m) => m.t === "move").map((m) => m.cursor));
    expect([...kinds].sort()).toEqual([
      "arrow",
      "hand",
      "ibeam",
      "resize-ew",
      "resize-nesw",
      "resize-ns",
      "resize-nwse",
    ]);
    const buttons = new Set(cursor.filter((m) => m.t === "click").map((m) => m.button));
    expect([...buttons].sort()).toEqual(["left", "middle", "right"]);
  });
});
