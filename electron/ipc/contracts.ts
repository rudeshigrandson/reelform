import { z } from "zod";

/**
 * Single source of truth for every IPC channel name and its request/response
 * shape. Shared by main (handler registration) and renderer (typed invoke) via
 * the `@contracts` path alias. Renderer never imports anything else from
 * `electron/`. Channels are named `domain:verb`.
 */

export const IpcError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type IpcError = z.infer<typeof IpcError>;

/** One channel: its name + zod schemas for the request and response bodies. */
export interface Channel<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny> {
  name: string;
  request: Req;
  response: Res;
}

const channel = <Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  name: string,
  request: Req,
  response: Res,
): Channel<Req, Res> => ({ name, request, response });

// ---- system domain (minimal M0 surface) --------------------------------
export const contracts = {
  "system:ping": channel("system:ping", z.void(), z.object({ pong: z.literal(true), version: z.string() })),
  "system:openExternal": channel("system:openExternal", z.object({ url: z.string().url() }), z.object({ ok: z.boolean() })),
} as const;

export type Contracts = typeof contracts;
export type ChannelName = keyof Contracts;

export type RequestOf<K extends ChannelName> = z.infer<Contracts[K]["request"]>;
export type ResponseOf<K extends ChannelName> = z.infer<Contracts[K]["response"]>;

/** The typed API exposed on `window.reelform` by the preload bridge. */
export interface ReelformApi {
  invoke<K extends ChannelName>(channel: K, payload: RequestOf<K>): Promise<ResponseOf<K>>;
  on(channel: string, cb: (payload: unknown) => void): () => void;
}
