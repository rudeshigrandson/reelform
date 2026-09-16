import { Button } from "@design/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ProgressTrack, StatusGlyph, ThumbPlaceholder, mono } from "../../export/ui/controls";
import { t as translate, useT } from "../../i18n";
import { formatBytes, formatDuration } from "./config";
import type { ExportFlowPhase } from "./runner";
import { type ExportProgressData, useExportProgress } from "./useExportProgress";

/** S22 exporting / done / failed / low-disk / codec-unsupported panels and the S28 toast. */

type Phase<K extends ExportFlowPhase["kind"]> = Extract<ExportFlowPhase, { kind: K }>;

const heading: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)",
  fontSize: "18px",
  lineHeight: 1.25,
  color: "var(--text-1)",
};
const small: CSSProperties = { fontSize: "11px", color: "var(--text-2)" };
const stack = (gap: number): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: `${gap}px`,
  fontFamily: "var(--font-body)",
  color: "var(--text-1)",
});
const actions: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
};

function Notice({ children }: { children: ReactNode }): ReactElement {
  return (
    <div role="note" style={{ fontSize: "12px", color: "var(--warning)" }}>
      {children}
    </div>
  );
}

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

export function ExportProgressView(props: {
  phase: Phase<"running">;
  onCancel(): void;
  onBackground(): void;
}): ReactElement {
  const { phase } = props;
  const t = useT();
  const p = phase.progress;
  const percent = Math.round((Number.isFinite(p.fraction) ? p.fraction : 0) * 100);
  return (
    <div data-testid="export-progress" style={stack(12)}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div style={heading}>{t("exportFlow.title.running")}</div>
        <span style={{ ...mono, fontSize: "12px", color: "var(--text-2)" }}>
          {t("exportFlow.progress.percent", { percent })}
        </span>
      </div>
      <ProgressTrack fraction={p.fraction} label={t("exportFlow.progress.label")} />
      <div
        style={{
          ...small,
          display: "flex",
          justifyContent: "space-between",
          gap: "8px 12px",
          flexWrap: "wrap",
        }}
      >
        <span data-testid="export-progress-label" style={{ fontVariantNumeric: "tabular-nums" }}>
          {progressHeadline(phase)}
        </span>
        <span style={mono}>
          {p.speed !== null ? (
            <>
              <span data-testid="export-speed">
                {t("exportFlow.progress.speed", { speed: p.speed.toFixed(1) })}
              </span>
              {" · "}
            </>
          ) : null}
          <span data-testid="export-eta">
            {t("exportFlow.progress.timeLeft", { duration: formatDuration(p.etaMs) })}
          </span>
        </span>
      </div>
      <div style={{ ...small, color: "var(--text-3)", display: "flex", gap: "12px" }}>
        <span>
          {p.encoder === "hardware"
            ? t("exportFlow.progress.hardwareEncoder")
            : t("exportFlow.progress.softwareEncoder")}
        </span>
        {phase.estimatedBytes !== null ? (
          <span data-testid="export-estimate" style={mono}>
            {t("exportFlow.progress.estimate", { size: formatBytes(phase.estimatedBytes) })}
          </span>
        ) : null}
      </div>
      {phase.notice ? <Notice>{phase.notice}</Notice> : null}
      <div style={{ ...actions, justifyContent: "flex-end" }}>
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
  /** Mono details after the size, e.g. `1080p60` and the duration timecode. */
  details?: ReadonlyArray<string> | undefined;
  onReveal(): void;
  onCopy(): void;
  onExportAnother(): void;
  onClose(): void;
}): ReactElement {
  const { phase } = props;
  const t = useT();
  const meta = [formatBytes(phase.bytes), ...(props.details ?? [])].join(" · ");
  return (
    <div data-testid="export-done" style={stack(14)}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <StatusGlyph tone="success" />
        <div style={heading}>{t("exportFlow.done.title")}</div>
      </div>
      <div
        style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          padding: "12px",
          borderRadius: "12px",
          background: "var(--bg-panel-raised)",
        }}
      >
        <ThumbPlaceholder width="64px" height="38px" radius="6px" />
        <div style={{ flex: 1, minWidth: 0, fontSize: "12px" }}>
          <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{phase.fileName}</div>
          <div style={{ ...mono, color: "var(--text-3)" }}>{meta}</div>
          <div
            title={phase.path}
            style={{
              ...small,
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {phase.path}
          </div>
          {phase.sidecars.map((s) => (
            <div key={s} style={{ ...small, color: "var(--text-3)" }}>
              {t("exportFlow.done.sidecar", { name: s.split(/[\\/]/).pop() ?? s })}
            </div>
          ))}
        </div>
      </div>
      {phase.notice ? <Notice>{phase.notice}</Notice> : null}
      {props.copyState !== "idle" ? (
        <output style={{ ...small, display: "block" }}>
          {props.copyState === "copied"
            ? t("exportFlow.done.copied")
            : props.copyState === "path-copied"
              ? t("exportFlow.done.pathCopied")
              : t("exportFlow.done.copyFailed")}
        </output>
      ) : null}
      <div style={actions}>
        <Button variant="primary" onClick={props.onReveal}>
          {t("exportFlow.action.reveal")}
        </Button>
        <Button variant="secondary" onClick={props.onCopy}>
          {t("exportFlow.action.copy")}
        </Button>
        <Button variant="ghost" onClick={props.onExportAnother}>
          {t("exportFlow.done.exportAnother")}
        </Button>
        <Button variant="ghost" onClick={props.onClose} style={{ marginLeft: "auto" }}>
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
  const canRetrySoftware =
    (phase.kind === "failed" && phase.canRetrySoftware) || phase.kind === "codec-unsupported";
  return (
    <div data-testid={`export-${phase.kind}`} style={stack(12)}>
      <div role="alert" style={stack(12)}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <StatusGlyph tone="danger" />
          <div style={heading}>{title}</div>
        </div>
        <div
          style={{
            fontSize: "12px",
            color: "color-mix(in srgb, var(--record) 35%, var(--text-1))",
            wordBreak: "break-word",
          }}
        >
          {phase.message}
          {phase.kind === "failed" ? (
            <>
              {" "}
              <span style={mono}>{phase.code}</span>
            </>
          ) : null}
        </div>
      </div>
      {phase.kind === "failed" && phase.notice ? <Notice>{phase.notice}</Notice> : null}
      {props.diagnosticsCopied ? (
        <output style={{ ...small, display: "block" }}>
          {t("exportFlow.problem.diagnosticsCopied")}
        </output>
      ) : null}
      <div style={actions}>
        {canRetrySoftware ? (
          <Button variant="primary" onClick={props.onRetrySoftware}>
            {t("exportFlow.problem.retrySoftware")}
          </Button>
        ) : null}
        {phase.kind === "low-disk" ? (
          <>
            <Button variant="primary" onClick={props.onRetry}>
              {t("exportFlow.problem.tryAgain")}
            </Button>
            <Button variant="secondary" onClick={props.onChooseFolder}>
              {t("exportFlow.problem.chooseFolder")}
            </Button>
          </>
        ) : null}
        <Button variant="secondary" onClick={props.onCopyDiagnostics}>
          {t("exportFlow.problem.copyDiagnostics")}
        </Button>
        <Button variant="ghost" onClick={props.onBack} style={{ marginLeft: "auto" }}>
          {t("exportFlow.problem.changeSettings")}
        </Button>
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
  const percent = Math.round((Number.isFinite(state.fraction) ? state.fraction : 0) * 100);

  const action = (onClick: () => void, label: string, quiet = false): ReactElement => (
    <button
      type="button"
      className={quiet ? "toast-action toast-action-quiet" : "toast-action"}
      onClick={onClick}
    >
      {label}
    </button>
  );

  if (state.activity === "running") {
    return (
      <div className="toast-stack">
        <output
          data-testid="export-toast"
          aria-label={message}
          className="toast"
          style={{ flexDirection: "column", alignItems: "stretch", gap: "8px" }}
        >
          <div style={{ display: "flex", alignItems: "center", fontSize: "12px" }}>
            <span style={{ flex: 1, fontWeight: 600 }}>
              {t("exportFlow.toast.runningTitle", { percent })}
            </span>
            <span style={{ ...mono, color: "var(--text-2)", marginRight: "12px" }}>
              {t("exportFlow.progress.timeLeft", { duration: formatDuration(state.etaMs) })}
            </span>
            {action(props.onCancel, t("common.cancel"))}
          </div>
          <ProgressTrack
            fraction={state.fraction}
            height={3}
            label={t("exportFlow.progress.label")}
          />
        </output>
      </div>
    );
  }

  const done = state.activity === "done";
  const title =
    done && state.fileName !== null
      ? t("exportFlow.toast.exportedTitle", { fileName: state.fileName })
      : message;
  const subtitle = done
    ? state.bytes !== null
      ? formatBytes(state.bytes)
      : null
    : (state.error ?? null);
  return (
    <div className="toast-stack">
      <output
        data-testid="export-toast"
        aria-label={message}
        className={done ? "toast" : "toast toast-danger"}
      >
        <span
          aria-hidden="true"
          className={done ? "toast-icon toast-icon-success" : "toast-icon toast-icon-danger"}
        >
          {done ? "✓" : "!"}
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: "12px" }}>
          <div
            style={{
              fontWeight: 600,
              color: "var(--text-1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          {subtitle ? <div style={{ ...small, wordBreak: "break-word" }}>{subtitle}</div> : null}
        </div>
        {done ? (
          <>
            {action(props.onReveal, t("exportFlow.action.reveal"))}
            {action(props.onCopy, t("exportFlow.action.copy"))}
          </>
        ) : (
          <>
            {action(props.onRetry, t("exportFlow.action.retry"))}
            {action(props.onDetails, t("exportFlow.toast.details"), true)}
          </>
        )}
        <button
          type="button"
          className="toast-action toast-action-quiet"
          aria-label={t("exportFlow.toast.dismiss")}
          onClick={props.onDismiss}
        >
          ×
        </button>
      </output>
    </div>
  );
}
