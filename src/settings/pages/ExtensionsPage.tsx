import { Button } from "@design/components";
import { useT } from "../../i18n";
import { PageHeading } from "../controls";

/** S24 Extensions — the platform ships in 1.2 (SPEC §12); 1.0 shows the empty state. */
export function ExtensionsPage() {
  const t = useT();
  return (
    <div>
      <PageHeading>{t("settings.section.extensions")}</PageHeading>
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
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
          {t("settings.extensions.emptyTitle")}
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-2)", maxWidth: "420px" }}>
          {t("settings.extensions.emptyBody")}
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button variant="primary" disabled>
            {t("settings.extensions.browse")}
          </Button>
          <Button disabled>{t("settings.extensions.installFromFile")}</Button>
        </div>
      </div>
    </div>
  );
}
