import { describe, expect, it, vi } from "vitest";
import { createIpcSystemPort } from "./systemPort";

describe("createIpcSystemPort", () => {
  it("maps port calls onto system:* channels and unwraps responses", async () => {
    const call = vi.fn(async (channel: string, _payload: unknown) => {
      switch (channel) {
        case "system:pickFolder":
          return { path: "/picked" };
        case "system:saveDialog":
          return { path: null };
        case "system:clipboardWriteFile":
          return { ok: true, method: "cf-hdrop" };
        default:
          return { ok: true };
      }
    });
    const writeText = vi.fn(async () => undefined);
    const port = createIpcSystemPort(call, writeText);
    await port.reveal("/x/a.mp4");
    expect(await port.pickFolder()).toBe("/picked");
    expect(await port.saveDialog({ defaultName: "a.mp4" })).toBeNull();
    expect(await port.pickFile({ title: "t" })).toBeNull();
    expect(await port.clipboardWriteFile("/x/a.mp4")).toEqual({ method: "cf-hdrop" });
    await port.copyText("diag");
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      "system:reveal",
      "system:pickFolder",
      "system:saveDialog",
      "system:pickFile",
      "system:clipboardWriteFile",
    ]);
    expect(call.mock.calls[0]?.[1]).toEqual({ path: "/x/a.mp4" });
    expect(call.mock.calls[1]?.[1]).toEqual({});
    expect(writeText).toHaveBeenCalledWith("diag");
  });

  it("treats a missing bridge (null) as cancelled pickers", async () => {
    const port = createIpcSystemPort(
      async () => null,
      async () => undefined,
    );
    expect(await port.pickFolder()).toBeNull();
    expect(await port.clipboardWriteFile("/a")).toEqual({ method: "file-url" });
  });
});
