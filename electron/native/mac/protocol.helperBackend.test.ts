import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapHelperEvent } from "../../capture/helperBackend";
import { type HelperMessage, parseHelperLine } from "../../capture/helperProcess";
import { Sources } from "../../capture/types";
import {
  INTERRUPT_REASONS,
  SCK_CAPS,
  SckEvent,
  SckHostStart,
  canonicalStartFromHost,
  encodeSckCommand,
  parseSckCommand,
  parseSckEvent,
  parseSourceId,
} from "./protocol";

/**
 * Wire alignment between the Swift helper (golden fixture) and what
 * electron/capture/helperBackend.ts sends and expects (§5.5).
 */

interface GoldenEntry {
  helper: "sck" | "cursor";
  direction: "in" | "inHost" | "out";
  line: string;
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/protocol-golden.json", import.meta.url)), "utf8"),
) as GoldenEntry[];

const sckOut = (t: string): HelperMessage[] =>
  golden
    .filter((g) => g.helper === "sck" && g.direction === "out")
    .map((g) => parseHelperLine(g.line))
    .filter((m): m is HelperMessage => m !== null && m.t === t);

describe("helperBackend contract", () => {
  it("advertises the capability main requires", () => {
    const pong = sckOut("pong")[0];
    expect(pong?.caps).toContain("capture");
    expect(pong?.caps).toContain("listSources");
    expect(SCK_CAPS.slice(0, 2)).toEqual(["capture", "listSources"]);
  });

  it("answers start with ready{id}, distinct from the launch ready", () => {
    const readies = sckOut("ready");
    expect(readies.map((r) => r.id)).toEqual([undefined, 2]);
  });

  it("acks pause and resume with their ids so requests resolve", () => {
    expect(sckOut("paused")[0]?.id).toBe(3);
    expect(sckOut("resumed")[0]?.id).toBe(4);
  });

  it("emits deviceLost in the shape mapHelperEvent reads", () => {
    const msg = sckOut("deviceLost")[0];
    expect(msg && mapHelperEvent(msg)).toEqual({
      type: "deviceLost",
      device: "BuiltInMicrophoneDevice",
    });
  });

  it("maps diskLow straight through to the capture interrupt reason", () => {
    const msg = sckOut("interrupted").find((m) => m.reason === "diskLow");
    expect(msg && mapHelperEvent(msg)).toEqual({
      type: "interrupted",
      reason: "diskLow",
      detail: undefined,
    });
    expect(INTERRUPT_REASONS).toContain("diskLow");
  });

  it("started still carries firstFramePtsNs for telemetry rebasing", () => {
    const msg = sckOut("started")[0];
    expect(msg && mapHelperEvent(msg)).toEqual({
      type: "started",
      firstFramePtsNs: 123456789012345n,
    });
  });

  it("sources reply satisfies capture Sources.parse as helperBackend calls it", () => {
    const msg = sckOut("sources")[0];
    expect(msg).toBeDefined();
    const parsed = Sources.parse({ displays: msg?.displays, windows: msg?.windows });
    expect(parsed.displays.map((d) => d.id)).toEqual(["1", "3"]);
    expect(parsed.displays[0]).toMatchObject({
      name: "Built-in Retina Display",
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
      thumbnail: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(parsed.windows[0]).toMatchObject({
      id: "4242",
      title: "README.md",
      appName: "Xcode",
      displayId: "1",
    });
    // Thumbnail-less entries are valid (best-effort captures).
    expect(parsed.windows[1]?.thumbnail).toBeUndefined();
  });
});

describe("host start shape", () => {
  const host = {
    t: "start",
    id: 9,
    sessionId: "s",
    outDir: "/rec",
    source: { kind: "display", id: "69734208" },
    audio: { system: true, mic: "default" },
    fps: 60,
    hideCursor: true,
  };

  it("maps to the canonical start the helper runs", () => {
    expect(canonicalStartFromHost(host)).toEqual({
      t: "start",
      id: 9,
      outputDir: "/rec",
      source: { kind: "display", displayId: 69734208 },
      fps: 60,
      audio: { system: true, mic: "default" },
    });
    const line = encodeSckCommand(canonicalStartFromHost(host) as never);
    expect(parseSckCommand(line.trimEnd()).ok).toBe(true);
  });

  it("carries micLabel so the helper can map a Chromium deviceId to an AVCaptureDevice", () => {
    const labelled = {
      ...host,
      audio: {
        system: false,
        mic: "9f86d081884c7d65",
        micLabel: "Default - MacBook Pro Microphone",
      },
    };
    expect(canonicalStartFromHost(labelled)?.audio).toEqual({
      system: false,
      mic: "9f86d081884c7d65",
      micLabel: "Default - MacBook Pro Microphone",
    });
    const labelOnly = { ...host, audio: { system: true, micLabel: "USB Mic" } };
    expect(canonicalStartFromHost(labelOnly)?.audio).toEqual({
      system: true,
      mic: "default",
      micLabel: "USB Mic",
    });
    const blank = { ...host, audio: { system: true, micLabel: "  " } };
    expect(canonicalStartFromHost(blank)?.audio).toEqual({ system: true });
    const badType = { ...host, audio: { system: true, micLabel: 3 } };
    expect(canonicalStartFromHost(badType)).toBeNull();
  });

  it("the golden host start with micLabel is the shape the Swift self-check decodes", () => {
    const entry = golden.find((g) => g.direction === "inHost" && g.line.includes("micLabel"));
    expect(entry).toBeDefined();
    expect(canonicalStartFromHost(JSON.parse(entry?.line ?? "null"))?.audio.micLabel).toBe(
      "Default - MacBook Pro Microphone",
    );
  });

  it("accepts desktopCapturer window ids and rejects regions on windows", () => {
    const win = { ...host, source: { kind: "window", id: "window:99:0" } };
    expect(canonicalStartFromHost(win)?.source).toEqual({ kind: "window", windowId: 99 });
    const bad = { ...win, region: { x: 0, y: 0, width: 10, height: 10 } };
    expect(SckHostStart.safeParse(bad).success).toBe(false);
    expect(canonicalStartFromHost(bad)).toBeNull();
  });

  it.each([
    ["non-numeric id", { ...host, source: { kind: "display", id: "abc" } }],
    ["id beyond UInt32", { ...host, source: { kind: "display", id: "4294967296" } }],
    ["empty outDir", { ...host, outDir: "" }],
    ["fps 24", { ...host, fps: 24 }],
    ["zero region", { ...host, region: { x: 0, y: 0, width: 0, height: 1 } }],
    ["not an object", "start"],
  ])("rejects %s", (_label, raw) => {
    expect(canonicalStartFromHost(raw)).toBeNull();
  });

  it("parses source ids like the Swift decoder", () => {
    expect(parseSourceId("7")).toBe(7);
    expect(parseSourceId(" screen:5:0 ")).toBe(5);
    expect(parseSourceId(7)).toBe(7);
    expect(parseSourceId(-1)).toBeNull();
    expect(parseSourceId(1.5)).toBeNull();
    expect(parseSourceId("4294967295")).toBe(0xffff_ffff);
    expect(parseSourceId("4294967296")).toBeNull();
    expect(parseSourceId("")).toBeNull();
  });
});

describe("new sck messages", () => {
  it("listSources encodes canonically and bounds thumbnail width", () => {
    expect(encodeSckCommand({ t: "listSources", id: 1 })).toBe('{"t":"listSources","id":1}\n');
    expect(parseSckCommand('{"t":"listSources","thumbnailWidth":8}').ok).toBe(false);
    expect(parseSckCommand('{"t":"listSources","thumbnails":true}').ok).toBe(false);
    expect(parseSckCommand('{"t":"listSources","thumbnails":false}').ok).toBe(true);
  });

  it("rejects sources with non-numeric ids, non-PNG thumbnails or negative sizes", () => {
    const base = {
      t: "sources",
      id: 1,
      displays: [
        { id: "1", name: "d", bounds: { x: 0, y: 0, width: 1, height: 1 }, scaleFactor: 2 },
      ],
      windows: [],
    };
    expect(SckEvent.safeParse(base).success).toBe(true);
    const badId = { ...base, displays: [{ ...base.displays[0], id: "screen:1:0" }] };
    expect(SckEvent.safeParse(badId).success).toBe(false);
    const badThumb = {
      ...base,
      displays: [{ ...base.displays[0], thumbnail: "data:image/jpeg;base64,x" }],
    };
    expect(SckEvent.safeParse(badThumb).success).toBe(false);
    const badSize = {
      ...base,
      displays: [{ ...base.displays[0], bounds: { x: 0, y: 0, width: -1, height: 1 } }],
    };
    expect(SckEvent.safeParse(badSize).success).toBe(false);
  });

  it("deviceLost requires a device string", () => {
    expect(parseSckEvent('{"t":"deviceLost","device":"x","message":""}').ok).toBe(true);
    expect(parseSckEvent('{"t":"deviceLost","message":""}').ok).toBe(false);
  });
});
