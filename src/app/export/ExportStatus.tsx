import { Button } from "@design/components";
import type { CSSProperties, ReactElement } from "react";
import { t as translate, useT } from "../../i18n";
import { formatBytes, formatDuration } from "./config";
import type { ExportFlowPhase } from "./runner";
import { type ExportProgressData, useExportProgress } from "./useExportProgress";

/** S22 exporting / done / failed / low-disk / codec-unsupported panels and the S28 toast. */

type Phase<K extends ExportFlowPhase["kind"]> = Extract<ExportFlowPhase, { kind: K }>;

const text: CSSProperties = { fontFamily: "var(--font-body)", color: "var(--text-1)" };
const muted: CSSProperties = { ...text, color: "var(--text-2)", fontSize: "0.85rem" };
const row: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  marginTop: "var(--space-4)",
};

/** Headline over the progress bar, in the active window language. */
export function progressHeadline(phase: Phase<"running">): string {
  const p = phase.progress;
  if (phase.cancelling) return translate("exportFlow.progress.cancelling");
  if (p.phase === "rendering" && p.framesTotal > 0) {
    return translate("exportFlow.progress.renderingFrames", {
      done: p.framesDone,
      total: p.framesTotal,
    });
  }
  return p.label;
}

function ProgressBar({ fraction, label }: { fraction: number; label: string }): ReactElement {
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100);
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: read-only progress indicator
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: "8px",
        borderRadius: "var(--radius-full)",
        background: "var(--bg-active)",
        overflow: "hidden",
        margin: "var(--space-3) 0",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
    </div>
  );
}

export function ExportProgressView(props: {
  phase: Phase<"running">;
  onCancel(): void;
  onBackground(): void;
}): ReactElement {
  const { phase } = props;
  const t = useT();
  const p = phase.progress;
  return (
    <div data-testid="export-progress">
      <div style={text} data-testid="export-progress-label">
        {progressHeadline(phase)}
      </div>
      <ProgressBar fraction={p.fraction} label={t("exportFlow.progress.label")} />
      <div style={{ ...muted, display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <span>{t("exportFlow.progress.percent", { percent: Math.round(p.fraction * 100) })}</span>
        <span data-testid="export-eta">
          {t("exportFlow.progress.timeLeft", { duration: formatDuration(p.etaMs) })}
        </span>
        {p.speed !== null ? (
          <span data-testid="export-speed">
            {t("exportFlow.progress.speed", { speed: p.speed.toFixed(1) })}
          </span>
        ) : null}
        {phase.estimatedBytes !== null ? (
          <span data-testid="export-estimate">
            {t("exportFlow.progress.estimate", { size: formatBytes(phase.estimatedBytes) })}
          </span>
        ) : null}
        <span>
          {p.encoder === "hardware"
            ? t("exportFlow.progress.hardwareEncoder")
            : t("exportFlow.progress.softwareEncoder")}
        </span>
      </div>
      {phase.notice ? (
        <div role="note" style={{ ...muted, color: "var(--warning)", marginTop: "var(--space-2)" }}>
          {phase.notice}
        </div>
      ) : null}
      <div style={row}>
        <Button variant="ghost" onClick={props.onBackground}>
          {t("exportFlow.progress.runInBackground")}
        </Button>
        <Button variant="secondary" onClick={props.onCancel} disabled={phase.cancelling}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

export function ExportDoneView(props: {
  phase: Phase<"done">;
  copyState: "idle" | "copied" | "path-copied" | "failed";
  onReveal(): void;
  onCopy(): void;
  onExportAnother(): void;
  onClose(): void;
}): ReactElement {
  const { phase } = props;
  const t = useT();
  return (
    <div data-testid="export-done">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            width: "28px",
            height: "28px",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--radius-full)",
            background: "var(--success)",
            color: "var(--on-accent)",
          }}
        >
          ✓
        </span>
        <span style={{ ...text, fontFamily: "var(--font-heading)" }}>
          {t("exportFlow.done.title")}
        </span>
      </div>
      <div
        style={{
          marginTop: "var(--space-4)",
          padding: "var(--space-3)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          background: "var(--bg-sunken)",
        }}
      >
        <div style={{ ...text, wordBreak: "break-all" }}>{phase.fileName}</div>
        <div style={muted}>
          {formatBytes(phase.bytes)} · <span style={{ wordBreak: "break-all" }}>{phase.path}</span>
        </div>
        {phase.sidecars.map((s) => (
          <div key={s} style={muted}>
            {t("exportFlow.done.sidecar", { name: s.split(/[\\/]/).pop() ?? s })}
          </div>
        ))}
      </div>
      {phase.notice ? (
        <div role="note" style={{ ...muted, color: "var(--warning)", marginTop: "var(--space-2)" }}>
          {phase.notice}
        </div>
      ) : null}
      {props.copyState !== "idle" ? (
        <output style={{ ...muted, display: "block", marginTop: "var(--space-2)" }}>
          {props.copyState === "copied"
            ? t("exportFlow.done.copied")
            : props.copyState === "path-copied"
              ? t("exportFlow.done.pathCopied")
              : t("exportFlow.done.copyFailed")}
        </output>
      ) : null}
      <div style={row}>
        <Button variant="secondary" onClick={props.onReveal}>
          {t("exportFlow.action.reveal")}
        </Button>
        <Button variant="secondary" onClick={props.onCopy}>
          {t("exportFlow.action.copy")}
        </Button>
        <Button variant="secondary" onClick={props.onExportAnother}>
          {t("exportFlow.done.exportAnother")}
        </Button>
        <Button variant="primary" onClick={props.onClose}>
          {t("exportFlow.done.done")}
        </Button>
      </div>
    </div>
  );
}

export function ExportProblemView(props: {
  phase: Phase<"failed"> | Phase<"low-disk"> | Phase<"codec-unsupported">;
  diagnosticsCopied: boolean;
  onRetrySoftware(): void;
  onRetry(): void;
  onChooseFolder(): void;
  onCopyDiagnostics(): void;
  onBack(): void;
}): ReactElement {
  const { phase } = props;
  const t = useT();
  const title =
    phase.kind === "low-disk"
      ? t("exportFlow.problem.lowDiskTitle")
      : phase.kind === "codec-unsupported"
        ? t("exportFlow.problem.codecTitle")
        : t("exportFlow.failed");
  return (
    <div data-testid={`export-${phase.kind}`}>
      <div role="alert">
        <div style={{ ...text, fontFamily: "var(--font-heading)", color: "var(--danger)" }}>
          {title}
        </div>
        <div style={{ ...muted, marginTop: "var(--space-2)", wordBreak: "break-word" }}>
          {phase.message}
        </div>
        {phase.kind === "failed" ? (
          <div style={{ ...muted, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>
            {phase.code}
          </div>
        ) : null}
      </div>
      {phase.kind === "failed" && phase.notice ? (
        <div role="note" style={{ ...muted, color: "var(--warning)", marginTop: "var(--space-2)" }}>
          {phase.notice}
        </div>
      ) : null}
      {props.diagnosticsCopied ? (
        <output style={{ ...muted, display: "block", marginTop: "var(--space-2)" }}>
          {t("exportFlow.problem.diagnosticsCopied")}
        </output>
      ) : null}
      <div style={row}>
        <Button variant="ghost" onClick={props.onBack}>
          {t("exportFlow.problem.changeSettings")}
        </Button>
        <Button variant="secondary" onClick={props.onCopyDiagnostics}>
          {t("exportFlow.problem.copyDiagnostics")}
        </Button>
        {phase.kind === "low-disk" ? (
          <>
            <Button variant="secondary" onClick={props.onChooseFolder}>
              {t("exportFlow.problem.chooseFolder")}
            </Button>
            <Button variant="primary" onClick={props.onRetry}>
              {t("exportFlow.problem.tryAgain")}
            </Button>
          </>
        ) : null}
        {(phase.kind === "failed" && phase.canRetrySoftware) ||
        phase.kind === "codec-unsupported" ? (
          <Button variant="primary" onClick={props.onRetrySoftware}>
            {t("exportFlow.problem.retrySoftware")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface ExportToastProps {
  onCancel(): void;
  onReveal(): void;
  onCopy(): void;
  onRetry(): void;
  onDetails(): void;
  onDismiss(): void;
}

/** Toast text for the shared progress state, in the active window language. */
export function toastMessage(s: ExportProgressData): string | null {
  switch (s.activity) {
    case "running":
      return translate("exportFlow.toast.running", {
        percent: Math.round(s.fraction * 100),
        duration: formatDuration(s.etaMs),
      });
    case "done":
      return s.label;
    case "failed":
      return translate("exportFlow.failed");
    default:
      return null;
  }
}

/** S28 progress / success / error toast, bound to {@link useExportProgress}. */
export function ExportToast(props: ExportToastProps): ReactElement | null {
  const state = useExportProgress();
  const t = useT();
  const message = toastMessage(state);
  if (message === null) return null;
  const tone =
    state.activity === "failed"
      ? "var(--danger)"
      : state.activity === "done"
        ? "var(--success)"
        : "var(--accent)";
  return (
    <output
      data-testid="export-toast"
      style={{
        position: "fixed",
        right: "var(--space-4)",
        bottom: "var(--space-4)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-strong)",
        borderLeft: `3px solid ${tone}`,
        background: "var(--bg-panel-raised)",
        ...text,
      }}
    >
      <span>{message}</span>
      {state.activity === "running" ? (
        <Button variant="ghost" onClick={props.onCancel}>
          {t("common.cancel")}
        </Button>
      ) : null}
      {state.activity === "done" ? (
        <>
          <Button variant="ghost" onClick={props.onReveal}>
            {t("exportFlow.action.reveal")}
          </Button>
          <Button variant="ghost" onClick={props.onCopy}>
            {t("exportFlow.action.copy")}
          </Button>
        </>
      ) : null}
      {state.activity === "failed" ? (
        <>
          <Button variant="ghost" onClick={props.onRetry}>
            {t("exportFlow.action.retry")}
          </Button>
          <Button variant="ghost" onClick={props.onDetails}>
            {t("exportFlow.toast.details")}
          </Button>
        </>
      ) : null}
      {state.activity !== "running" ? (
        <Button
          variant="ghost"
          aria-label={t("exportFlow.toast.dismiss")}
          onClick={props.onDismiss}
        >
          ×
        </Button>
      ) : null}
    </output>
  );
}
