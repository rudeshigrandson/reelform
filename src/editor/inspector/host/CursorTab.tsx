import { type ReactElement, useState } from "react";
import { useEditorStore } from "../../store";
import { setClickVolume } from "../audio";
import { CursorInspector } from "../cursor";
import { useInspectorT, withDetail } from "../i18n";
import { AUDIO_FILTERS } from "./AudioTab";
import { fileNameOf } from "./audioPeaks";
import { pathForFile } from "./filePaths";
import { errorMessage } from "./hooks";
import type { InspectorHost } from "./types";

/** Cursor tab: custom arrow + custom click sound copied into the project (guide S14, SPEC §9.2 / §9.5). */

export const CURSOR_FILTERS = [{ name: "Cursor image", extensions: ["png", "svg"] }];

export function CursorTab({ host }: { host: InspectorHost }): ReactElement {
  const t = useInspectorT();
  const cursor = useEditorStore((s) => s.cursor);
  const cursorPointCount = useEditorStore((s) => s.cursorPointCount);
  const [error, setError] = useState<string | null>(null);

  const uploadCursor = async (file: File) => {
    setError(null);
    try {
      const path = await pathForFile(host, file, {
        title: t("inspector.cursor.customCursor"),
        filters: CURSOR_FILTERS,
      });
      if (!path) return;
      const media = await host.importMedia("cursor", path);
      const fileName = file.name || fileNameOf(path);
      const current = useEditorStore.getState().cursor;
      host.documentUpdate(t("inspector.cursor.customCursor"), {
        cursor: {
          ...current,
          style: "custom",
          customCursor: {
            fileName,
            path: media.path,
            kind: /\.svg$/i.test(fileName) || /\.svg$/i.test(path) ? "svg" : "png",
          },
        },
      });
    } catch (err) {
      setError(withDetail(t, "inspector.cursor.error.add", errorMessage(err, "")));
    }
  };

  const uploadSound = async (file: File) => {
    setError(null);
    try {
      const path = await pathForFile(host, file, {
        title: t("inspector.cursor.clickSound"),
        filters: AUDIO_FILTERS,
      });
      if (!path) return;
      const media = await host.importMedia("sound", path);
      const current = useEditorStore.getState().cursor;
      host.documentUpdate(t("inspector.cursor.history.customSound"), {
        cursor: {
          ...current,
          clickSound: {
            ...current.clickSound,
            type: "custom",
            customSound: { fileName: file.name || fileNameOf(path), path: media.path },
          },
        },
      });
    } catch (err) {
      setError(withDetail(t, "inspector.cursor.error.addSound", errorMessage(err, "")));
    }
  };

  return (
    <>
      {error && (
        <div
          role="alert"
          style={{
            margin: "var(--space-2) var(--space-3) 0",
            color: "var(--danger)",
            fontSize: "12px",
          }}
        >
          {error}
        </div>
      )}
      <CursorInspector
        value={cursor}
        onChange={(next) => {
          // The Audio tab's "Clicks" slider mirrors the click sound volume (one undo entry).
          // `audio` is always in the patch (same reference when unchanged): a coalesced
          // entry undoes with its first patch's keys and redoes with its last, so the
          // key set must not vary within a drag or the two volumes drift apart.
          const { cursor: current, audio } = useEditorStore.getState();
          host.documentUpdate(
            t("inspector.cursor.history.settings"),
            {
              cursor: next,
              audio:
                next.clickSound.volume === current.clickSound.volume
                  ? audio
                  : setClickVolume(audio, next.clickSound.volume),
            },
            "cursor-settings",
          );
        }}
        cursorPointCount={cursorPointCount}
        onUploadCustomCursor={(file) => void uploadCursor(file)}
        onUploadCustomSound={(file) => void uploadSound(file)}
      />
    </>
  );
}
