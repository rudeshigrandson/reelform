import { Button, Dialog } from "@design/components";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { formatElapsed } from "../../hud/RecordingHud";
import { usePrefersReducedMotion } from "../../overlays/reducedMotion";
import type { RecordingFlowState } from "./flow";

/**
 * Post-record transition (guide S11): "Processing recording…" while finalizing
 * and creating the project, then — when the editor did not open automatically —
 * a card with Open in editor / Reveal file / Record another / Delete.
 * Interrupted recordings explain what was kept (§5.6).
 */

export interface PostRecordCardProps {
  state: Pick<RecordingFlowState, "phase" | "error" | "result" | "interrupted" | "elapsedMs">;
  onOpenInEditor: () => void;
  onReveal: () => void;
  onRecordAnother: () => void;
  onDelete: () => void;
  onRetry: () => void;
  /** Processing progress 0..1; omitted → indeterminate bar. */
  progress?: number | undefined;
  /** Poster frame for the card thumbnail; omitted → warm gradient. */
  thumbnailUrl?: string | undefined;
  /** Technical line under the name, e.g. "1512 × 982 · 60 fps · 248 MB". */
  meta?: string | undefined;
}

const dangerText = "color-mix(in srgb, var(--record) 35%, var(--text-1))";

const wrap: CSSProperties = {
  width: "100%",
  margin: "var(--space-8) auto",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-3)",
  fontFamily: "var(--font-body)",
  color: "var(--text-1)",
};

const shell = (width: number): CSSProperties => ({
  boxSizing: "border-box",
  width,
  maxWidth: "100%",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
});

const heading: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)",
  fontSize: 18,
  lineHeight: 1.2,
};

const action: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 13,
  fontWeight: 400,
  padding: "9px 14px",
};

/** `00:42.180` for the thumbnail chip. */
function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  return `${formatElapsed(safe)}.${String(safe % 1000).padStart(3, "0")}`;
}

/** Slides an accent segment along the track; with reduce motion a full bar gently fades instead. */
function ProgressBar({ progress }: { progress: number | undefined }) {
  const reduceMotion = usePrefersReducedMotion();
  const determinate = progress !== undefined && Number.isFinite(progress);
  const pct = determinate ? Math.max(0, Math.min(1, progress)) * 100 : 0;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        height: 4,
        borderRadius: "var(--radius-full)",
        background: "var(--bg-sunken)",
        overflow: "hidden",
      }}
    >
      <span
        data-testid="post-record-spinner"
        data-motion={reduceMotion ? "reduced" : "full"}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          borderRadius: "var(--radius-full)",
          background: "var(--accent)",
          width: determinate ? `${pct}%` : reduceMotion ? "100%" : "40%",
          animation: determinate
            ? undefined
            : reduceMotion
              ? "reelform-post-fade 1.6s ease-in-out infinite alternate"
              : "reelform-post-slide 1.4s ease-in-out infinite",
        }}
      />
      <style>
        {
          "@keyframes reelform-post-slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } } @keyframes reelform-post-fade { from { opacity: 1; } to { opacity: 0.45; } }"
        }
      </style>
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, color: "var(--text-3)" }}>{children}</div>;
}

export function PostRecordCard({
  state,
  onOpenInEditor,
  onReveal,
  onRecordAnother,
  onDelete,
  onRetry,
  progress,
  thumbnailUrl,
  meta,
}: PostRecordCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { phase, error, result, interrupted } = state;

  const interruptedNote = interrupted ? (
    <output
      data-testid="post-record-interrupted"
      style={{ margin: 0, fontSize: 12, color: "var(--warning)" }}
    >
      Recording saved up to{" "}
      <span style={{ fontFamily: "var(--font-mono)" }}>{formatElapsed(interrupted.elapsedMs)}</span>{" "}
      — {interrupted.message}
    </output>
  ) : null;

  if (phase === "finalizing" || phase === "creatingProject") {
    return (
      <div style={wrap} data-testid="post-record-processing">
        <output
          style={{
            ...shell(320),
            padding: 22,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <h2 style={heading}>Processing recording…</h2>
          <ProgressBar progress={progress} />
          <Caption>
            {phase === "finalizing"
              ? "Finalizing file and extracting cursor data"
              : "Creating project"}
          </Caption>
          {interruptedNote}
        </output>
      </div>
    );
  }

  if (phase === "error" && (error?.stage === "finalize" || error?.stage === "create")) {
    return (
      <div style={wrap} data-testid="post-record-error">
        <div
          style={{ ...shell(340), padding: 22, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <h2 style={heading}>
            {error.stage === "finalize"
              ? "Couldn't finish the recording"
              : "Couldn't create the project"}
          </h2>
          <p role="alert" style={{ margin: 0, color: dangerText, fontSize: 12 }}>
            {error.message}
          </p>
          {interruptedNote}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              variant="primary"
              onClick={onRetry}
              style={{ ...action, fontWeight: 600, padding: "9px 18px" }}
            >
              Retry
            </Button>
            <Button
              variant="secondary"
              onClick={onRecordAnother}
              style={{ ...action, background: "var(--bg-panel-raised)" }}
            >
              Record another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (phase !== "done" || !result) return null;

  const actionError =
    error && (error.stage === "reveal" || error.stage === "delete" || error.stage === "openEditor")
      ? error
      : null;

  return (
    <div style={wrap} data-testid="post-record-card">
      <div style={{ ...shell(340), overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            height: 150,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(140deg, color-mix(in srgb, var(--success) 55%, var(--bg-sunken)), color-mix(in srgb, var(--accent) 55%, var(--bg-sunken)))",
          }}
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
          <span
            data-testid="post-record-duration"
            style={{
              position: "absolute",
              right: 12,
              bottom: 10,
              padding: "4px 10px",
              borderRadius: "var(--radius-full)",
              background: "color-mix(in srgb, var(--bg-sunken) 75%, transparent)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatDuration(result.durationMs)}
          </span>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{result.name}</div>
            {meta || result.openedEditor ? (
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                {meta}
                {meta && result.openedEditor ? " · " : null}
                {result.openedEditor ? "Opened in the editor" : null}
              </div>
            ) : null}
          </div>
          {interruptedNote}
          {actionError ? (
            <p role="alert" style={{ margin: 0, color: dangerText, fontSize: 12 }}>
              {actionError.message}
            </p>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              variant="primary"
              onClick={onOpenInEditor}
              style={{ ...action, fontWeight: 600, padding: "9px 18px" }}
            >
              Open in editor
            </Button>
            <Button
              variant="secondary"
              onClick={onReveal}
              style={{ ...action, background: "var(--bg-panel-raised)" }}
            >
              Reveal file
            </Button>
            <Button
              variant="secondary"
              onClick={onRecordAnother}
              style={{ ...action, background: "var(--bg-panel-raised)" }}
            >
              Record another
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              style={{ ...action, color: dangerText }}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this recording?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              Move to Trash
            </Button>
          </>
        }
      >
        The project and its recorded media will be moved to the trash.
      </Dialog>
    </div>
  );
}
