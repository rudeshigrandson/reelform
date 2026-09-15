import { FRAME_USER_PRESETS_MAX } from "@contracts";
import { Button, Dialog, Input } from "@design/components";
import {
  type FetchLike,
  type WallpaperPack,
  loadWallpaperPack,
  wallpaperToCss,
} from "@design/wallpapers";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useProjectSession } from "../../../app/project/session";
import { useAppSettings } from "../../../app/settings/store";
import type { SettingsKey, SettingsPatch, SettingsState } from "../../../settings/types";
import { useEditorStore } from "../../store";
import { FrameInspector } from "../frame";
import { type FramePreset, type Wallpaper, frameSettingsSchema } from "../frame/types";
import { pathForFile } from "./filePaths";
import { type InspectorMessageKey, useInspectorT, withDetail } from "../i18n";
import { errorMessage, hostId } from "./hooks";
import type { InspectorHost } from "./types";

/**
 * Frame tab: the bundled wallpaper catalogue, background images copied into
 * the project, and user presets kept in app settings (guide S13, SPEC §9.1).
 */

export const IMAGE_FILTERS = [
  { name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
];

/** App-settings key holding the user's saved frame presets. */
export const USER_PRESETS_SETTINGS_KEY = "frameUserPresets" satisfies SettingsKey;

/** Strict renderer-side check; main stores `settings` loosely (see electron/settings/schema.ts). */
const userPresetsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    builtIn: z.boolean(),
    settings: frameSettingsSchema,
  }),
);

/** Saved presets from app settings (or a settings patch); anything malformed is ignored. */
export function readUserPresets(
  settings: Partial<SettingsState> | null | undefined,
): FramePreset[] {
  if (typeof settings !== "object" || settings === null) return [];
  const raw = settings[USER_PRESETS_SETTINGS_KEY];
  const parsed = userPresetsSchema.safeParse(raw);
  return parsed.success ? parsed.data.map((p) => ({ ...p, builtIn: false })) : [];
}

/** Wallpaper tiles with real CSS previews from a validated pack. */
export function wallpapersFromPack(pack: WallpaperPack): Wallpaper[] {
  return pack.wallpapers.map((w) => ({
    id: w.id,
    name: w.name,
    category: w.category,
    preview: wallpaperToCss(w),
  }));
}

const fetchJson: FetchLike = (url) => {
  if (typeof fetch === "undefined") return Promise.reject(new Error("fetch unavailable"));
  return fetch(url);
};

let catalogue: Promise<Wallpaper[] | null> | null = null;

/** Bundled catalogue, loaded once per window; null when it can't be read. */
export function loadWallpaperCatalogue(
  fetchImpl: FetchLike = fetchJson,
): Promise<Wallpaper[] | null> {
  catalogue ??= loadWallpaperPack(fetchImpl).then((r) => {
    if (r.ok) return wallpapersFromPack(r.pack);
    catalogue = null; // allow a retry next time the tab mounts
    return null;
  });
  return catalogue;
}

export interface FrameTabProps {
  host: InspectorHost;
  /** Wallpaper catalogue loader (tests inject one). */
  loadWallpapers?: (() => Promise<Wallpaper[] | null>) | undefined;
}

export function FrameTab({
  host,
  loadWallpapers = loadWallpaperCatalogue,
}: FrameTabProps): ReactElement {
  const t = useInspectorT();
  const frame = useEditorStore((s) => s.frame);
  const sourceSize = useProjectSession((s) => s.sourceSize);
  const settings = useAppSettings((s) => s.settings);
  const [wallpapers, setWallpapers] = useState<Wallpaper[] | null>(null);
  const [localPresets, setLocalPresets] = useState<FramePreset[] | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadWallpapers().then(
      (list) => live && setWallpapers(list),
      () => live && setWallpapers(null),
    );
    return () => {
      live = false;
    };
  }, [loadWallpapers]);

  const storedPresets = useMemo(() => readUserPresets(settings), [settings]);
  // Settings win once they carry the key; until then this window keeps its own list.
  const userPresets = storedPresets.length > 0 ? storedPresets : (localPresets ?? []);

  const applyImage = async (file: File | null, labelKey: InspectorMessageKey) => {
    setError(null);
    const label = t(labelKey);
    try {
      const path = await pathForFile(host, file, { title: label, filters: IMAGE_FILTERS });
      if (!path) return;
      const media = await host.importMedia("image", path);
      const current = useEditorStore.getState().frame;
      host.documentUpdate(label, {
        frame: {
          ...current,
          background: {
            ...current.background,
            kind: "image",
            image: { ...current.background.image, path: media.path },
          },
        },
      });
    } catch (err) {
      setError(withDetail(t, "inspector.frame.error.image", errorMessage(err, "")));
    }
  };

  const savePreset = () => {
    const name = (naming ?? "").trim();
    if (name === "") return;
    const preset: FramePreset = {
      id: hostId("frame-preset"),
      name,
      builtIn: false,
      settings: structuredClone(useEditorStore.getState().frame),
    };
    // Main caps the list; keep the newest so saving never gets rejected.
    const next = [...userPresets, preset].slice(-FRAME_USER_PRESETS_MAX);
    setLocalPresets(next);
    setNaming(null);
    const patch: SettingsPatch = { [USER_PRESETS_SETTINGS_KEY]: next };
    void useAppSettings.getState().patch(patch);
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
      <FrameInspector
        value={frame}
        onChange={(next) =>
          host.documentUpdate(
            t("inspector.frame.history.settings"),
            { frame: next },
            "frame-settings",
          )
        }
        wallpapers={wallpapers ?? undefined}
        userPresets={userPresets}
        sourceSize={sourceSize}
        onSavePreset={() => setNaming("")}
        onAddCustomWallpaper={() => void applyImage(null, "inspector.frame.customWallpaper")}
        onImageSelect={(file) => void applyImage(file, "inspector.frame.backgroundImage")}
      />
      <Dialog
        open={naming !== null}
        onClose={() => setNaming(null)}
        title={t("inspector.frame.savePresetDialog.title")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              {t("inspector.common.cancel")}
            </Button>
            <Button variant="primary" disabled={(naming ?? "").trim() === ""} onClick={savePreset}>
              {t("inspector.frame.savePresetDialog.save")}
            </Button>
          </>
        }
      >
        <Input
          label={t("inspector.frame.savePresetDialog.name")}
          autoFocus
          value={naming ?? ""}
          maxLength={40}
          onChange={(e) => setNaming(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") savePreset();
          }}
        />
      </Dialog>
    </>
  );
}
