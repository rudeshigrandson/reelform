import { Button, Input } from "@design/components";
import { type CSSProperties, useMemo, useState } from "react";
import { launcherT, useLauncherT } from "./i18n";
import type { PickerSource } from "./types";

/**
 * S06 — Source picker (720×420). Displays | Windows tabs over live thumbnails
 * (the host refreshes `sources` every 2 s while open), window search grouped by
 * app, minimized windows dimmed, "Exclude Reelform windows" on by default,
 * Cancel / Select. Shared by the launcher ("Browse…") and the HUD source chip.
 */

export type PickerTab = "displays" | "windows";

export interface SourcePickerProps {
  sources: ReadonlyArray<PickerSource>;
  status?: "loading" | "ready" | "error" | undefined;
  error?: string | undefined;
  /** Currently chosen source; also decides the initial tab. */
  selectedId?: string | null | undefined;
  initialTab?: PickerTab | undefined;
  /** App name of our own windows, hidden while "Exclude Reelform windows" is on. */
  ownAppName?: string | undefined;
  onSelect: (source: PickerSource) => void;
  onCancel: () => void;
}

export const PICKER_SIZE = { width: 720, height: 420 } as const;

/** Our own windows: by app name, or by the bare window title when the backend reports none. */
export function isOwnWindow(source: PickerSource, ownAppName: string): boolean {
  if (source.kind !== "window") return false;
  const own = ownAppName.trim().toLowerCase();
  if (source.appName) return source.appName.trim().toLowerCase() === own;
  return source.title.trim().toLowerCase() === own;
}

export function matchesQuery(source: PickerSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return source.title.toLowerCase().includes(q) || (source.appName ?? "").toLowerCase().includes(q);
}

export interface WindowGroup {
  app: string;
  icon: string | undefined;
  windows: PickerSource[];
}

/**
 * Windows grouped by app, groups in order of first appearance. Windows without
 * an app name go under `otherLabel` (the localized "Other windows").
 */
export function groupWindowsByApp(
  windows: ReadonlyArray<PickerSource>,
  otherLabel: string = launcherT("launcher.picker.otherWindows"),
): WindowGroup[] {
  const groups = new Map<string, WindowGroup>();
  for (const w of windows) {
    const app = w.appName?.trim() || otherLabel;
    const g = groups.get(app) ?? { app, icon: undefined, windows: [] };
    g.icon ??= w.appIcon;
    g.windows.push(w);
    groups.set(app, g);
  }
  return [...groups.values()];
}

const frameStyle: CSSProperties = {
  // Inline, non-modal <dialog>: reset the UA positioning and inset.
  position: "static",
  inset: "auto",
  margin: 0,
  width: PICKER_SIZE.width,
  height: PICKER_SIZE.height,
  maxWidth: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  padding: "var(--space-4)",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, 200px)",
  gap: "var(--space-3)",
};

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      style={{
        border: "none",
        background: selected ? "var(--bg-active)" : "transparent",
        color: selected ? "var(--text-1)" : "var(--text-2)",
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-1) var(--space-3)",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Tile({
  source,
  selected,
  onPick,
}: {
  source: PickerSource;
  selected: boolean;
  onPick: () => void;
}) {
  const t = useLauncherT();
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={source.kind === "window" ? source.title : source.name}
      data-testid={`picker-source-${source.id}`}
      data-minimized={source.minimized || undefined}
      onClick={onPick}
      style={{
        width: 200,
        padding: 0,
        border: "none",
        background: "transparent",
        color: "inherit",
        font: "inherit",
        textAlign: "left",
        cursor: "pointer",
        opacity: source.minimized ? 0.5 : 1,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "relative",
          width: 200,
          aspectRatio: "16 / 9",
          boxSizing: "border-box",
          borderRadius: "var(--radius-md)",
          border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
          background: source.thumbnailUrl
            ? `center / cover no-repeat url(${source.thumbnailUrl})`
            : "var(--bg-sunken)",
        }}
      >
        {source.minimized ? (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              color: "var(--text-2)",
            }}
          >
            {t("launcher.picker.minimized")}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: "var(--space-1)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {source.kind === "window" ? source.title : source.name}
      </div>
      {source.width > 0 && source.height > 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
          {source.width}×{source.height}
        </div>
      ) : null}
    </button>
  );
}

function Placeholder({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "grid",
        placeItems: "center",
        height: "100%",
        color: "var(--text-2)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

export function SourcePicker({
  sources,
  status = "ready",
  error,
  selectedId = null,
  initialTab,
  ownAppName = "Reelform",
  onSelect,
  onCancel,
}: SourcePickerProps) {
  const t = useLauncherT();
  const initialKind = sources.find((s) => s.id === selectedId)?.kind;
  const [tab, setTab] = useState<PickerTab>(
    initialTab ?? (initialKind === "window" ? "windows" : "displays"),
  );
  const [query, setQuery] = useState("");
  const [excludeOwn, setExcludeOwn] = useState(true);
  const [pick, setPick] = useState<string | null>(selectedId);

  const displays = useMemo(() => sources.filter((s) => s.kind === "display"), [sources]);
  const allWindows = useMemo(
    () => sources.filter((s) => s.kind === "window" && !(excludeOwn && isOwnWindow(s, ownAppName))),
    [sources, excludeOwn, ownAppName],
  );
  const windows = useMemo(
    () => allWindows.filter((w) => matchesQuery(w, query)),
    [allWindows, query],
  );
  const visible = tab === "displays" ? displays : windows;
  const picked = visible.find((s) => s.id === pick) ?? null;

  let body: React.ReactNode;
  if (status === "loading" && sources.length === 0) {
    body = (
      <Placeholder testId="picker-loading">
        <output>{t("launcher.sources.loading")}</output>
      </Placeholder>
    );
  } else if (status === "error") {
    body = (
      <Placeholder testId="picker-error">
        <span role="alert">{error ?? t("launcher.sources.error")}</span>
      </Placeholder>
    );
  } else if (tab === "displays") {
    body =
      displays.length === 0 ? (
        <Placeholder testId="picker-empty">{t("launcher.sources.noDisplays")}</Placeholder>
      ) : (
        <section aria-label={t("launcher.picker.displays")} style={gridStyle}>
          {displays.map((d) => (
            <Tile key={d.id} source={d} selected={d.id === pick} onPick={() => setPick(d.id)} />
          ))}
        </section>
      );
  } else if (allWindows.length === 0) {
    body = <Placeholder testId="picker-no-windows">{t("launcher.sources.noWindows")}</Placeholder>;
  } else if (windows.length === 0) {
    body = (
      <Placeholder testId="picker-no-results">
        {t("launcher.picker.noResults", { query: query.trim() })}
      </Placeholder>
    );
  } else {
    body = (
      <div data-testid="picker-windows">
        {groupWindowsByApp(windows, t("launcher.picker.otherWindows")).map((g) => (
          <section
            key={g.app}
            aria-label={g.app}
            data-testid="picker-group"
            style={{ marginBottom: "var(--space-3)" }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-2)",
                color: "var(--text-2)",
                fontFamily: "var(--font-heading)",
              }}
            >
              {g.icon ? (
                <img src={g.icon} alt="" width={16} height={16} style={{ borderRadius: 3 }} />
              ) : null}
              {g.app}
            </header>
            <div style={gridStyle}>
              {g.windows.map((w) => (
                <Tile key={w.id} source={w} selected={w.id === pick} onPick={() => setPick(w.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <dialog
      open
      aria-label={t("launcher.picker.label")}
      data-testid="source-picker"
      style={frameStyle}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <div
          role="tablist"
          aria-label={t("launcher.picker.sourceType")}
          style={{ display: "flex", gap: 2 }}
        >
          <TabButton selected={tab === "displays"} onClick={() => setTab("displays")}>
            {t("launcher.picker.displays")}
          </TabButton>
          <TabButton selected={tab === "windows"} onClick={() => setTab("windows")}>
            {t("launcher.picker.windows")}
          </TabButton>
        </div>
        {tab === "windows" ? (
          <Input
            type="search"
            aria-label={t("launcher.picker.search")}
            placeholder={t("launcher.picker.search")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <span style={{ flex: 1 }} />
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{body}</div>

      <footer style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            color: "var(--text-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={excludeOwn}
            onChange={(e) => setExcludeOwn(e.currentTarget.checked)}
          />
          {t("launcher.picker.excludeOwn", { app: ownAppName })}
        </label>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!picked}
          onClick={() => {
            if (picked) onSelect(picked);
          }}
        >
          {t("launcher.picker.select")}
        </Button>
      </footer>
    </dialog>
  );
}
