import { Button } from "@design/components";
import { useState } from "react";
import { PageHeading, StatusText, helpStyle } from "../controls";
import { LICENSES_URL } from "../services";
import type { SettingsProps } from "../types";

type CopyState = "idle" | "copying" | "copied" | "failed";

export function AboutPage({ services }: SettingsProps) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const copyDiagnostics = services?.copyDiagnostics;
  const version = services?.updater?.state?.currentVersion ?? services?.appVersion ?? null;

  return (
    <div>
      <PageHeading>About</PageHeading>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginBottom: "var(--space-5)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "var(--radius-md)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-heading)",
            fontSize: "28px",
          }}
        >
          R
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: "1.3rem" }}>Reelform</div>
          <div style={{ ...helpStyle, fontFamily: "var(--font-mono)" }}>
            Version {version ?? "unknown"}
          </div>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: "520px" }}>
        Built with Electron, React and PixiJS. Includes portions of OpenScreen (MIT).
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <Button
          variant="ghost"
          disabled={!services?.system}
          onClick={() => void services?.system?.openExternal(LICENSES_URL)}
        >
          Licenses
        </Button>
        <Button
          disabled={!copyDiagnostics || copy === "copying"}
          onClick={async () => {
            if (!copyDiagnostics) return;
            setCopy("copying");
            const ok = await copyDiagnostics().catch(() => false);
            setCopy(ok ? "copied" : "failed");
          }}
        >
          {copy === "copying" ? "Copying…" : "Copy diagnostics"}
        </Button>
      </div>
      {copy === "copied" ? (
        <StatusText tone="success">
          Diagnostics copied. Paths and your user name are removed.
        </StatusText>
      ) : null}
      {copy === "failed" ? <StatusText tone="danger">Couldn't copy diagnostics.</StatusText> : null}
    </div>
  );
}
