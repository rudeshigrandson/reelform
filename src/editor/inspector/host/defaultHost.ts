import { useProjectSession } from "../../../app/project/session";
import { useEditorStore } from "../../store";
import { type InspectorMessageKey, ti } from "../i18n";
import type { CaptionsPort, InspectorHost } from "./types";

/**
 * Stand-in host used until the orchestrator passes a real one: dialogs resolve
 * "cancelled", project-folder operations reject with a clear message, and
 * document edits write straight to the stores (no history).
 */

export class HostUnavailableError extends Error {
  readonly code = "host-unavailable";
  /** `what` is the already-translated feature name, e.g. "Transcription". */
  constructor(what: string) {
    super(ti("inspector.host.unavailable", { what }));
    this.name = "HostUnavailableError";
  }
}

const unavailable = (what: InspectorMessageKey) => (): Promise<never> =>
  Promise.reject(new HostUnavailableError(ti(what)));

export const noopCaptionsPort: CaptionsPort = {
  models: () => Promise.resolve([]),
  download: unavailable("inspector.host.feature.modelDownload"),
  cancelDownload: () => Promise.resolve(),
  transcribe: unavailable("inspector.host.feature.transcription"),
  onProgress: () => () => {},
};

export function detectPlatform(): InspectorHost["platform"] {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac|iPhone|iPad/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "win";
  return "linux";
}

export function createDefaultInspectorHost(overrides: Partial<InspectorHost> = {}): InspectorHost {
  return {
    pickFile: () => Promise.resolve(null),
    saveFile: () => Promise.resolve(null),
    readTextFile: unavailable("inspector.host.feature.readingFiles"),
    reveal: () => Promise.resolve(),
    importMedia: unavailable("inspector.host.feature.importingMedia"),
    relinkMedia: unavailable("inspector.host.feature.relinkingMedia"),
    trimSource: () => Promise.resolve(null),
    deleteProject: unavailable("inspector.host.feature.deletingProjects"),
    statSources: () => Promise.resolve({}),
    decodeAudio: () => Promise.resolve(null),
    captions: noopCaptionsPort,
    documentUpdate: (_label, patch) => useEditorStore.getState().update(patch),
    metaUpdate: (_label, update, patch) => {
      const session = useProjectSession.getState();
      if (session.meta) session.setSession({ meta: update(session.meta) });
      if (patch) useEditorStore.getState().update(patch);
    },
    platform: detectPlatform(),
    defer: (work) => {
      setTimeout(work, 0);
    },
    ...overrides,
  };
}
