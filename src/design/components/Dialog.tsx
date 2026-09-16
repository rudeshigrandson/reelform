import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** Footer actions (buttons). */
  actions?: ReactNode;
  /** Border tint: "danger" for destructive confirms, "success" for recovery notices. */
  tone?: "default" | "danger" | "success" | undefined;
  /** Panel width in px (default 380, the S27 dialog). Wider for crop / waveform dialogs. */
  width?: number | undefined;
  /** When set, a quiet ✕ button with this accessible name sits right of the title. */
  closeLabel?: string | undefined;
  /** Move focus to the panel itself on open (for dialogs with no natural first field). */
  focusPanelOnOpen?: boolean | undefined;
}

/** Modal dialog. Escape and backdrop click both call onClose. The title names the dialog. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  tone = "default",
  width,
  closeLabel,
  focusPanelOnOpen = false,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (focusPanelOnOpen) panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, focusPanelOnOpen]);

  if (!open) return null;

  const className = tone === "default" ? "dialog" : `dialog dialog-${tone}`;
  const titleEl = title ? (
    <div className="dialog-title" id={titleId}>
      {title}
    </div>
  ) : null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop handles keys; stopPropagation keeps clicks inside the panel from closing */}
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={focusPanelOnOpen ? -1 : undefined}
        style={{
          ...(width === undefined ? {} : { width: `min(${width}px, 100%)` }),
          ...(focusPanelOnOpen ? { outline: "none" } : {}),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {closeLabel ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {titleEl ?? <span />}
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              style={{
                appearance: "none",
                background: "transparent",
                border: 0,
                padding: "2px 4px",
                color: "var(--text-3)",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          titleEl
        )}
        <div className="dialog-body">{children}</div>
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
