import * as nodePath from "node:path";
import fc from "fast-check";
import { type MediaRequest, createMediaProtocolHandler } from "./protocolHandler";
import { createMediaRootRegistry } from "./roots";

interface FakeBody {
  path: string;
  start: number;
  end: number;
}

const files: Record<string, number> = {
  "/p/media/a.mp4": 1000,
  "/p/empty.wav": 0,
  "/p/telemetry.json.gz": 42,
};
const dirs = new Set(["/p/media"]);

function setup() {
  const registry = createMediaRootRegistry();
  registry.add({ id: "proj", realPath: "/p" });
  const streams: FakeBody[] = [];
  const handler = createMediaProtocolHandler<FakeBody>({
    registry,
    path: nodePath.posix,
    realpath: async (p) => {
      if (p in files || dirs.has(p)) return p;
      if (p === "/p/link.mp4") return "/outside/x.mp4";
      throw new Error("ENOENT");
    },
    stat: async (p) => {
      if (dirs.has(p)) return { size: 0, isFile: false };
      const size = files[p];
      if (size === undefined) throw new Error("ENOENT");
      return { size, isFile: true };
    },
    createReadStream: (path, start, end) => {
      const body = { path, start, end };
      streams.push(body);
      return body;
    },
  });
  return { handler, streams };
}

const req = (url: string, range?: string, method = "GET"): MediaRequest => ({
  url,
  method,
  headers: { get: (n) => (n.toLowerCase() === "range" ? (range ?? null) : null) },
});

describe("media protocol handler", () => {
  it("200 full response with length, type and accept-ranges", async () => {
    const { handler } = setup();
    const res = await handler(req("reelform-media://proj/media/a.mp4"));
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({
      "Content-Type": "video/mp4",
      "Content-Length": "1000",
      "Accept-Ranges": "bytes",
    });
    expect(res.body).toEqual({ path: "/p/media/a.mp4", start: 0, end: 999 });
  });

  it("206 partial response", async () => {
    const { handler } = setup();
    const res = await handler(req("reelform-media://proj/media/a.mp4", "bytes=100-199"));
    expect(res.status).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 100-199/1000");
    expect(res.headers["Content-Length"]).toBe("100");
    expect(res.body).toEqual({ path: "/p/media/a.mp4", start: 100, end: 199 });
  });

  it("suffix and open-ended ranges", async () => {
    const { handler } = setup();
    const suffix = await handler(req("reelform-media://proj/media/a.mp4", "bytes=-10"));
    expect(suffix.headers["Content-Range"]).toBe("bytes 990-999/1000");
    const open = await handler(req("reelform-media://proj/media/a.mp4", "bytes=990-"));
    expect(open.body).toEqual({ path: "/p/media/a.mp4", start: 990, end: 999 });
  });

  it("416 with Content-Range */size and no stream opened", async () => {
    const { handler, streams } = setup();
    const res = await handler(req("reelform-media://proj/media/a.mp4", "bytes=1000-"));
    expect(res.status).toBe(416);
    expect(res.headers["Content-Range"]).toBe("bytes */1000");
    expect(res.body).toBeNull();
    expect(streams).toHaveLength(0);
  });

  it("empty file: 200 with zero length and no stream; any range is 416", async () => {
    const { handler, streams } = setup();
    const res = await handler(req("reelform-media://proj/empty.wav"));
    expect(res).toMatchObject({ status: 200, body: null });
    expect(res.headers["Content-Length"]).toBe("0");
    expect((await handler(req("reelform-media://proj/empty.wav", "bytes=0-"))).status).toBe(416);
    expect(streams).toHaveLength(0);
  });

  it("HEAD returns headers without opening a stream", async () => {
    const { handler, streams } = setup();
    const res = await handler(req("reelform-media://proj/media/a.mp4", "bytes=0-9", "HEAD"));
    expect(res.status).toBe(206);
    expect(res.headers["Content-Length"]).toBe("10");
    expect(res.body).toBeNull();
    expect(streams).toHaveLength(0);
  });

  it("status codes for bad requests", async () => {
    const { handler, streams } = setup();
    expect(
      (await handler(req("reelform-media://proj/media/a.mp4", undefined, "POST"))).status,
    ).toBe(405);
    expect((await handler(req("reelform-media://nope/media/a.mp4"))).status).toBe(403);
    expect((await handler(req("reelform-media://proj/../p/media/a.mp4"))).status).toBe(403);
    expect((await handler(req("reelform-media://proj/link.mp4"))).status).toBe(403);
    expect((await handler(req("reelform-media://proj/missing.mp4"))).status).toBe(404);
    expect((await handler(req("reelform-media://proj/media"))).status).toBe(404);
    expect((await handler(req("file:///p/media/a.mp4"))).status).toBe(400);
    expect(streams).toHaveLength(0);
  });

  it("gz telemetry mime", async () => {
    const { handler } = setup();
    const res = await handler(req("reelform-media://proj/telemetry.json.gz"));
    expect(res.headers["Content-Type"]).toBe("application/gzip");
  });

  it("property: Content-Length always equals the streamed byte count", async () => {
    const { handler } = setup();
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1200 }),
        fc.integer({ min: 0, max: 1200 }),
        async (a, b) => {
          const res = await handler(req("reelform-media://proj/media/a.mp4", `bytes=${a}-${b}`));
          if (res.body) {
            expect(Number(res.headers["Content-Length"])).toBe(res.body.end - res.body.start + 1);
            expect(res.body.end).toBeLessThan(1000);
          } else {
            expect(res.status).toBe(416);
          }
        },
      ),
    );
  });
});
