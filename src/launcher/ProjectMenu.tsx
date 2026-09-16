import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";

/**
 * Small "⋯" popover menu for a launcher project card. Opens upward from the
 * trigger, focuses its first item, and supports Arrow / Home / End to move,
 * Enter / Space to pick, Escape or Tab (and outside clicks) to close; focus
 * returns to the trigger on Escape.
 */

export interface ProjectMenuItem {
  id: string;
  label: string;
  danger?: boolean | undefined;
}

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 0,
  bottom: "calc(100% + 6px)",
  zIndex: 5,
  minWidth: 180,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: 6,
  borderRadius: 16,
  background: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  boxShadow: "var(--shadow-md)",
};

const rowStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  border: "none",
  borderRadius: 10,
  outline: "none",
  font: "inherit",
  fontSize: 13,
  textAlign: "left",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

export function ProjectMenu({
  label,
  items,
  onSelect,
  triggerStyle,
}: {
  /** Accessible name of the trigger button. */
  label: string;
  items: ReadonlyArray<ProjectMenuItem>;
  onSelect: (id: string) => void;
  triggerStyle?: CSSProperties | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const last = items.length - 1;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "absolute", right: 8, bottom: 14 }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive(e.key === "ArrowUp" ? items.length - 1 : 0);
            setOpen(true);
          }
        }}
        style={{
          padding: "2px 6px",
          border: "none",
          borderRadius: 8,
          background: open ? "var(--accent-soft)" : "transparent",
          color: open ? "var(--accent-hover)" : "var(--text-3)",
          font: "inherit",
          cursor: "pointer",
          ...triggerStyle,
        }}
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" aria-label={label} onKeyDown={onMenuKey} style={panelStyle}>
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                close(false);
                onSelect(item.id);
              }}
              style={{
                ...rowStyle,
                background: i === active ? "var(--accent-soft)" : "transparent",
                color: item.danger
                  ? "var(--danger)"
                  : i === active
                    ? "var(--accent-hover)"
                    : "var(--text-1)",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
