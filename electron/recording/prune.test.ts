import { DAY_MS, isAttachedToProject, pruneRecordings } from "./prune";

const NOW = 100 * DAY_MS;

function setup(dirs: { path: string; ageDays: number; imported?: boolean }[]) {
  const removed: string[] = [];
  const deps = {
    listSessionDirs: vi.fn(async () =>
      dirs.map((d) => ({ path: d.path, mtimeMs: NOW - d.ageDays * DAY_MS })),
    ),
    isImported: vi.fn(async (dir: string) => dirs.find((d) => d.path === dir)?.imported === true),
    removeDir: vi.fn(async (dir: string) => {
      removed.push(dir);
    }),
    now: () => NOW,
    log: vi.fn(),
  };
  return { deps, removed };
}

describe("pruneRecordings", () => {
  it("removes only dirs older than N days that are not imported", async () => {
    const { deps, removed } = setup([
      { path: "/r/old", ageDays: 20 },
      { path: "/r/fresh", ageDays: 3 },
      { path: "/r/old-imported", ageDays: 30, imported: true },
      { path: "/r/edge", ageDays: 14 },
    ]);
    const out = await pruneRecordings(deps, 14);
    expect(out).toEqual(["/r/old"]);
    expect(removed).toEqual(["/r/old"]);
    expect(deps.isImported).not.toHaveBeenCalledWith("/r/fresh");
  });

  it("does nothing for non-positive or non-finite day counts", async () => {
    const { deps } = setup([{ path: "/r/old", ageDays: 400 }]);
    expect(await pruneRecordings(deps, 0)).toEqual([]);
    expect(await pruneRecordings(deps, Number.NaN)).toEqual([]);
    expect(deps.listSessionDirs).not.toHaveBeenCalled();
  });

  it("continues past a failing remove and logs it", async () => {
    const { deps } = setup([
      { path: "/r/a", ageDays: 20 },
      { path: "/r/b", ageDays: 20 },
    ]);
    deps.removeDir.mockImplementationOnce(async () => {
      throw new Error("EBUSY");
    });
    expect(await pruneRecordings(deps, 7)).toEqual(["/r/b"]);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("/r/a"));
  });

  it("returns [] when the recordings folder cannot be listed", async () => {
    const { deps } = setup([]);
    deps.listSessionDirs.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await pruneRecordings(deps, 7)).toEqual([]);
  });

  it("honours the skip predicate (live session)", async () => {
    const { deps } = setup([{ path: "/r/live", ageDays: 20 }]);
    expect(await pruneRecordings({ ...deps, skip: (d) => d === "/r/live" }, 7)).toEqual([]);
  });
});

describe("session dir probes", () => {
  it("project marker means attached; leftovers after the media move are prunable", () => {
    expect(isAttachedToProject(["screen.mp4", "project.json"])).toBe(true);
    expect(isAttachedToProject(["screen.mp4", "meta.json"])).toBe(false);
    expect(isAttachedToProject(["meta.json"])).toBe(false);
    expect(isAttachedToProject([])).toBe(false);
  });
});
