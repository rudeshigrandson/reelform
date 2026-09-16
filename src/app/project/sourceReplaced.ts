import type { EventName, EventPayloadOf } from "@contracts";
import { onEvent as appOnEvent } from "../ipc";
import { type ProjectStores, defaultProjectStores, mediaUrl } from "./openProject";
import type { ProjectSessionData } from "./session";

/**
 * `project:sourceReplaced` (main swapped a source's file in `project.json`, e.g.
 * the background H.264 transcode relink) → this editor window's session.
 *
 * Sources live in the session's `meta`, not in the undoable editor store, so the
 * patch adds no undo step and does not dirty the project; the next save simply
 * carries the new path (main also merges it into stale saves).
 */

export type SourceReplacedEvent = EventPayloadOf<"project:sourceReplaced">;

type OnEvent = <K extends EventName>(
  channel: K,
  cb: (payload: EventPayloadOf<K>) => void,
) => () => void;

const URL_KEY = {
  video: "videoUrl",
  webcam: "webcamUrl",
} as const satisfies Record<SourceReplacedEvent["source"], keyof ProjectSessionData>;

const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

/** Apply the swap when it targets the open project and its source still holds `from`. */
export function applySourceReplaced(
  e: SourceReplacedEvent,
  stores: Pick<ProjectStores, "session"> = defaultProjectStores(),
): boolean {
  const session = stores.session.getState();
  const { meta } = session;
  if (!meta) return false;
  const sameProject =
    session.projectPath === e.path || (e.projectId !== null && session.projectId === e.projectId);
  if (!sameProject) return false;
  const current = meta.sources[e.source];
  if (!current || current.path !== e.from) return false;
  const next = { ...current, path: e.to, ...(e.codec === undefined ? {} : { codec: e.codec }) };
  const patch: Partial<ProjectSessionData> = {
    meta: { ...meta, sources: { ...meta.sources, [e.source]: next } },
  };
  // Main only writes project-relative paths here; anything else keeps the served URL.
  if (!isAbsolutePath(e.to) && session.mediaBaseUrl !== null) {
    patch[URL_KEY[e.source]] = mediaUrl(session.mediaBaseUrl, e.to);
  }
  session.setSession(patch);
  return true;
}

/** Subscribe this window to source swaps; returns an unsubscribe. */
export function bindSourceReplaced(
  onEvent: OnEvent = appOnEvent,
  stores: Pick<ProjectStores, "session"> = defaultProjectStores(),
): () => void {
  return onEvent("project:sourceReplaced", (e) => {
    applySourceReplaced(e, stores);
  });
}
