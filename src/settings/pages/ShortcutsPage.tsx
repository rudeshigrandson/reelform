import { Button, Tag } from "@design/components";
import { type KeyboardEvent as ReactKeyboardEvent, useId, useMemo, useState } from "react";
import { type Translate, useT } from "../../i18n";
import { detectConflicts } from "../../shortcuts/conflicts";
import { useShortcutsT } from "../../shortcuts/i18n";
import {
  type RecordOutcome,
  evaluateRecordedKey,
  filterShortcuts,
  groupShortcuts,
  shortcutLabelFor,
} from "../../shortcuts/recorder";
import {
  type ResolvedShortcut,
  resetShortcutOverride,
  resolveShortcuts,
  setShortcutOverride,
} from "../../shortcuts/registry";
import { Page, StatusText } from "../controls";
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

/** S24/04 — grouped cards of action · keycap · Reset, inline key recording with conflicts. */
export function ShortcutsPage({ settings, onChange, services }: SettingsProps) {
  const t = useT();
  const sht = useShortcutsT();
  const helpId = useId();
  const platform = services?.platform ?? "mac";
  const resolved = useMemo(
    () => resolveShortcuts(platform, settings.shortcuts),
    [platform, settings.shortcuts],
  );
  const [query, setQuery] = useState("");
  const groups = groupShortcuts(filterShortcuts(resolved, query, sht));
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
    <Page
      title={t("settings.section.shortcuts")}
      actions={
        <div className="rf-set-tools">
          <span className="rf-sc-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label={t("settings.shortcuts.search")}
              placeholder={t("settings.shortcuts.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          <Button
            variant="ghost"
            className="rf-set-btn-sm"
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
      }
    >
      <p id={helpId} className="rf-sr-only">
        {t("settings.shortcuts.help")}
      </p>

      {existingDuplicates.length > 0 ? (
        <StatusText tone="warning">
          {t("settings.shortcuts.conflicts", { count: existingDuplicates.length })}
        </StatusText>
      ) : null}

      {groups.length === 0 ? (
        <p className="rf-set-help">{sht("shortcuts.overlay.noMatch", { query })}</p>
      ) : null}

      <table
        className="rf-sc-table"
        aria-label={t("settings.shortcuts.table")}
        aria-describedby={helpId}
      >
        <thead className="rf-sr-only">
          <tr>
            <th scope="col">{t("settings.shortcuts.column.action")}</th>
            <th scope="col">{t("settings.shortcuts.column.shortcut")}</th>
            <th scope="col">{t("settings.shortcuts.column.reset")}</th>
          </tr>
        </thead>
        {groups.map(({ group, rows }) => (
          <tbody key={group}>
            <tr className="rf-sc-group">
              <th colSpan={3} scope="colgroup">
                {group}
              </th>
            </tr>
            {rows.map((row) => {
              const recording = recordingId === row.id;
              const rowNotice = notice?.id === row.id ? notice : null;
              const osConflict = osConflicts.get(row.id);
              return (
                <tr
                  key={row.id}
                  className="rf-sc-row"
                  data-recording={recording ? "true" : undefined}
                >
                  <td className="rf-sc-action">
                    {row.def.label}
                    {rowNotice ? (
                      <StatusText tone={rowNotice.tone}>
                        <span aria-hidden="true">⚠ </span>
                        {rowNotice.text}
                      </StatusText>
                    ) : null}
                    {osConflict !== undefined && !rowNotice ? (
                      <StatusText tone="warning">
                        <span aria-hidden="true">⚠ </span>
                        {t("settings.shortcuts.osConflict", {
                          keys: osConflict || row.display,
                        })}
                      </StatusText>
                    ) : null}
                  </td>
                  <td className="rf-sc-keys">
                    {row.source === "invalid-override" ? (
                      <Tag variant="outline" title={t("settings.shortcuts.invalid.title")}>
                        {t("settings.shortcuts.invalid")}
                      </Tag>
                    ) : null}
                    <button
                      type="button"
                      className="rf-sc-key"
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
                    >
                      {recording ? (
                        <span className="rf-kbd rf-kbd-live">
                          {t("settings.shortcuts.pressKeys")}
                        </span>
                      ) : row.display ? (
                        <kbd className="rf-kbd">{row.display}</kbd>
                      ) : (
                        <span className="rf-sc-muted">{t("settings.shortcuts.unassigned")}</span>
                      )}
                    </button>
                  </td>
                  <td className="rf-sc-reset">
                    {recording ? (
                      <button
                        type="button"
                        className="rf-sc-link"
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
                    ) : (
                      <button
                        type="button"
                        className="rf-sc-link"
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
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </Page>
  );
}
