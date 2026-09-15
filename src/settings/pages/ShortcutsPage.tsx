import { Button, Tag } from "@design/components";
import { Fragment, type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
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
import type { SettingsProps } from "../types";

type Notice = { id: string; tone: "danger" | "warning"; text: string } | null;

function conflictText(
  outcome: Extract<RecordOutcome, { kind: "candidate" }>,
  resolved: readonly ResolvedShortcut[],
) {
  const others = outcome.conflicts.map((c) => `“${shortcutLabelFor(c.ids[1], resolved)}”`);
  return others.join(", ");
}

export function ShortcutsPage({ settings, onChange, services }: SettingsProps) {
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
        text: `${outcome.display} can't be used. ${outcome.message} Press different keys, or Esc to cancel.`,
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
        text: `${outcome.display} is already used by ${conflictText(outcome, resolved)}. Press different keys, or Esc to cancel.`,
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
            text: `${outcome.display} is also used by ${conflictText(outcome, resolved)}; the more specific area wins while it has focus.`,
          }
        : null,
    );
    stop();
  };

  return (
    <div>
      <PageHeading>Shortcuts</PageHeading>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          marginBottom: "var(--space-4)",
        }}
      >
        <p style={helpStyle}>Click a shortcut, then press the new keys. Esc cancels.</p>
        <Button
          variant="ghost"
          disabled={Object.keys(settings.shortcuts).length === 0}
          onClick={() => {
            setNotice(null);
            stop();
            onChange({ shortcuts: {} });
          }}
        >
          Reset all
        </Button>
      </div>

      {existingDuplicates.length > 0 ? (
        <StatusText tone="warning">
          {existingDuplicates.length === 1
            ? "One shortcut conflict"
            : `${existingDuplicates.length} shortcut conflicts`}{" "}
          — only one of the actions will run.
        </StatusText>
      ) : null}

      <table className="table" aria-label="Keyboard shortcuts">
        <thead>
          <tr>
            <th scope="col">Action</th>
            <th scope="col">Shortcut</th>
            <th scope="col" style={{ textAlign: "right" }}>
              Reset
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
                return (
                  <tr key={row.id}>
                    <td>
                      {row.def.label}
                      {rowNotice ? (
                        <div style={{ marginTop: "var(--space-1)" }}>
                          <StatusText tone={rowNotice.tone}>{rowNotice.text}</StatusText>
                        </div>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        aria-label={`${row.def.label} shortcut: ${recording ? "recording" : row.display || "unassigned"}`}
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
                          <span style={{ color: "var(--accent)" }}>Press keys…</span>
                        ) : row.display ? (
                          <kbd style={kbdStyle}>{row.display}</kbd>
                        ) : (
                          <span style={{ color: "var(--text-3)" }}>Unassigned</span>
                        )}
                      </button>
                      {row.source === "invalid-override" ? (
                        <Tag
                          variant="outline"
                          title="The saved shortcut was invalid; using the default"
                        >
                          Invalid
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
                          Unassign
                        </button>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Button
                        variant="ghost"
                        aria-label={`Reset ${row.def.label}`}
                        disabled={row.source === "default"}
                        onClick={() => {
                          setNotice(null);
                          onChange({
                            shortcuts: resetShortcutOverride(settings.shortcuts, row.id),
                          });
                        }}
                      >
                        Reset
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
