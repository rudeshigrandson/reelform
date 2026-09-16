import { type CSSProperties, useState } from "react";
import { ProjectMenu, type ProjectMenuItem } from "./ProjectMenu";
import { type LauncherKey, type LauncherTranslate, useLauncherT } from "./i18n";
import type { LauncherProject, LauncherProjectAction } from "./types";

export type ShelfView = "recent" | "all" | "trash";

/** How many projects the Recent view shows. */
export const RECENT_LIMIT = 6;

const THUMBS: ReadonlyArray<{ gradient: string; screen: string }> = [
  {
    gradient: "linear-gradient(140deg, var(--color-accent-2-500), var(--color-accent-2-700))",
    screen: "var(--color-neutral-100)",
  },
  {
    gradient: "linear-gradient(140deg, var(--color-accent-500), var(--color-accent-800))",
    screen: "var(--bg-sunken)",
  },
  {
    gradient: "linear-gradient(140deg, var(--color-neutral-500), var(--color-neutral-800))",
    screen: "var(--color-neutral-200)",
  },
  {
    gradient: "linear-gradient(140deg, var(--color-accent-2-400), var(--color-accent-500))",
    screen: "var(--color-neutral-100)",
  },
];

function thumbFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h + ch.charCodeAt(0)) % THUMBS.length;
  return THUMBS[h] as (typeof THUMBS)[number];
}

/** `00:42.180` — minutes, seconds, milliseconds. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function formatEdited(iso: string, now: number, t: LauncherTranslate): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return t("launcher.shelf.edited.justNow");
  if (min < 60) return t("launcher.shelf.edited.minutes", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("launcher.shelf.edited.hours", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t("launcher.shelf.edited.days", { count: day });
  return t("launcher.shelf.edited.weeks", { count: Math.floor(day / 7) });
}

export function byModifiedDesc(list: ReadonlyArray<LauncherProject>): LauncherProject[] {
  return [...list].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 19,
  margin: 0,
  fontWeight: "normal",
};

const noteStyle: CSSProperties = {
  gridColumn: "1 / -1",
  padding: "var(--space-5)",
  borderRadius: 16,
  background: "var(--bg-sunken)",
  color: "var(--text-2)",
  fontSize: 13,
  textAlign: "center",
};

const REVEAL_KEY: Record<"darwin" | "win32" | "linux", LauncherKey> = {
  darwin: "launcher.menu.revealFinder",
  win32: "launcher.menu.revealExplorer",
  linux: "launcher.menu.revealFolder",
};

/** Card menu items for a view: Trash offers restore / delete forever. */
export function projectMenuItems(
  view: ShelfView,
  t: LauncherTranslate,
  opts: { canReveal?: boolean | undefined; platform?: keyof typeof REVEAL_KEY | undefined } = {},
): ProjectMenuItem[] {
  if (view === "trash") {
    return [
      { id: "restore", label: t("launcher.menu.restore") },
      { id: "deleteForever", label: t("launcher.menu.deleteForever"), danger: true },
    ];
  }
  return [
    { id: "rename", label: t("launcher.menu.rename") },
    { id: "duplicate", label: t("launcher.menu.duplicate") },
    ...(opts.canReveal ? [{ id: "reveal", label: t(REVEAL_KEY[opts.platform ?? "linux"]) }] : []),
    { id: "trash", label: t("launcher.menu.trash"), danger: true },
  ];
}

function ProjectCard({
  project,
  now,
  onOpen,
  menuItems,
  onMenu,
}: {
  project: LauncherProject;
  now: number;
  onOpen?: ((id: string) => void) | undefined;
  menuItems: ReadonlyArray<ProjectMenuItem>;
  onMenu?: ((id: string, action: LauncherProjectAction) => void) | undefined;
}) {
  const t = useLauncherT();
  const thumb = thumbFor(project.id);
  const open = onOpen ? () => onOpen(project.id) : undefined;
  return (
    <li
      data-testid={`launcher-project-${project.id}`}
      style={{
        position: "relative",
        borderRadius: 16,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
      }}
    >
      <button
        type="button"
        onClick={open}
        disabled={!open}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          border: "none",
          // The card itself can't clip: the ⋯ menu pops out of it.
          borderRadius: 16,
          overflow: "hidden",
          background: "transparent",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: open ? "pointer" : "default",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            height: 96,
            background: thumb.gradient,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            data-testid="launcher-project-thumbnail"
            style={{
              width: "76%",
              height: "66%",
              borderRadius: 8,
              ...(project.thumbnailUrl
                ? {
                    backgroundImage: `url("${project.thumbnailUrl}")`,
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                    backgroundRepeat: "no-repeat",
                  }
                : { background: thumb.screen }),
              boxShadow: "var(--shadow-md)",
            }}
          />
          <span
            data-testid="launcher-project-duration"
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              padding: "3px 8px",
              borderRadius: "var(--radius-full)",
              background: "color-mix(in srgb, var(--bg-sunken) 72%, transparent)",
              color: "var(--text-1)",
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTimecode(project.durationMs)}
          </span>
        </div>
        <div style={{ padding: onMenu ? "10px 36px 10px 12px" : "10px 12px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {project.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {formatEdited(project.modifiedAt, now, t)}
          </div>
        </div>
      </button>
      {onMenu && menuItems.length > 0 ? (
        <ProjectMenu
          label={t("launcher.shelf.more", { name: project.name })}
          items={menuItems}
          onSelect={(id) => onMenu(project.id, id as LauncherProjectAction)}
        />
      ) : null}
    </li>
  );
}

/** S04/02 — nothing recorded yet. */
export function ShelfEmpty({
  onRecord,
  disabled,
}: {
  onRecord: () => void;
  disabled: boolean;
}) {
  const t = useLauncherT();
  return (
    <div
      data-testid="launcher-shelf-empty"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        textAlign: "center",
        padding: "0 48px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 96,
          height: 96,
          borderRadius: "var(--radius-full)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            boxSizing: "border-box",
            borderRadius: "var(--radius-full)",
            border: "3px solid var(--text-3)",
          }}
        />
      </div>
      <h2 style={{ ...titleStyle, fontSize: 20 }}>{t("launcher.empty.title")}</h2>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)", maxWidth: 300 }}>
        {t("launcher.empty.body")}
      </p>
      <button
        type="button"
        onClick={onRecord}
        disabled={disabled}
        style={{
          marginTop: 4,
          padding: "10px 22px",
          borderRadius: "var(--radius-full)",
          border: "none",
          background: "var(--accent)",
          color: "var(--on-accent)",
          font: "inherit",
          fontWeight: 600,
          fontSize: 13,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {t("launcher.empty.cta")}
      </button>
    </div>
  );
}

/** Right-hand project shelf: title, search pill, 2-column cards. */
export function ProjectShelf({
  view,
  projects,
  status,
  onOpenProject,
  onProjectMenu,
  canRevealProjects,
  platform,
  onRecord,
  recordDisabled,
}: {
  view: ShelfView;
  projects: ReadonlyArray<LauncherProject>;
  status: "loading" | "ready" | "error";
  onOpenProject?: ((id: string) => void) | undefined;
  onProjectMenu?: ((id: string, action: LauncherProjectAction) => void) | undefined;
  canRevealProjects?: boolean | undefined;
  platform?: "darwin" | "win32" | "linux" | undefined;
  onRecord: () => void;
  recordDisabled: boolean;
}) {
  const t = useLauncherT();
  const menuItems = projectMenuItems(view, t, { canReveal: canRevealProjects, platform });
  const [query, setQuery] = useState("");
  const now = Date.now();

  const ordered = byModifiedDesc(projects);
  const scoped = view === "recent" ? ordered.slice(0, RECENT_LIMIT) : ordered;
  const needle = query.trim().toLowerCase();
  const visible = needle ? scoped.filter((p) => p.name.toLowerCase().includes(needle)) : scoped;

  if (status === "ready" && projects.length === 0 && view !== "trash") {
    return <ShelfEmpty onRecord={onRecord} disabled={recordDisabled} />;
  }

  const title =
    view === "recent"
      ? t("launcher.recentProjects")
      : view === "all"
        ? t("launcher.nav.all")
        : t("launcher.nav.trash");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: 18,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <h2 style={titleStyle}>{title}</h2>
        <label
          style={{
            width: 180,
            height: 32,
            boxSizing: "border-box",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-strong)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t("launcher.shelf.search")}
            aria-label={t("launcher.shelf.search")}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-1)",
              font: "inherit",
              fontSize: 12,
              padding: 0,
            }}
          />
        </label>
      </div>
      <ul
        aria-label={t("launcher.shelf.label")}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          overflowY: "auto",
          minHeight: 0,
          alignContent: "start",
        }}
      >
        {status === "loading" ? (
          <div data-testid="launcher-shelf-loading" style={noteStyle}>
            <output>{t("launcher.shelf.loading")}</output>
          </div>
        ) : status === "error" ? (
          <div data-testid="launcher-shelf-error" role="alert" style={noteStyle}>
            {t("launcher.shelf.error")}
          </div>
        ) : scoped.length === 0 ? (
          <div data-testid="launcher-shelf-trash-empty" style={noteStyle}>
            {t("launcher.shelf.trashEmpty")}
          </div>
        ) : visible.length === 0 ? (
          <div data-testid="launcher-shelf-no-results" style={noteStyle}>
            {t("launcher.shelf.noResults", { query: query.trim() })}
          </div>
        ) : (
          visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              now={now}
              onOpen={view === "trash" ? undefined : onOpenProject}
              menuItems={menuItems}
              onMenu={onProjectMenu}
            />
          ))
        )}
      </ul>
    </div>
  );
}
