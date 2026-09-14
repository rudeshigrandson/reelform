import { Button, Tag } from "@design/components";
import type { PermissionKind, PermissionsState } from "../types";

export interface PermissionsProps {
  permissions: PermissionsState;
  onRequestPermission: (kind: PermissionKind) => void;
  onContinue: () => void;
}

interface Row {
  kind: PermissionKind;
  label: string;
  required: boolean;
}

const ROWS: readonly Row[] = [
  { kind: "screen", label: "Screen Recording", required: true },
  { kind: "microphone", label: "Microphone", required: false },
  { kind: "accessibility", label: "Accessibility", required: false },
];

export function Permissions({ permissions, onRequestPermission, onContinue }: PermissionsProps) {
  const screenGranted = permissions.screen === "granted";

  return (
    <section
      aria-labelledby="onboarding-permissions-title"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <h2
        id="onboarding-permissions-title"
        style={{
          fontFamily: "var(--font-heading)",
          color: "var(--color-text)",
          fontSize: "1.75rem",
          margin: 0,
        }}
      >
        Reelform needs a few permissions
      </h2>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        {ROWS.map((row) => {
          const granted = permissions[row.kind] === "granted";
          return (
            <li
              key={row.kind}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                padding: "var(--space-3)",
                background: "var(--color-surface)",
                borderRadius: "var(--radius-md)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span style={{ fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
                  {row.label}
                </span>
                {row.required ? <Tag variant="accent">Required</Tag> : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <Tag variant={granted ? "accent-2" : "outline"}>
                  {granted ? "Granted" : "Needed"}
                </Tag>
                {granted ? null : (
                  <Button
                    variant="secondary"
                    onClick={() => onRequestPermission(row.kind)}
                    aria-label={`Grant ${row.label}`}
                  >
                    Grant
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Button variant="primary" disabled={!screenGranted} onClick={onContinue}>
        Continue
      </Button>
    </section>
  );
}
