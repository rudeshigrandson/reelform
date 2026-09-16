import { describe, expect, it, vi } from "vitest";
import type { SceneState } from "../../editor/preview/scene";
import type { TransitionState } from "../../editor/preview/transitions";
import type { FrameRenderer } from "./frameRenderer";
import type { FrameSource } from "./streamingDecoder";
import { TransitionFeed } from "./transitionFeed";

interface TestFrame {
  timestamp: number;
  closed: boolean;
  close(): void;
}

function source(fail = false) {
  const frames: TestFrame[] = [];
  const src = {
    closed: false,
    frameAt: vi.fn(async (ms: number) => {
      if (fail) throw new Error("decode failed");
      const f: TestFrame = {
        timestamp: ms * 1000,
        closed: false,
        close() {
          f.closed = true;
        },
      };
      frames.push(f);
      return f as unknown as VideoFrame;
    }),
    close() {
      src.closed = true;
    },
  };
  return { src: src as FrameSource & { closed: boolean; frameAt: typeof src.frameAt }, frames };
}

function renderer(withNext = true) {
  const sets: (number | null)[] = [];
  const r: FrameRenderer = {
    render: vi.fn(),
    destroy: vi.fn(),
    ...(withNext
      ? {
          setNextVideoFrame: (f: VideoFrame | null) =>
            sets.push(f ? (f as unknown as TestFrame).timestamp : null),
        }
      : {}),
  };
  return { r, sets };
}

const dissolve = (mix: number, incomingSourceMs = 4000): SceneState =>
  ({
    transition: {
      kind: "cross-dissolve",
      mix,
      incomingSourceMs,
    } as Partial<TransitionState>,
  }) as unknown as SceneState;
const plain = { transition: null } as unknown as SceneState;
const never = () => false;

describe("TransitionFeed", () => {
  it("decodes the incoming frame once per dissolve and detaches after it", async () => {
    const { src, frames } = source();
    const open = vi.fn(async () => src);
    const { r, sets } = renderer();
    const feed = new TransitionFeed({ open, renderer: r });
    await feed.prepare(plain, never);
    expect(open).not.toHaveBeenCalled();
    await feed.prepare(dissolve(0), never);
    expect(open).not.toHaveBeenCalled();
    await feed.prepare(dissolve(0.2), never);
    await feed.prepare(dissolve(0.8), never);
    expect(src.frameAt).toHaveBeenCalledTimes(1);
    expect(sets).toEqual([4_000_000]);
    await feed.prepare(dissolve(0.5, 9000), never);
    expect(frames[0]?.closed).toBe(true);
    expect(sets).toEqual([4_000_000, null, 9_000_000]);
    await feed.prepare(plain, never);
    expect(frames[1]?.closed).toBe(true);
    expect(sets.at(-1)).toBeNull();
    feed.release();
    expect(src.closed).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("skips dissolves when the renderer can't draw them or decoding fails", async () => {
    const noNext = renderer(false);
    const open = vi.fn(async () => source().src);
    await new TransitionFeed({ open, renderer: noNext.r }).prepare(dissolve(0.5), never);
    expect(open).not.toHaveBeenCalled();

    const broken = source(true);
    const { r, sets } = renderer();
    const openBroken = vi.fn(async () => broken.src);
    const feed = new TransitionFeed({ open: openBroken, renderer: r });
    await feed.prepare(dissolve(0.5), never);
    await feed.prepare(dissolve(0.5, 8000), never);
    expect(broken.src.frameAt).toHaveBeenCalledTimes(1);
    expect(broken.src.closed).toBe(true);
    expect(sets).toEqual([]);
  });

  it("rethrows when aborted and never leaks a late frame", async () => {
    const { src, frames } = source();
    const { r, sets } = renderer();
    let aborted = false;
    src.frameAt.mockImplementationOnce(async (ms: number) => {
      aborted = true;
      const f: TestFrame = {
        timestamp: ms,
        closed: false,
        close() {
          f.closed = true;
        },
      };
      frames.push(f);
      return f as unknown as VideoFrame;
    });
    const feed = new TransitionFeed({ open: async () => src, renderer: r });
    await feed.prepare(dissolve(0.5), () => aborted);
    expect(frames[0]?.closed).toBe(true);
    expect(sets).toEqual([]);

    const failing = source(true);
    const f2 = new TransitionFeed({ open: async () => failing.src, renderer: r });
    await expect(f2.prepare(dissolve(0.5), () => true)).resolves.toBeUndefined();
  });
});
