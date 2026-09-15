import { type ReactElement, useEffect, useMemo, useState } from "react";
import {
  type ProjectMediaPort,
  browserMediaPort,
  mediaUrl,
} from "../../../app/project/openProject";
import { type ProjectSessionData, useProjectSession } from "../../../app/project/session";
import { type ParsedTelemetry, type ProjectMeta, readTelemetryFile } from "../../persistence";
import { useEditorStore } from "../../store";
import { EmptyState } from "../controls";
import { ti, useInspectorT, withDetail } from "../i18n";
import { ProjectInspector } from "../project";
import { computeTrimSavingsBytes } from "../project/logic";
import type { SourceStat } from "../project/types";
import { AUDIO_FILTERS } from "./AudioTab";
import { VIDEO_FILTERS } from "./WebcamTab";
import { errorMessage } from "./hooks";
import { type SourceRole, projectInfoFromSession, roleForPath, sourcePaths } from "./projectInfo";
import { timelineClips } from "./timeMap";
import type { EditorPatch, InspectorHost, MetaUpdateEffects, TrimSourceResult } from "./types";

/** Project tab from the open session (guide S21, SPEC §9.9). */

export function withSourcePath(meta: ProjectMeta, role: SourceRole, path: string): ProjectMeta {
  const src = meta.sources[role];
  if (!src) return meta;
  return { ...meta, sources: { ...meta.sources, [role]: { ...src, path } } };
}

/**
 * Meta after a trim: rewritten clips, the trimmed video file and every linked
 * track main cut with it (mic/system/webcam paths + durations, telemetry path).
 * The webcam's `syncOffsetMs` stays: its file got the same cut as the video.
 */
export function withTrimmedSource(meta: ProjectMeta, res: TrimSourceResult): ProjectMeta {
  const sources: ProjectMeta["sources"] = {
    ...meta.sources,
    video: { ...meta.sources.video, path: res.videoPath, durationMs: res.videoDurationMs },
  };
  const linked = res.linked;
  for (const key of ["mic", "system", "webcam"] as const) {
    const src = meta.sources[key];
    const cut = linked?.[key];
    if (src && cut) sources[key] = { ...src, path: cut.path, durationMs: cut.durationMs };
  }
  const telemetry = meta.sources.telemetry;
  if (telemetry && linked?.telemetry) {
    sources.telemetry = {
      ...telemetry,
      path: linked.telemetry.path,
      hasClicks: linked.telemetry.hasClicks,
      hasKeys: linked.telemetry.hasKeys,
    };
  }
  return { ...meta, clips: res.clips, sources };
}

/** Editor-store half of a trim entry: clips, plus the rewritten telemetry's point count. */
export function trimEditorPatch(res: TrimSourceResult): EditorPatch {
  return res.linked?.telemetry
    ? { clips: res.clips, cursorPointCount: res.linked.telemetry.pointCount }
    : { clips: res.clips };
}

const isAbsolutePath = (p: string): boolean => p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);

/**
 * Re-point the session's media URLs at the files `meta` now names (trim, its
 * undo and redo swap files on disk) and, when asked, reload the telemetry so
 * the cursor layer and auto-zoom use the shifted timestamps. Absolute
 * (relinked-by-reference) sources keep their URLs.
 */
export async function syncSessionMedia(
  reloadTelemetry: boolean,
  media: Pick<ProjectMediaPort, "fetchBytes" | "decompress"> = browserMediaPort,
): Promise<void> {
  const session = useProjectSession.getState();
  const { meta, mediaBaseUrl } = session;
  if (!meta || !mediaBaseUrl) return;
  const patch: Partial<ProjectSessionData> = {};
  const urlFor = (path: string | undefined, current: string | null): string | null =>
    path === undefined ? null : isAbsolutePath(path) ? current : mediaUrl(mediaBaseUrl, path);
  patch.videoUrl = urlFor(meta.sources.video.path, session.videoUrl);
  for (const role of ["mic", "system", "webcam"] as const) {
    patch[URL_KEY[role]] = urlFor(meta.sources[role]?.path, session[URL_KEY[role]]);
  }
  session.setSession(patch);
  if (!reloadTelemetry) return;
  const path = meta.sources.telemetry?.path;
  let telemetry: ParsedTelemetry | null = null;
  if (path !== undefined && !isAbsolutePath(path)) {
    try {
      const bytes = await media.fetchBytes(mediaUrl(mediaBaseUrl, path));
      telemetry = await readTelemetryFile(bytes, { decompress: (b) => media.decompress(b) });
    } catch {
      // Unreadable telemetry disables the cursor layer, as on open (§6.6).
      telemetry = null;
    }
  }
  // A newer edit may have swapped the files again while this loaded.
  if (useProjectSession.getState().meta?.sources.telemetry?.path !== path) return;
  // bindCursorTrack rebuilds the smoothed cursor from the new telemetry.
  useProjectSession.getState().setSession({ telemetry });
}

/**
 * Undo/redo side effects for a trim history entry. Undo moves the stashed
 * original back (`restoreTrimmedSource`, which also removes the trimmed file);
 * redo trims again from the restored original and re-points meta + clips at the
 * new file. Null when the trim can't be undone on disk.
 */
export function trimHistoryEffects(
  host: Pick<InspectorHost, "trimSource" | "restoreTrimmedSource">,
  sourceClips: NonNullable<ProjectMeta["clips"]>,
  first: TrimSourceResult,
  onError: (message: string) => void,
  onDone: () => void,
): MetaUpdateEffects | null {
  const restore = host.restoreTrimmedSource;
  if (!first.undoToken || !restore) return null;
  let token: string | undefined = first.undoToken;
  let telemetryTrimmed = first.linked?.telemetry !== undefined;
  return {
    onUndo: () => {
      const t = token;
      token = undefined;
      if (!t) return;
      restore(t).then(
        () => {
          // History already rolled meta back; point the session at the restored files.
          void syncSessionMedia(telemetryTrimmed);
          onDone();
        },
        (err: unknown) =>
          onError(withDetail(ti, "inspector.project.error.restore", errorMessage(err, ""))),
      );
    },
    onRedo: () => {
      host.trimSource(sourceClips).then(
        (res) => {
          if (!res) return;
          token = res.undoToken;
          telemetryTrimmed = res.linked?.telemetry !== undefined;
          const session = useProjectSession.getState();
          if (session.meta) session.setSession({ meta: withTrimmedSource(session.meta, res) });
          useEditorStore.getState().update(trimEditorPatch(res));
          void syncSessionMedia(telemetryTrimmed);
          onDone();
        },
        (err: unknown) =>
          onError(withDetail(ti, "inspector.project.error.retrim", errorMessage(err, ""))),
      );
    },
  };
}

const URL_KEY: Readonly<
  Record<SourceRole, "videoUrl" | "micUrl" | "systemAudioUrl" | "webcamUrl">
> = {
  video: "videoUrl",
  mic: "micUrl",
  system: "systemAudioUrl",
  webcam: "webcamUrl",
};

export function ProjectTab({ host }: { host: InspectorHost }): ReactElement {
  const t = useInspectorT();
  const session = useProjectSession();
  const saveRaw = useEditorStore((s) => s.saveRawWithProject);
  const cursorPointCount = useEditorStore((s) => s.cursorPointCount);
  const storeClips = useEditorStore((s) => s.clips);
  const [stats, setStats] = useState<Record<string, SourceStat>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [statsVersion, setStatsVersion] = useState(0);

  const pathsKey = sourcePaths(session).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathsKey summarizes the source paths
  useEffect(() => {
    let live = true;
    const paths = pathsKey === "" ? [] : pathsKey.split("|");
    if (paths.length === 0) return;
    host
      .statSources(paths)
      .then((s) => live && setStats(s))
      .catch(() => live && setStats({}));
    return () => {
      live = false;
    };
  }, [host, pathsKey, statsVersion]);

  const info = useMemo(
    () => projectInfoFromSession(session, stats, cursorPointCount),
    [session, stats, cursorPointCount],
  );

  if (session.status === "loading") {
    return <EmptyState title={t("inspector.project.loading")} />;
  }
  if (!info || !session.meta) {
    return (
      <EmptyState title={t("inspector.project.none.title")}>
        {session.error ? session.error.message : t("inspector.project.none.body")}
      </EmptyState>
    );
  }

  const clips = timelineClips(storeClips, session.meta);
  const video = info.sources.find((s) => s.role === "video");
  const trimSavingsBytes = video ? computeTrimSavingsBytes(clips, video) : null;

  const relink = async (sourcePath: string) => {
    setNotice(null);
    const current = useProjectSession.getState();
    const role = roleForPath(current, sourcePath);
    const src = role ? current.meta?.sources[role] : undefined;
    if (!role || !src) return;
    try {
      const picked = await host.pickFile({
        title: t("inspector.project.relink"),
        filters: role === "mic" || role === "system" ? AUDIO_FILTERS : VIDEO_FILTERS,
      });
      if (!picked) return;
      const res = await host.relinkMedia({
        filePath: picked,
        expected:
          role === "mic" || role === "system"
            ? { durationMs: src.durationMs }
            : { durationMs: src.durationMs, width: src.width, height: src.height },
      });
      host.metaUpdate(t("inspector.project.relink"), (m) => withSourcePath(m, role, res.path));
      const patch: Parameters<typeof current.setSession>[0] = { [URL_KEY[role]]: res.url };
      if (role === "video") patch.mediaOffline = false;
      useProjectSession.getState().setSession(patch);
      setStatsVersion((v) => v + 1);
    } catch (err) {
      setNotice(withDetail(t, "inspector.project.error.relink", errorMessage(err, "")));
    }
  };

  const trim = async () => {
    setNotice(null);
    try {
      const res = await host.trimSource(clips);
      if (!res) {
        setNotice(t("inspector.project.trimUnavailable"));
        return;
      }
      // Sources live in meta, clips in the editor store: one history entry for both.
      const effects = trimHistoryEffects(host, clips, res, setNotice, () =>
        setStatsVersion((v) => v + 1),
      );
      host.metaUpdate(
        t("inspector.project.history.trim"),
        (m) => withTrimmedSource(m, res),
        trimEditorPatch(res),
        effects ?? undefined,
      );
      void syncSessionMedia(res.linked?.telemetry !== undefined);
      setStatsVersion((v) => v + 1);
    } catch (err) {
      setNotice(withDetail(t, "inspector.project.error.trim", errorMessage(err, "")));
    }
  };

  return (
    <>
      {notice && (
        <div
          role="alert"
          style={{
            margin: "var(--space-2) var(--space-3) 0",
            color: "var(--danger)",
            fontSize: "12px",
          }}
        >
          {notice}
        </div>
      )}
      <ProjectInspector
        info={info}
        onRename={(name) => {
          const trimmed = name.trim();
          if (trimmed !== "" && trimmed !== info.name)
            host.metaUpdate(t("inspector.project.history.rename"), (m) => ({
              ...m,
              name: trimmed,
            }));
        }}
        onReveal={(path) => void host.reveal(path).catch(() => {})}
        onRelink={(p) => void relink(p)}
        saveRaw={saveRaw}
        onSaveRawChange={(saveRawWithProject) =>
          host.documentUpdate(t("inspector.project.saveRaw"), { saveRawWithProject })
        }
        trimSavingsBytes={trimSavingsBytes}
        onTrim={() => void trim()}
        onDelete={(opts) => {
          setNotice(null);
          host.deleteProject(opts).catch((err: unknown) => {
            setNotice(withDetail(t, "inspector.project.error.delete", errorMessage(err, "")));
          });
        }}
      />
    </>
  );
}
