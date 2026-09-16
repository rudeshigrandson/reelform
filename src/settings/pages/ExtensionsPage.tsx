import { Button } from "@design/components";
import { useId } from "react";
import { useT } from "../../i18n";
import { Page } from "../controls";

/**
 * S24/07 Extensions — header actions over a list of extension cards. The
 * platform ships in 1.2 (SPEC §12), so 1.0 lists a single empty-state card.
 */
export function ExtensionsPage() {
  const t = useT();
  const titleId = useId();
  return (
    <Page
      title={t("settings.section.extensions")}
      actions={
        <div className="rf-set-tools">
          <Button variant="primary" className="rf-set-btn-sm" disabled>
            {t("settings.extensions.browse")}
          </Button>
          <Button className="rf-set-btn-sm rf-set-btn-panel" disabled>
            {t("settings.extensions.installFromFile")}
          </Button>
        </div>
      }
    >
      <section aria-labelledby={titleId} className="rf-set-ext">
        <div aria-hidden="true" className="rf-set-ext-icon">
          ⧉
        </div>
        <div className="rf-set-row-text">
          <h3 id={titleId} className="rf-set-ext-name">
            {t("settings.extensions.emptyTitle")}
          </h3>
          <p className="rf-set-help">{t("settings.extensions.emptyBody")}</p>
        </div>
      </section>
    </Page>
  );
}
