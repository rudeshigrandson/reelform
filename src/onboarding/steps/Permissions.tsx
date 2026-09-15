import { Button, Tag } from "@design/components";
import { canLeavePermissions, hasPendingOptional, permissionRows } from "../machine";
import type {
  OsPermissionKind,
  OsPermissionStatus,
  PermissionEntry,
  PermissionsSnapshot,
} from "../types";

export interface PermissionsProps {
  snapshot: PermissionsSnapshot | null;
  unavailable: boolean;
  statusError: string | null;
  requesting: OsPermissionKind | null;
  onRequest: (kind: OsPermissionKind) => void;
  onOpenSettings: (kind: OsPermissionKind) => void;
  onContinue: () => void;
}

const COPY: Record<OsPermissionKind, { label: string; description: string }> = {
  screen: { label: "Screen Recording", description: "Capture your displays and windows." },
  microphone: { label: "Microphone", description: "Record voice-over while you capture." },
  camera: { label: "Camera", description: "Add a webcam bubble to recordings." },
  accessibility: {
    label: "Accessibility",
    description: "Track the cursor and detect clicks for auto-zoom.",
  },
  notifications: { label: "Notifications", description: "Know when exports finish." },
};

const STATUS_LABEL: Record<OsPermissionStatus, string> = {
  granted: "Granted",
  denied: "Denied",
  "not-determined": "Not determined",
  restricted: "Restricted",
  "not-applicable": "Not needed",
};

function settingsName(platform: PermissionsSnapshot["platform"]): string {
  return platform === "win32" ? "Settings" : "System Settings";
}

function Row({
  entry,
  platform,
  requesting,
  onRequest,
  onOpenSettings,
}: {
  entry: PermissionEntry;
  platform: PermissionsSnapshot["platform"];
  requesting: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  const { label, description } = COPY[entry.kind];
  const granted = entry.status === "granted";
  const blocked = entry.status === "denied" || entry.status === "restricted";
  const settings = settingsName(platform);
  return (
    <li
      aria-label={label}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-3)",
        background: "var(--bg-panel-raised)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            {entry.required ? <Tag variant="accent">Required</Tag> : null}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{description}</div>
        </div>
        <Tag variant={granted ? "accent-2" : blocked ? "outline" : "neutral"}>
          {granted ? "✓ " : ""}
          {STATUS_LABEL[entry.status]}
        </Tag>
        {granted ? null : blocked || !entry.canRequest ? (
          entry.canOpenSettings ? (
            <Button
              variant="secondary"
              onClick={onOpenSettings}
              aria-label={`Open ${settings} for ${label}`}
            >
              Open {settings}
            </Button>
          ) : null
        ) : (
          <Button
            variant="secondary"
            onClick={onRequest}
            disabled={requesting}
            aria-label={`Allow ${label}`}
          >
            {requesting ? "Waiting…" : "Allow…"}
          </Button>
        )}
      </div>
      {blocked ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--warning)", textAlign: "left" }}>
          {entry.status === "restricted"
            ? `${label} is restricted by a device policy.`
            : `Access was denied. Turn on Reelform under ${settings} › Privacy${platform === "darwin" ? " & Security" : ""} › ${label}.`}
        </p>
      ) : null}
      {entry.kind === "screen" && platform === "darwin" && !granted ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-3)", textAlign: "left" }}>
          macOS will ask you to restart Reelform after granting.
        </p>
      ) : null}
    </li>
  );
}

/** S02 — permission rows; statuses arrive by polling every 2s. */
export function Permissions({
  snapshot,
  unavailable,
  statusError,
  requesting,
  onRequest,
  onOpenSettings,
  onContinue,
}: PermissionsProps) {
  const rows = permissionRows(snapshot);
  const canContinue = canLeavePermissions({ snapshot, unavailable });
  const skippable = canContinue && hasPendingOptional(snapshot);

  return (
    <section
      aria-labelledby="onboarding-permissions-title"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <h2
        id="onboarding-permissions-title"
        style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}
      >
        Reelform needs a few permissions
      </h2>

      {snapshot?.platform === "win32" ? (
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: "13px" }}>
          Screen capture needs no permission on Windows. Microphone and camera access are controlled
          in Settings › Privacy.
        </p>
      ) : null}

      {statusError ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
          Couldn't check permissions ({statusError}). Retrying…
        </p>
      ) : null}

      {unavailable ? (
        <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
          Permissions are managed by the desktop app.
        </output>
      ) : snapshot === null ? (
        statusError ? null : (
          <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
            Checking permissions…
          </output>
        )
      ) : rows.length === 0 ? (
        <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
          No permissions are needed on this system.
        </output>
      ) : (
        <ul
          aria-label="Permissions"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {rows.map((entry) => (
            <Row
              key={entry.kind}
              entry={entry}
              platform={snapshot.platform}
              requesting={requesting === entry.kind}
              onRequest={() => onRequest(entry.kind)}
              onOpenSettings={() => onOpenSettings(entry.kind)}
            />
          ))}
        </ul>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        {skippable ? (
          <Button variant="ghost" onClick={onContinue}>
            Skip for now
          </Button>
        ) : null}
        <Button variant="primary" disabled={!canContinue} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </section>
  );
}
