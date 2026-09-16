import { describe, expect, it, vi } from "vitest";
import { ImportKind, systemFileContracts, systemProjectFileContracts } from "./contracts";
import {
  type SystemDeps,
  SystemIpcError,
  clipboardPayload,
  createSystemFileHandlers,
  dropFilesBuffer,
  fileUrlFor,
} from "./handlers";
import { createPickedPathRegistry } from "./pickedPaths";

function makeDeps(overrides: Partial<SystemDeps> = {}) {
  const calls = {
    revealed: [] as string[],
    open: [] as unknown[],
    save: [] as unknown[],
    clipboard: [] as { format: string; bytes: Uint8Array }[],
  };
  const deps: SystemDeps = {
    platform: "darwin",
    pathExists: async (p) => p.startsWith("/exists"),
    showItemInFolder: (p) => {
      calls.revealed.push(p);
    },
    showOpenDialog: async (o) => {
      calls.open.push(o);
      return { canceled: false, filePaths: ["/picked/a"] };
    },
    showSaveDialog: async (o) => {
      calls.save.push(o);
      return { canceled: false, filePath: "/picked/out.mp4" };
    },
    clipboardWriteBuffer: (format, bytes) => {
      calls.clipboard.push({ format, bytes });
    },
    defaultSaveDir: () => "/Users/me/Movies",
    ...overrides,
  };
  return { deps, calls, h: createSystemFileHandlers(deps) };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof SystemIpcError ? e.code : `other:${String(e)}`;
  }
  return "resolved";
}

describe("system contracts", () => {
  it("names match keys and validate requests", () => {
    for (const [k, ch] of Object.entries(systemFileContracts)) expect(ch.name).toBe(k);
    expect(systemFileContracts["system:pickFolder"].request.safeParse(undefined).success).toBe(
      true,
    );
    const pick = systemFileContracts["system:pickFile"].request;
    expect(pick.safeParse({ filters: [{ name: "Video", extensions: ["mp4"] }] }).success).toBe(
      true,
    );
    expect(pick.safeParse({ filters: [{ name: "Bad", extensions: [".mp4"] }] }).success).toBe(
      false,
    );
    expect(systemFileContracts["system:reveal"].request.safeParse({ path: "" }).success).toBe(
      false,
    );
  });
});

describe("project file contracts", () => {
  it("copyIntoProject accepts font imports (media/imported/font) and rejects unknown kinds", () => {
    const copy = systemProjectFileContracts["system:copyIntoProject"].request;
    expect(ImportKind.options).toEqual(["webcam", "audio", "image", "font"]);
    expect(copy.safeParse({ projectPath: "/p", kind: "font", sourcePath: "/f.ttf" }).success).toBe(
      true,
    );
    expect(
      copy.safeParse({ projectPath: "/p", kind: "cursor", sourcePath: "/c.svg" }).success,
    ).toBe(false);
  });
});

describe("system:reveal", () => {
  it("reveals an existing absolute path", async () => {
    const { h, calls } = makeDeps();
    await expect(h["system:reveal"]({ path: "/exists/out.mp4" })).resolves.toEqual({ ok: true });
    expect(calls.revealed).toEqual(["/exists/out.mp4"]);
  });

  it("rejects relative and missing paths with stable codes", async () => {
    const { h, calls } = makeDeps();
    expect(await codeOf(h["system:reveal"]({ path: "out.mp4" }))).toBe("INVALID_PATH");
    expect(await codeOf(h["system:reveal"]({ path: "/nope/out.mp4" }))).toBe("FILE_NOT_FOUND");
    expect(await codeOf(h["system:reveal"]({ path: "/exists/a\0b" }))).toBe("INVALID_PATH");
    expect(calls.revealed).toEqual([]);
  });

  it("uses win32 path rules on Windows", async () => {
    const { h, calls } = makeDeps({ platform: "win32", pathExists: async () => true });
    await h["system:reveal"]({ path: "C:\\Users\\me\\out.mp4" });
    expect(calls.revealed).toEqual(["C:\\Users\\me\\out.mp4"]);
    expect(await codeOf(h["system:reveal"]({ path: "/unix/style" }))).toBe("resolved");
  });
});

describe("pickers", () => {
  it("pickFile passes filters/title and returns the first path", async () => {
    const { h, calls } = makeDeps();
    const filters = [{ name: "Captions", extensions: ["srt", "vtt"] }];
    await expect(h["system:pickFile"]({ filters, title: "Import" })).resolves.toEqual({
      path: "/picked/a",
    });
    expect(calls.open[0]).toEqual({ title: "Import", filters, properties: ["openFile"] });
  });

  it("returns null when cancelled or empty", async () => {
    const { h } = makeDeps({
      showOpenDialog: async () => ({ canceled: true, filePaths: ["/x"] }),
      showSaveDialog: async () => ({ canceled: false }),
    });
    expect(await h["system:pickFile"]({})).toEqual({ path: null });
    expect(await h["system:pickFolder"](undefined)).toEqual({ path: null });
    expect(await h["system:saveDialog"]({ defaultName: "a.mp4" })).toEqual({ path: null });
    const empty = makeDeps({ showOpenDialog: async () => ({ canceled: false, filePaths: [] }) });
    expect(await empty.h["system:pickFolder"]({})).toEqual({ path: null });
  });

  it("pickFolder asks for a directory", async () => {
    const { h, calls } = makeDeps();
    await h["system:pickFolder"]({ title: "Export to" });
    expect(calls.open[0]).toMatchObject({
      title: "Export to",
      properties: ["openDirectory", "createDirectory"],
    });
  });

  it("records picked and saved files in the picked-path registry; cancels record nothing", async () => {
    const pickedPaths = createPickedPathRegistry("linux");
    const { h } = makeDeps({ pickedPaths });
    await h["system:pickFile"]({});
    await h["system:saveDialog"]({ defaultName: "out.mp4" });
    expect(pickedPaths.has("/picked/a")).toBe(true);
    expect(pickedPaths.has("/picked/out.mp4")).toBe(true);

    const none = createPickedPathRegistry("linux");
    const cancelled = makeDeps({
      pickedPaths: none,
      showOpenDialog: async () => ({ canceled: true, filePaths: ["/nope"] }),
      showSaveDialog: async () => ({ canceled: true, filePath: "/nope2" }),
    });
    await cancelled.h["system:pickFile"]({});
    await cancelled.h["system:saveDialog"]({ defaultName: "a.srt" });
    await cancelled.h["system:pickFolder"](undefined);
    expect(none.has("/nope")).toBe(false);
    expect(none.has("/nope2")).toBe(false);
  });

  it("saveDialog joins the default dir and strips directories from the name", async () => {
    const { h, calls } = makeDeps();
    await h["system:saveDialog"]({ defaultName: "../../evil/Demo.mp4" });
    expect(calls.save[0]).toEqual({ defaultPath: "/Users/me/Movies/Demo.mp4", filters: undefined });
    await h["system:saveDialog"]({ defaultName: "Demo.gif", defaultDir: "/tmp/x" });
    expect(calls.save[1]).toMatchObject({ defaultPath: "/tmp/x/Demo.gif" });
  });
});

describe("system:clipboardWriteFile", () => {
  it("writes a file URL on macOS", async () => {
    const { h, calls } = makeDeps();
    const res = await h["system:clipboardWriteFile"]({ path: "/exists/My Demo #1.mp4" });
    expect(res).toEqual({ ok: true, method: "file-url" });
    expect(calls.clipboard[0]?.format).toBe("public.file-url");
    expect(new TextDecoder().decode(calls.clipboard[0]?.bytes)).toBe(
      "file:///exists/My%20Demo%20%231.mp4",
    );
  });

  it("writes CF_HDROP on Windows and a uri-list on Linux", async () => {
    const win = makeDeps({ platform: "win32", pathExists: async () => true });
    expect(await win.h["system:clipboardWriteFile"]({ path: "C:\\a\\b.mp4" })).toEqual({
      ok: true,
      method: "cf-hdrop",
    });
    expect(win.calls.clipboard[0]?.format).toBe("CF_HDROP");
    const linux = makeDeps({ platform: "linux" });
    await linux.h["system:clipboardWriteFile"]({ path: "/exists/a.gif" });
    expect(linux.calls.clipboard[0]?.format).toBe("text/uri-list");
    expect(new TextDecoder().decode(linux.calls.clipboard[0]?.bytes)).toBe(
      "file:///exists/a.gif\r\n",
    );
  });

  it("fails with stable codes for missing files and clipboard errors", async () => {
    const { h } = makeDeps();
    expect(await codeOf(h["system:clipboardWriteFile"]({ path: "/nope.mp4" }))).toBe(
      "FILE_NOT_FOUND",
    );
    const broken = makeDeps({
      clipboardWriteBuffer: vi.fn(() => {
        throw new Error("denied");
      }),
    });
    expect(await codeOf(broken.h["system:clipboardWriteFile"]({ path: "/exists/a" }))).toBe(
      "CLIPBOARD_FAILED",
    );
  });
});

describe("payload helpers", () => {
  it("builds a DROPFILES struct with a double-NUL UTF-16 list", () => {
    const buf = dropFilesBuffer(["C:\\é.mp4"]);
    const view = new DataView(buf.buffer);
    expect(view.getUint32(0, true)).toBe(20);
    expect(view.getInt32(16, true)).toBe(1);
    const chars = "C:\\é.mp4";
    expect(buf.byteLength).toBe(20 + (chars.length + 2) * 2);
    for (let i = 0; i < chars.length; i++) {
      expect(view.getUint16(20 + i * 2, true)).toBe(chars.charCodeAt(i));
    }
    expect(view.getUint16(buf.byteLength - 4, true)).toBe(0);
    expect(view.getUint16(buf.byteLength - 2, true)).toBe(0);
  });

  it("file URLs keep Windows drive letters and encode segments", () => {
    expect(fileUrlFor("C:\\My Videos\\a.mp4", "win32")).toBe("file:///C:/My%20Videos/a.mp4");
    expect(fileUrlFor("/a/b c/ü.mp4", "darwin")).toBe("file:///a/b%20c/%C3%BC.mp4");
    expect(clipboardPayload("/a", "freebsd").method).toBe("uri-list");
  });
});
