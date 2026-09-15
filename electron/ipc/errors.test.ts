import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IPC_ERROR_PREFIX, ReelformIpcError, decodeIpcError, toIpcError } from "./errors";

/** What the renderer actually receives from a rejected ipcRenderer.invoke. */
function overElectron(err: unknown, channel = "project:open"): Error {
  const encoded = `${IPC_ERROR_PREFIX}${JSON.stringify(toIpcError(err))}`;
  return new Error(`Error invoking remote method '${channel}': Error: ${encoded}`);
}

describe("toIpcError", () => {
  it("uses an error's own toIpcError serializer", () => {
    const err = Object.assign(new Error("nope"), {
      toIpcError: () => ({
        code: "PROJECT_NOT_FOUND",
        message: "missing",
        details: { path: "/x" },
      }),
    });
    expect(toIpcError(err)).toEqual({
      code: "PROJECT_NOT_FOUND",
      message: "missing",
      details: { path: "/x" },
    });
  });

  it("keeps code and details from coded errors and omits undefined details", () => {
    const coded = Object.assign(new Error("disk low"), { code: "DISK_LOW" });
    expect(toIpcError(coded)).toEqual({ code: "DISK_LOW", message: "disk low" });
    const withDetails = Object.assign(new Error("bad"), { code: "X", details: [1] });
    expect(toIpcError(withDetails)).toEqual({ code: "X", message: "bad", details: [1] });
  });

  it("maps zod failures to INVALID_PAYLOAD with issues", () => {
    const res = z.object({ path: z.string() }).safeParse({ path: 3 });
    expect(res.success).toBe(false);
    if (res.success) return;
    const e = toIpcError(res.error);
    expect(e.code).toBe("INVALID_PAYLOAD");
    expect(Array.isArray(e.details)).toBe(true);
  });

  it("falls back to INTERNAL for plain errors and non-errors", () => {
    expect(toIpcError(new Error("boom"))).toEqual({ code: "INTERNAL", message: "boom" });
    expect(toIpcError("str")).toEqual({ code: "INTERNAL", message: "str" });
    expect(toIpcError(null)).toEqual({ code: "INTERNAL", message: "null" });
  });
});

describe("decodeIpcError", () => {
  it("recovers the IpcError from Electron's wrapped message", () => {
    const err = Object.assign(new Error("gone"), {
      code: "EXPORT_NOT_FOUND",
      details: { id: "e1" },
    });
    expect(decodeIpcError(overElectron(err))).toEqual({
      code: "EXPORT_NOT_FOUND",
      message: "gone",
      details: { id: "e1" },
    });
  });

  it("returns null for foreign errors and malformed payloads", () => {
    expect(decodeIpcError(new Error("network down"))).toBeNull();
    expect(decodeIpcError(new Error(`${IPC_ERROR_PREFIX}{not json`))).toBeNull();
    expect(decodeIpcError(new Error(`${IPC_ERROR_PREFIX}{"code":1}`))).toBeNull();
    expect(decodeIpcError(42)).toBeNull();
  });

  it("property: any code/message/details round-trips through the Electron wrapper", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string(),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (code, message, details) => {
          const err = Object.assign(new Error(message), { code, details });
          const decoded = decodeIpcError(overElectron(err));
          const expected = details === undefined ? { code, message } : { code, message, details };
          expect(decoded).toEqual(JSON.parse(JSON.stringify(expected)));
        },
      ),
    );
  });

  it("ReelformIpcError exposes code and details", () => {
    const e = new ReelformIpcError({ code: "NO_SPEECH", message: "no speech", details: 1 });
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.message, e.details]).toEqual(["NO_SPEECH", "no speech", 1]);
  });
});
