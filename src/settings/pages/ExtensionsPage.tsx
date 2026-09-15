import { Button } from "@design/components";
import { PageHeading } from "../controls";

/** S24 Extensions — the platform ships in 1.2 (SPEC §12); 1.0 shows the empty state. */
export function ExtensionsPage() {
  return (
    <div>
      <PageHeading>Extensions</PageHeading>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: "var(--space-3)",
          padding: "var(--space-8) var(--space-4)",
          border: "1px dashed var(--border-strong)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div aria-hidden="true" style={{ fontSize: "48px", lineHeight: 1, color: "var(--text-3)" }}>
          ⧉
        </div>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Extensions arrive in 1.2</h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-2)", maxWidth: "420px" }}>
          Wallpapers, cursor packs, sounds and render extensions will be installable here. No
          extensions are installed.
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="primary" disabled>
            Browse marketplace
          </Button>
          <Button disabled>Install from file…</Button>
        </div>
      </div>
    </div>
  );
}
