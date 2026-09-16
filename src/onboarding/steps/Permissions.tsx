import { Button } from "@design/components";
import type { CSSProperties, ReactNode } from "react";
import { StepBody, StepFooter, StepTitle, ghostLink, primaryPill, secondaryPill } from "../Shell";
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
  /** Back control rendered in the footer. */
  back?: ReactNode;
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

/** Kinds whose title carries "· optional" (the rest say so in their copy). */
const OPTIONAL_MARK: ReadonlySet<OsPermissionKind> = new Set(["notifications"]);

const STATUS_LABEL: Record<OsPermissionStatus, OnboardingKey> = {
  granted: "onboarding.status.granted",
  denied: "onboarding.status.denied",
  "not-determined": "onboarding.status.notDetermined",
  restricted: "onboarding.status.restricted",
  "not-applicable": "onboarding.status.notApplicable",
};

const recordMix = (pct: number, other = "transparent") =>
  `color-mix(in srgb, var(--record) ${pct}%, ${other})`;

function settingsName(platform: PermissionsSnapshot["platform"], t: OnboardingTranslate): string {
  return t(
    platform === "win32"
      ? "onboarding.permissions.settingsName.win32"
      : "onboarding.permissions.settingsName.other",
  );
}

function Glyph({ kind, blocked }: { kind: OsPermissionKind; blocked: boolean }) {
  let inner: ReactNode;
  if (blocked) {
    inner = <span style={{ color: recordMix(70, "var(--text-1)"), fontWeight: 700 }}>!</span>;
  } else if (kind === "screen") {
    inner = (
      <div
        style={{
          width: "16px",
          height: "11px",
          boxSizing: "border-box",
          border: "2px solid var(--accent-hover)",
          borderRadius: "2px",
        }}
      />
    );
  } else if (kind === "microphone") {
    inner = (
      <div
        style={{
          width: "8px",
          height: "14px",
          borderRadius: "var(--radius-full)",
          background: "var(--text-2)",
        }}
      />
    );
  } else if (kind === "camera") {
    inner = (
      <div
        style={{ width: "16px", height: "11px", borderRadius: "3px", background: "var(--text-2)" }}
      />
    );
  } else if (kind === "accessibility") {
    inner = (
      <div
        style={{
          width: "14px",
          height: "14px",
          boxSizing: "border-box",
          borderRadius: "var(--radius-full)",
          border: "2px solid var(--text-2)",
        }}
      />
    );
  } else {
    inner = <span style={{ color: "var(--text-2)", fontSize: "13px" }}>◔</span>;
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: "34px",
        height: "34px",
        flex: "none",
        borderRadius: "10px",
        background: blocked ? recordMix(20) : "var(--bg-panel-raised)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {inner}
    </div>
  );
}

const smallPill: CSSProperties = { fontSize: "12px", padding: "7px 14px" };

function StatusPill({ status, t }: { status: OsPermissionStatus; t: OnboardingTranslate }) {
  const granted = status === "granted";
  return (
    <span
      style={{
        flex: "none",
        padding: "4px 10px",
        borderRadius: "var(--radius-full)",
        fontSize: "11px",
        fontWeight: granted ? 600 : 400,
        background: granted
          ? "color-mix(in srgb, var(--success) 18%, transparent)"
          : "var(--bg-panel-raised)",
        color: granted ? "var(--success)" : "var(--text-3)",
      }}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}

function Row({
  entry,
  platform,
  primary,
  requesting,
  onRequest,
  onOpenSettings,
}: {
  entry: PermissionEntry;
  platform: PermissionsSnapshot["platform"];
  primary: boolean;
  requesting: boolean;
  onRequest: () => void;
  onOpenSettings: () => void;
}) {
  const t = useOnboardingT();
  const label = t(COPY[entry.kind].label);
  const granted = entry.status === "granted";
  const blocked = entry.status === "denied" || entry.status === "restricted";
  const settings = settingsName(platform, t);

  const description = blocked
    ? entry.status === "restricted"
      ? t("onboarding.permissions.restricted", { permission: label })
      : t(
          platform === "darwin"
            ? "onboarding.permissions.denied.darwin"
            : "onboarding.permissions.denied.other",
          { settings, permission: label },
        )
    : entry.kind === "screen" && platform === "darwin"
      ? t("onboarding.permissions.restartNote")
      : t(COPY[entry.kind].description);

  const openSettings = (
    <Button
      variant="secondary"
      onClick={onOpenSettings}
      style={{ ...secondaryPill, ...smallPill }}
      aria-label={t("onboarding.permissions.openSettingsLabel", { settings, permission: label })}
    >
      {t("onboarding.permissions.openSettings", { settings })}
    </Button>
  );

  let action: ReactNode;
  if (granted) action = <StatusPill status={entry.status} t={t} />;
  else if (!blocked && entry.canRequest) {
    action = (
      <Button
        variant={primary ? "primary" : "secondary"}
        onClick={onRequest}
        disabled={requesting}
        style={primary ? { ...primaryPill, ...smallPill } : { ...secondaryPill, ...smallPill }}
        aria-label={t("onboarding.permissions.allowLabel", { permission: label })}
      >
        {requesting ? t("onboarding.permissions.waiting") : t("onboarding.permissions.allow")}
      </Button>
    );
  } else if (entry.canOpenSettings) action = openSettings;
  else action = <StatusPill status={entry.status} t={t} />;

  return (
    <li
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "10px 16px",
        borderRadius: "var(--radius-md)",
        background: blocked ? recordMix(10) : "var(--bg-panel)",
        border: `1px solid ${blocked ? recordMix(45) : "var(--border)"}`,
      }}
    >
      <Glyph kind={entry.kind} blocked={blocked} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>
          {label}
          {entry.required ? (
            <span style={{ color: "var(--accent-hover)" }}>
              {" · "}
              {t("onboarding.permissions.required")}
            </span>
          ) : OPTIONAL_MARK.has(entry.kind) ? (
            <span style={{ color: "var(--text-3)" }}>
              {" · "}
              {t("onboarding.permissions.optional")}
            </span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: blocked ? recordMix(35, "var(--text-1)") : "var(--text-3)",
          }}
        >
          {description}
        </div>
      </div>
      {action}
    </li>
  );
}

const infoText: CSSProperties = {
  display: "block",
  margin: 0,
  fontSize: "13px",
  color: "var(--text-3)",
};

/** S02 — permission rows; statuses arrive by polling every 2s. */
export function Permissions({
  snapshot,
  unavailable,
  statusError,
  requesting,
  onRequest,
  onOpenSettings,
  onContinue,
  back,
}: PermissionsProps) {
  const t = useOnboardingT();
  const rows = permissionRows(snapshot);
  const canContinue = canLeavePermissions({ snapshot, unavailable });
  const skippable = canContinue && hasPendingOptional(snapshot);
  const primaryKind = rows.find((r) => r.status === "not-determined" && r.canRequest)?.kind;

  return (
    <section
      aria-labelledby="onboarding-permissions-title"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <StepBody padding="4px 40px 12px" gap="10px">
        <StepTitle
          id="onboarding-permissions-title"
          title={t("onboarding.permissions.title")}
          subtitle={t("onboarding.permissions.subtitle")}
        />

        {snapshot?.platform === "win32" ? (
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: "12px" }}>
            {t("onboarding.permissions.windowsNote")}
          </p>
        ) : null}

        {statusError ? (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
            {t("onboarding.permissions.statusError", { error: statusError })}
          </p>
        ) : null}

        {unavailable ? (
          <output style={infoText}>{t("onboarding.permissions.unavailable")}</output>
        ) : snapshot === null ? (
          statusError ? null : (
            <output style={infoText}>{t("onboarding.permissions.checking")}</output>
          )
        ) : rows.length === 0 ? (
          <output style={infoText}>{t("onboarding.permissions.noneNeeded")}</output>
        ) : (
          <ul
            aria-label={t("onboarding.permissions.listLabel")}
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {rows.map((entry) => (
              <Row
                key={entry.kind}
                entry={entry}
                platform={snapshot.platform}
                primary={entry.kind === primaryKind}
                requesting={requesting === entry.kind}
                onRequest={() => onRequest(entry.kind)}
                onOpenSettings={() => onOpenSettings(entry.kind)}
              />
            ))}
          </ul>
        )}
      </StepBody>

      <StepFooter
        step="permissions"
        leading={
          <>
            {back}
            {skippable ? (
              <Button
                variant="ghost"
                onClick={onContinue}
                style={{ ...ghostLink, fontSize: "13px", padding: "6px 4px" }}
              >
                {t("onboarding.permissions.skip")}
              </Button>
            ) : null}
          </>
        }
      >
        <Button variant="primary" disabled={!canContinue} onClick={onContinue} style={primaryPill}>
          {t("onboarding.permissions.continue")}
        </Button>
      </StepFooter>
    </section>
  );
}
