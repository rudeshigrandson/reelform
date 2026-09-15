import { type ReactElement, useState } from "react";
import { useEditorStore } from "../../store";
import { CursorInspector } from "../cursor";
import { AUDIO_FILTERS } from "./AudioTab";
import { fileNameOf } from "./audioPeaks";
import { pathForFile } from "./filePaths";
import { errorMessage } from "./hooks";
import type { InspectorHost } from "./types";

/** Cursor tab: custom arrow + custom click sound copied into the project (guide S14, SPEC §9.2 / §9.5). */

export const CURSOR_FILTERS = [{ name: "Cursor image", extensions: ["png", "svg"] }];

export function CursorTab({ host }: { host: InspectorHost }): ReactElement {
  const cursor = useEditorStore((s) => s.cursor);
  const cursorPointCount = useEditorStore((s) => s.cursorPointCount);
  const [error, setError] = useState<string | null>(null);

  const uploadCursor = async (file: File) => {
    setError(null);
    try {
      const path = await pathForFile(host, file, {
        title: "Custom cursor",
        filters: CURSOR_FILTERS,
      });
      if (!path) return;
      const media = await host.importMedia("cursor", path);
      const fileName = file.name || fileNameOf(path);
      const current = useEditorStore.getState().cursor;
      host.documentUpdate("Custom cursor", {
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
      setError(`Couldn't add the cursor. ${errorMessage(err, "")}`.trim());
    }
  };

  const uploadSound = async (file: File) => {
    setError(null);
    try {
      const path = await pathForFile(host, file, { title: "Click sound", filters: AUDIO_FILTERS });
      if (!path) return;
      const media = await host.importMedia("sound", path);
      const current = useEditorStore.getState().cursor;
      host.documentUpdate("Custom click sound", {
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
      setError(`Couldn't add the click sound. ${errorMessage(err, "")}`.trim());
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
        onChange={(next) => host.documentUpdate("Cursor", { cursor: next }, "cursor-settings")}
        cursorPointCount={cursorPointCount}
        onUploadCustomCursor={(file) => void uploadCursor(file)}
        onUploadCustomSound={(file) => void uploadSound(file)}
      />
    </>
  );
}
