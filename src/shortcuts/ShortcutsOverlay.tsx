import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalShortcutsContext, useShortcut } from "./ShortcutsProvider";
import type { ShortcutPlatform } from "./accelerator";
import { filterShortcuts, groupShortcuts } from "./recorder";
import { type ResolvedShortcut, type ShortcutOverrides, resolveShortcuts } from "./registry";

/**
 * S25 — "?" keyboard shortcuts overlay: full-window glass sheet, shortcuts in
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

export const kbdStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  padding: "1px var(--space-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-xs)",
  color: "var(--text-1)",
  background: "var(--bg-sunken)",
  whiteSpace: "nowrap",
};

export function ShortcutsOverlay({
  open,
  onClose,
  resolved: resolvedProp,
  platform = "mac",
  overrides,
  onCustomize,
}: ShortcutsOverlayProps) {
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

  const groups = useMemo(() => groupShortcuts(filterShortcuts(resolved, query)), [resolved, query]);

  if (!open) return null;

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Keyboard shortcuts"
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
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        padding: "var(--space-8)",
        background: "color-mix(in srgb, var(--bg-app) 82%, transparent)",
        backdropFilter: "blur(18px)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "1.3rem", margin: 0, flex: 1 }}>
          Keyboard shortcuts
        </h2>
        <input
          ref={searchRef}
          className="input"
          type="search"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: "280px" }}
        />
        {onCustomize ? (
          <button type="button" className="btn btn-ghost" onClick={onCustomize}>
            Customize…
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>

      {groups.length === 0 ? (
        <p style={{ color: "var(--text-3)" }}>No shortcuts match “{query}”.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "var(--space-6)",
            alignItems: "start",
          }}
        >
          {groups.map(({ group, rows }) => (
            <section key={group} aria-label={group}>
              <h3
                style={{
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-3)",
                  margin: "0 0 var(--space-2)",
                }}
              >
                {group}
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {rows.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "var(--space-3)",
                      padding: "var(--space-1) 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span>{r.def.label}</span>
                    {r.display ? (
                      <kbd style={kbdStyle}>{r.display}</kbd>
                    ) : (
                      <span style={{ color: "var(--text-3)", fontSize: "0.8rem" }}>Unassigned</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
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
