import { Button, Tag } from "@design/components";
import { type OnboardingKey, type OnboardingTranslate, useOnboardingT } from "../i18n";
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

const COPY: Record<OsPermissionKind, { label: OnboardingKey; description: OnboardingKey }> = {
  screen: {
    label: "onboarding.permission.screen",
    description: "onboarding.permission.screen.description",
  },
  microphone: {
    label: "onboarding.permission.microphone",
    description: "onboarding.permission.microphone.description",
  },
  camera: {
    label: "onboarding.permission.camera",
    description: "onboarding.permission.camera.description",
  },
  accessibility: {
    label: "onboarding.permission.accessibility",
    description: "onboarding.permission.accessibility.description",
  },
  notifications: {
    label: "onboarding.permission.notifications",
    description: "onboarding.permission.notifications.description",
  },
};

const STATUS_LABEL: Record<OsPermissionStatus, OnboardingKey> = {
  granted: "onboarding.status.granted",
  denied: "onboarding.status.denied",
  "not-determined": "onboarding.status.notDetermined",
  restricted: "onboarding.status.restricted",
  "not-applicable": "onboarding.status.notApplicable",
};

function settingsName(platform: PermissionsSnapshot["platform"], t: OnboardingTranslate): string {
  return t(
    platform === "win32"
      ? "onboarding.permissions.settingsName.win32"
      : "onboarding.permissions.settingsName.other",
  );
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
  const t = useOnboardingT();
  const label = t(COPY[entry.kind].label);
  const description = t(COPY[entry.kind].description);
  const granted = entry.status === "granted";
  const blocked = entry.status === "denied" || entry.status === "restricted";
  const settings = settingsName(platform, t);
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
            {entry.required ? (
              <Tag variant="accent">{t("onboarding.permissions.required")}</Tag>
            ) : null}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-2)" }}>{description}</div>
        </div>
        <Tag variant={granted ? "accent-2" : blocked ? "outline" : "neutral"}>
          {granted ? "✓ " : ""}
          {t(STATUS_LABEL[entry.status])}
        </Tag>
        {granted ? null : blocked || !entry.canRequest ? (
          entry.canOpenSettings ? (
            <Button
              variant="secondary"
              onClick={onOpenSettings}
              aria-label={t("onboarding.permissions.openSettingsLabel", {
                settings,
                permission: label,
              })}
            >
              {t("onboarding.permissions.openSettings", { settings })}
            </Button>
          ) : null
        ) : (
          <Button
            variant="secondary"
            onClick={onRequest}
            disabled={requesting}
            aria-label={t("onboarding.permissions.allowLabel", { permission: label })}
          >
            {requesting ? t("onboarding.permissions.waiting") : t("onboarding.permissions.allow")}
          </Button>
        )}
      </div>
      {blocked ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--warning)", textAlign: "left" }}>
          {entry.status === "restricted"
            ? t("onboarding.permissions.restricted", { permission: label })
            : t(
                platform === "darwin"
                  ? "onboarding.permissions.denied.darwin"
                  : "onboarding.permissions.denied.other",
                { settings, permission: label },
              )}
        </p>
      ) : null}
      {entry.kind === "screen" && platform === "darwin" && !granted ? (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--text-3)", textAlign: "left" }}>
          {t("onboarding.permissions.restartNote")}
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
  const t = useOnboardingT();
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
        {t("onboarding.permissions.title")}
      </h2>

      {snapshot?.platform === "win32" ? (
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: "13px" }}>
          {t("onboarding.permissions.windowsNote")}
        </p>
      ) : null}

      {statusError ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
          {t("onboarding.permissions.statusError", { error: statusError })}
        </p>
      ) : null}

      {unavailable ? (
        <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
          {t("onboarding.permissions.unavailable")}
        </output>
      ) : snapshot === null ? (
        statusError ? null : (
          <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
            {t("onboarding.permissions.checking")}
          </output>
        )
      ) : rows.length === 0 ? (
        <output style={{ display: "block", margin: 0, color: "var(--text-3)" }}>
          {t("onboarding.permissions.noneNeeded")}
        </output>
      ) : (
        <ul
          aria-label={t("onboarding.permissions.listLabel")}
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
            {t("onboarding.permissions.skip")}
          </Button>
        ) : null}
        <Button variant="primary" disabled={!canContinue} onClick={onContinue}>
          {t("onboarding.permissions.continue")}
        </Button>
      </div>
    </section>
  );
}
