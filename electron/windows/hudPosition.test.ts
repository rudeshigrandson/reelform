import {
  type HudPositionFs,
  createFileHudPositionStore,
  resolveHudPosition,
  saveHudPosition,
} from "./hudPosition";

class FakeFs implements HudPositionFs {
  files = new Map<string, string>();
  ops: string[] = [];
  failWrite = false;
  readFile = async (p: string) => {
    const v = this.files.get(p);
    if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return v;
  };
  writeFile = async (p: string, d: string) => {
    if (this.failWrite) throw new Error("EACCES");
    this.ops.push(`write ${p}`);
    this.files.set(p, d);
  };
  rename = async (a: string, b: string) => {
    this.ops.push(`rename ${a} ${b}`);
    const v = this.files.get(a);
    if (v === undefined) throw new Error("ENOENT");
    this.files.delete(a);
    this.files.set(b, v);
  };
  mkdir = async (p: string) => {
    this.ops.push(`mkdir ${p}`);
  };
}

const FILE = "/u/hud-positions.json";

describe("createFileHudPositionStore", () => {
  it("starts empty when the file is missing and writes atomically on set", async () => {
    const fs = new FakeFs();
    const store = createFileHudPositionStore(FILE, fs);
    await store.load();
    expect(store.get("1")).toBeUndefined();
    store.set("1", { x: 10, y: 20 });
    expect(store.get("1")).toEqual({ x: 10, y: 20 });
    await store.flush();
    expect(fs.ops).toEqual(["mkdir /u", `write ${FILE}.tmp`, `rename ${FILE}.tmp ${FILE}`]);
    expect(JSON.parse(fs.files.get(FILE) ?? "")).toEqual({ "1": { x: 10, y: 20 } });
  });

  it("round-trips across instances (survives restart)", async () => {
    const fs = new FakeFs();
    const a = createFileHudPositionStore(FILE, fs);
    await a.load();
    a.set("1", { x: 1, y: 2 });
    a.set("2", { x: 3, y: 4 });
    await a.flush();
    const b = createFileHudPositionStore(FILE, fs);
    await b.load();
    expect(b.get("2")).toEqual({ x: 3, y: 4 });
    const area = { x: 100, y: 0, width: 1000, height: 800 };
    saveHudPosition(b, "3", area, { x: 150, y: 60 });
    expect(b.get("3")).toEqual({ x: 50, y: 60 });
    expect(resolveHudPosition(b, "3", area)).toEqual({ x: 150, y: 60 });
  });

  it("ignores corrupt files and invalid entries", async () => {
    const fs = new FakeFs();
    fs.files.set(FILE, "{nope");
    const a = createFileHudPositionStore(FILE, fs);
    await a.load();
    expect(a.get("1")).toBeUndefined();

    fs.files.set(FILE, JSON.stringify({ ok: { x: 1, y: 2 }, bad: { x: "1", y: 2 }, nil: null }));
    const b = createFileHudPositionStore(FILE, fs);
    await b.load();
    expect(b.get("ok")).toEqual({ x: 1, y: 2 });
    expect(b.get("bad")).toBeUndefined();
    expect(b.get("nil")).toBeUndefined();
  });

  it("skips writes for unchanged positions and logs write failures without throwing", async () => {
    const fs = new FakeFs();
    const log = vi.fn();
    const store = createFileHudPositionStore(FILE, fs, log);
    await store.load();
    store.set("1", { x: 1, y: 1 });
    await store.flush();
    const before = fs.ops.length;
    store.set("1", { x: 1, y: 1 });
    await store.flush();
    expect(fs.ops.length).toBe(before);

    fs.failWrite = true;
    store.set("1", { x: 2, y: 2 });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("EACCES"));
    expect(store.get("1")).toEqual({ x: 2, y: 2 });
  });
});
