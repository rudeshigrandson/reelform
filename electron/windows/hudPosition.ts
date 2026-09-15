import {
  HUD_SIZE,
  type Point,
  type Rect,
  type Size,
  clampIntoArea,
  defaultHudPosition,
} from "./windowOptions";

/**
 * HUD position persisted per display (ENGINEERING_SPEC §5.7). Stored as an
 * offset from the display work-area origin so it survives display
 * re-arrangement; restored positions are clamped back inside the work area.
 */
export interface HudPositionStore {
  get(displayId: string): Point | undefined;
  set(displayId: string, offset: Point): void;
}

/** In-memory store (tests, or a fallback when settings are unavailable). */
export function createMemoryHudPositionStore(): HudPositionStore {
  const map = new Map<string, Point>();
  return {
    get: (id) => map.get(id),
    set: (id, offset) => {
      map.set(id, { x: offset.x, y: offset.y });
    },
  };
}

export interface HudPositionFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface FileHudPositionStore extends HudPositionStore {
  /** Read the file into memory; missing or corrupt files start empty. */
  load(): Promise<void>;
  /** Resolves once every pending write has landed (tests, quit). */
  flush(): Promise<void>;
}

const MAX_HUD_DISPLAYS = 64;

function parsePositions(raw: string): Map<string, Point> {
  const map = new Map<string, Point>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return map;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return map;
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (map.size >= MAX_HUD_DISPLAYS) break;
    const v = value as { x?: unknown; y?: unknown } | null;
    if (
      typeof v === "object" &&
      v !== null &&
      typeof v.x === "number" &&
      typeof v.y === "number" &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y)
    ) {
      map.set(id, { x: v.x, y: v.y });
    }
  }
  return map;
}

const parentDir = (p: string): string => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return ".";
  return i === 0 ? p.slice(0, 1) : p.slice(0, i);
};

/**
 * File-backed store (`userData/hud-positions.json`). Kept out of the settings
 * schema so HUD drags never touch settings or its UI. Reads are synchronous
 * from memory; each change writes atomically (tmp + rename), serialized.
 */
export function createFileHudPositionStore(
  filePath: string,
  fs: HudPositionFs,
  log?: ((message: string) => void) | undefined,
): FileHudPositionStore {
  let map = new Map<string, Point>();
  let chain: Promise<void> = Promise.resolve();

  const persist = (): void => {
    const data = JSON.stringify(Object.fromEntries(map), null, 2);
    chain = chain.then(async () => {
      const tmp = `${filePath}.tmp`;
      try {
        await fs.mkdir(parentDir(filePath));
        await fs.writeFile(tmp, data);
        await fs.rename(tmp, filePath);
      } catch (e) {
        log?.(`hud positions not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  };

  return {
    async load() {
      try {
        map = parsePositions(await fs.readFile(filePath));
      } catch {
        map = new Map();
      }
    },
    get: (id) => map.get(id),
    set: (id, offset) => {
      const prev = map.get(id);
      if (prev && prev.x === offset.x && prev.y === offset.y) return;
      map.set(id, { x: offset.x, y: offset.y });
      persist();
    },
    flush: () => chain,
  };
}

export function resolveHudPosition(
  store: HudPositionStore,
  displayId: string,
  workArea: Rect,
  size: Size = HUD_SIZE,
): Point {
  const offset = store.get(displayId);
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    return defaultHudPosition(workArea, size);
  }
  return clampIntoArea({ x: workArea.x + offset.x, y: workArea.y + offset.y }, workArea, size);
}

export function saveHudPosition(
  store: HudPositionStore,
  displayId: string,
  workArea: Rect,
  topLeft: Point,
): void {
  store.set(displayId, {
    x: Math.round(topLeft.x - workArea.x),
    y: Math.round(topLeft.y - workArea.y),
  });
}
