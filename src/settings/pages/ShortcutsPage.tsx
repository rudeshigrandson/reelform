import { Button, Tag } from "@design/components";
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
import { type Translate, useT } from "../../i18n";
import { kbdStyle } from "../../shortcuts/ShortcutsOverlay";
import { detectConflicts } from "../../shortcuts/conflicts";
import {
  type RecordOutcome,
  evaluateRecordedKey,
  groupShortcuts,
  shortcutLabelFor,
} from "../../shortcuts/recorder";
import {
  type ResolvedShortcut,
  resetShortcutOverride,
  resolveShortcuts,
  setShortcutOverride,
} from "../../shortcuts/registry";
import { PageHeading, StatusText, helpStyle } from "../controls";
import type { GlobalShortcutStatus } from "../services";
import type { SettingsProps } from "../types";

type Notice = { id: string; tone: "danger" | "warning"; text: string } | null;

function conflictText(
  outcome: Extract<RecordOutcome, { kind: "candidate" }>,
  resolved: readonly ResolvedShortcut[],
  t: Translate,
) {
  return outcome.conflicts
    .map((c) => t("settings.shortcuts.quoted", { label: shortcutLabelFor(c.ids[1], resolved) }))
    .join(", ");
}

/** id → accelerator (display string) of shortcuts another app already owns. */
export function osConflictsById(
  status: GlobalShortcutStatus | null | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const f of status?.failures ?? []) {
    if (f.reason === "os-conflict") out.set(f.id, f.accelerator);
  }
  return out;
}

export function ShortcutsPage({ settings, onChange, services }: SettingsProps) {
  const t = useT();
  const platform = services?.platform ?? "mac";
  const resolved = useMemo(
    () => resolveShortcuts(platform, settings.shortcuts),
    [platform, settings.shortcuts],
  );
  const groups = useMemo(() => groupShortcuts(resolved), [resolved]);
  const existingDuplicates = useMemo(
    () => detectConflicts(resolved).filter((c) => c.kind === "duplicate"),
    [resolved],
  );
  const globalStatus = services?.globalStatus;
  const osConflicts = useMemo(() => osConflictsById(globalStatus), [globalStatus]);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const stop = () => setRecordingId(null);

  const onRecordKey = (row: ResolvedShortcut, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const outcome = evaluateRecordedKey(row.id, e.nativeEvent, resolved, platform);
    if (outcome.kind === "ignore") {
      if (e.key !== "Tab") e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (outcome.kind === "cancel") {
      setNotice(null);
      stop();
      return;
    }
    if (outcome.kind === "invalid") {
      setNotice({
        id: row.id,
        tone: "danger",
        text: t("settings.shortcuts.notice.invalid", {
          keys: outcome.display,
          reason: outcome.message,
        }),
      });
      return;
    }
    if (outcome.unchanged) {
      setNotice(null);
      stop();
      return;
    }
    if (outcome.blocking) {
      setNotice({
        id: row.id,
        tone: "danger",
        text: t("settings.shortcuts.notice.blocking", {
          keys: outcome.display,
          others: conflictText(outcome, resolved, t),
        }),
      });
      return;
    }
    onChange({
      shortcuts: setShortcutOverride(settings.shortcuts, row.def, outcome.accelerator, platform),
    });
    setNotice(
      outcome.conflicts.length > 0
        ? {
            id: row.id,
            tone: "warning",
            text: t("settings.shortcuts.notice.shadow", {
              keys: outcome.display,
              others: conflictText(outcome, resolved, t),
            }),
          }
        : null,
    );
    stop();
  };

  return (
    <div>
      <PageHeading>{t("settings.section.shortcuts")}</PageHeading>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          marginBottom: "var(--space-4)",
        }}
      >
        <p style={helpStyle}>{t("settings.shortcuts.help")}</p>
        <Button
          variant="ghost"
          disabled={Object.keys(settings.shortcuts).length === 0}
          onClick={() => {
            setNotice(null);
            stop();
            onChange({ shortcuts: {} });
          }}
        >
          {t("settings.shortcuts.resetAll")}
        </Button>
      </div>

      {existingDuplicates.length > 0 ? (
        <StatusText tone="warning">
          {t("settings.shortcuts.conflicts", { count: existingDuplicates.length })}
        </StatusText>
      ) : null}

      <table className="table" aria-label={t("settings.shortcuts.table")}>
        <thead>
          <tr>
            <th scope="col">{t("settings.shortcuts.column.action")}</th>
            <th scope="col">{t("settings.shortcuts.column.shortcut")}</th>
            <th scope="col" style={{ textAlign: "right" }}>
              {t("settings.shortcuts.column.reset")}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, rows }) => (
            <Fragment key={group}>
              <tr>
                <th
                  colSpan={3}
                  scope="colgroup"
                  style={{ paddingTop: "var(--space-4)", color: "var(--text-3)" }}
                >
                  {group}
                </th>
              </tr>
              {rows.map((row) => {
                const recording = recordingId === row.id;
                const rowNotice = notice?.id === row.id ? notice : null;
                const osConflict = osConflicts.get(row.id);
                return (
                  <tr key={row.id}>
                    <td>
                      {row.def.label}
                      {rowNotice ? (
                        <div style={{ marginTop: "var(--space-1)" }}>
                          <StatusText tone={rowNotice.tone}>{rowNotice.text}</StatusText>
                        </div>
                      ) : null}
                      {osConflict !== undefined && !rowNotice ? (
                        <div style={{ marginTop: "var(--space-1)" }}>
                          <StatusText tone="warning">
                            {t("settings.shortcuts.osConflict", {
                              keys: osConflict || row.display,
                            })}
                          </StatusText>
                        </div>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        aria-label={t("settings.shortcuts.buttonLabel", {
                          label: row.def.label,
                          state: recording
                            ? t("settings.shortcuts.state.recording")
                            : row.display || t("settings.shortcuts.state.unassigned"),
                        })}
                        aria-pressed={recording}
                        onClick={() => {
                          setNotice(null);
                          setRecordingId(recording ? null : row.id);
                        }}
                        onKeyDown={recording ? (e) => onRecordKey(row, e) : undefined}
                        onBlur={recording ? stop : undefined}
                        style={{
                          background: "transparent",
                          border: recording ? "1px solid var(--accent)" : "1px solid transparent",
                          borderRadius: "var(--radius-sm)",
                          padding: "var(--space-1)",
                          cursor: "pointer",
                          color: "var(--text-1)",
                          font: "inherit",
                        }}
                      >
                        {recording ? (
                          <span style={{ color: "var(--accent)" }}>
                            {t("settings.shortcuts.pressKeys")}
                          </span>
                        ) : row.display ? (
                          <kbd style={kbdStyle}>{row.display}</kbd>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>
                            {t("settings.shortcuts.unassigned")}
                          </span>
                        )}
                      </button>
                      {row.source === "invalid-override" ? (
                        <Tag variant="outline" title={t("settings.shortcuts.invalid.title")}>
                          {t("settings.shortcuts.invalid")}
                        </Tag>
                      ) : null}
                      {recording ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          // Keep focus on the recorder until the click lands.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            onChange({
                              shortcuts: setShortcutOverride(
                                settings.shortcuts,
                                row.def,
                                null,
                                platform,
                              ),
                            });
                            stop();
                          }}
                        >
                          {t("settings.shortcuts.unassign")}
                        </button>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Button
                        variant="ghost"
                        aria-label={t("settings.shortcuts.resetRow", { label: row.def.label })}
                        disabled={row.source === "default"}
                        onClick={() => {
                          setNotice(null);
                          onChange({
                            shortcuts: resetShortcutOverride(settings.shortcuts, row.id),
                          });
                        }}
                      >
                        {t("settings.shortcuts.reset")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
