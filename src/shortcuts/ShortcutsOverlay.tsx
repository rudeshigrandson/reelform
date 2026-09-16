import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalShortcutsContext, useShortcut } from "./ShortcutsProvider";
import type { ShortcutPlatform } from "./accelerator";
import { shortcutGroupLabel, shortcutLabel, useShortcutsT } from "./i18n";
import { filterShortcuts, groupShortcuts } from "./recorder";
import { type ResolvedShortcut, type ShortcutOverrides, resolveShortcuts } from "./registry";

/**
 * S25 — "?" keyboard shortcuts overlay: centred glass sheet, shortcuts in
 * three grouped columns, search, "Customize…" link to Settings › Shortcuts.
 */

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Defaults to the nearest provider's resolved table, else registry defaults. */
  resolved?: readonly ResolvedShortcut[] | undefined;
  platform?: ShortcutPlatform | undefined;
  overrides?: ShortcutOverrides | undefined;
  onCustomize?: (() => void) | undefined;
}

/** Component-sheet keycap: hairline box, 4px radius, 11px mono. */
export const kbdStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  padding: "4px 10px",
  border: "1px solid var(--border-strong)",
  borderRadius: "4px",
  color: "var(--text-1)",
  whiteSpace: "nowrap",
};

const sheetStyle: CSSProperties = {
  width: "min(900px, 100%)",
  maxHeight: "100%",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
  padding: "26px 28px",
  borderRadius: "16px",
  background: "color-mix(in srgb, var(--bg-app) 86%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  boxShadow: "var(--shadow-lg)",
};

const searchStyle: CSSProperties = {
  width: "200px",
  height: "32px",
  padding: "0 12px",
  borderRadius: "999px",
  background: "color-mix(in srgb, var(--bg-sunken) 60%, transparent)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
  font: "inherit",
  fontSize: "11px",
};

const linkStyle: CSSProperties = {
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  fontSize: "12px",
  cursor: "pointer",
};

const groupLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

export function ShortcutsOverlay({
  open,
  onClose,
  resolved: resolvedProp,
  platform = "mac",
  overrides,
  onCustomize,
}: ShortcutsOverlayProps) {
  const st = useShortcutsT();
  const ctx = useOptionalShortcutsContext();
  const resolved = useMemo(
    () => resolvedProp ?? ctx?.resolved ?? resolveShortcuts(platform, overrides ?? {}),
    [resolvedProp, ctx?.resolved, platform, overrides],
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  const groups = useMemo(
    () => groupShortcuts(filterShortcuts(resolved, query, st)),
    [resolved, query, st],
  );

  if (!open) return null;

  return (
    <dialog
      open
      aria-modal="true"
      aria-label={st("shortcuts.overlay.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        maxWidth: "none",
        maxHeight: "none",
        margin: 0,
        border: "none",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: "var(--space-6)",
        background: "color-mix(in srgb, var(--bg-sunken) 30%, transparent)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={sheetStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <h2
            style={{
              flex: 1,
              margin: 0,
              fontFamily: "var(--font-heading)",
              fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
              fontSize: "22px",
            }}
          >
            {st("shortcuts.overlay.title")}
          </h2>
          <input
            ref={searchRef}
            type="search"
            aria-label={st("shortcuts.overlay.search")}
            placeholder={`⌕ ${st("shortcuts.overlay.search")}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={searchStyle}
          />
          {onCustomize ? (
            <button
              type="button"
              onClick={onCustomize}
              style={{ ...linkStyle, color: "var(--accent-hover)" }}
            >
              {st("shortcuts.overlay.customize")}
            </button>
          ) : null}
          <button type="button" onClick={onClose} style={{ ...linkStyle, color: "var(--text-2)" }}>
            {st("shortcuts.overlay.close")}
          </button>
        </div>

        {groups.length === 0 ? (
          <p style={{ margin: 0, fontSize: "12px", color: "var(--text-3)" }}>
            {st("shortcuts.overlay.noMatch", { query })}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "24px",
              alignItems: "start",
              fontSize: "12px",
            }}
          >
            {groups.map(({ group, rows }) => (
              <section
                key={group}
                aria-label={shortcutGroupLabel(group, st)}
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <h3 style={groupLabelStyle}>{shortcutGroupLabel(group, st)}</h3>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}
                    >
                      <span style={{ color: "var(--text-2)" }}>{shortcutLabel(r.def, st)}</span>
                      {r.display ? (
                        <kbd
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-1)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.display}
                        </kbd>
                      ) : (
                        <span style={{ color: "var(--text-3)" }}>
                          {st("shortcuts.overlay.unassigned")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}

/**
 * Binds `editor.shortcutsHelp` ("?") inside a {@link ShortcutsProvider} and
 * renders the overlay. Mount once per editor window.
 */
export function ShortcutsOverlayHost({
  onCustomize,
}: {
  onCustomize?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useShortcut("editor.shortcutsHelp", () => {
    setOpen((v) => !v);
    return true;
  });
  return (
    <ShortcutsOverlay
      open={open}
      onClose={close}
      onCustomize={
        onCustomize
          ? () => {
              setOpen(false);
              onCustomize();
            }
          : undefined
      }
    />
  );
}
