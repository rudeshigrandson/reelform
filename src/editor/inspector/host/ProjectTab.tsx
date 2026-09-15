import { type ReactElement, useEffect, useMemo, useState } from "react";
import { useProjectSession } from "../../../app/project/session";
import type { ProjectMeta } from "../../persistence";
import { useEditorStore } from "../../store";
import { EmptyState } from "../controls";
import { ProjectInspector } from "../project";
import { computeTrimSavingsBytes } from "../project/logic";
import type { SourceStat } from "../project/types";
import { AUDIO_FILTERS } from "./AudioTab";
import { VIDEO_FILTERS } from "./WebcamTab";
import { errorMessage } from "./hooks";
import { type SourceRole, projectInfoFromSession, roleForPath, sourcePaths } from "./projectInfo";
import { timelineClips } from "./timeMap";
import type { InspectorHost, MetaUpdateEffects, TrimSourceResult } from "./types";

/** Project tab from the open session (guide S21, SPEC §9.9). */

export function withSourcePath(meta: ProjectMeta, role: SourceRole, path: string): ProjectMeta {
  const src = meta.sources[role];
  if (!src) return meta;
  return { ...meta, sources: { ...meta.sources, [role]: { ...src, path } } };
}

/** Meta after a trim: rewritten clips and the trimmed video file. */
export function withTrimmedSource(meta: ProjectMeta, res: TrimSourceResult): ProjectMeta {
  return {
    ...meta,
    clips: res.clips,
    sources: {
      ...meta.sources,
      video: { ...meta.sources.video, path: res.videoPath, durationMs: res.videoDurationMs },
    },
  };
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
  return {
    onUndo: () => {
      const t = token;
      token = undefined;
      if (!t) return;
      restore(t).then(onDone, (err: unknown) =>
        onError(`Couldn't restore the original recording. ${errorMessage(err, "")}`.trim()),
      );
    },
    onRedo: () => {
      host.trimSource(sourceClips).then(
        (res) => {
          if (!res) return;
          token = res.undoToken;
          const session = useProjectSession.getState();
          if (session.meta) session.setSession({ meta: withTrimmedSource(session.meta, res) });
          useEditorStore.getState().update({ clips: res.clips });
          onDone();
        },
        (err: unknown) =>
          onError(`Couldn't trim the source again. ${errorMessage(err, "")}`.trim()),
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
    return <EmptyState title="Loading project…" />;
  }
  if (!info || !session.meta) {
    return (
      <EmptyState title="No project open">
        {session.error ? session.error.message : "Open or record a project to see its details."}
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
        title: "Relink media",
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
      host.metaUpdate("Relink media", (m) => withSourcePath(m, role, res.path));
      const patch: Parameters<typeof current.setSession>[0] = { [URL_KEY[role]]: res.url };
      if (role === "video") patch.mediaOffline = false;
      useProjectSession.getState().setSession(patch);
      setStatsVersion((v) => v + 1);
    } catch (err) {
      setNotice(`Couldn't relink. ${errorMessage(err, "")}`.trim());
    }
  };

  const trim = async () => {
    setNotice(null);
    try {
      const res = await host.trimSource(clips);
      if (!res) {
        setNotice("Trimming isn't available on this device.");
        return;
      }
      // Sources live in meta, clips in the editor store: one history entry for both.
      const effects = trimHistoryEffects(host, clips, res, setNotice, () =>
        setStatsVersion((v) => v + 1),
      );
      host.metaUpdate(
        "Trim source",
        (m) => withTrimmedSource(m, res),
        { clips: res.clips },
        effects ?? undefined,
      );
      setStatsVersion((v) => v + 1);
    } catch (err) {
      setNotice(`Couldn't trim the source. ${errorMessage(err, "")}`.trim());
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
            host.metaUpdate("Rename project", (m) => ({ ...m, name: trimmed }));
        }}
        onReveal={(path) => void host.reveal(path).catch(() => {})}
        onRelink={(p) => void relink(p)}
        saveRaw={saveRaw}
        onSaveRawChange={(saveRawWithProject) =>
          host.documentUpdate("Save raw with project", { saveRawWithProject })
        }
        trimSavingsBytes={trimSavingsBytes}
        onTrim={() => void trim()}
        onDelete={(opts) => {
          setNotice(null);
          host.deleteProject(opts).catch((err: unknown) => {
            setNotice(`Couldn't delete the project. ${errorMessage(err, "")}`.trim());
          });
        }}
      />
    </>
  );
}
