import { Button, Card, CardMeta, CardTitle, Dialog } from "@design/components";
import { useState } from "react";
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
}

const wrap = {
  width: "100%",
  maxWidth: 480,
  margin: "var(--space-8) auto",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  fontFamily: "var(--font-body)",
  color: "var(--text-1)",
} as const;

/** Spins; with reduce motion it is a static ring that gently fades instead. */
function Spinner() {
  const reduceMotion = usePrefersReducedMotion();
  return (
    <span
      aria-hidden="true"
      data-testid="post-record-spinner"
      data-motion={reduceMotion ? "reduced" : "full"}
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: "var(--radius-full)",
        border: "2px solid var(--border-strong)",
        borderTopColor: "var(--accent)",
        animation: reduceMotion
          ? "reelform-post-fade 1.6s ease-in-out infinite alternate"
          : "reelform-post-spin 900ms linear infinite",
      }}
    >
      <style>
        {
          "@keyframes reelform-post-spin { to { transform: rotate(360deg); } } @keyframes reelform-post-fade { from { opacity: 1; } to { opacity: 0.45; } }"
        }
      </style>
    </span>
  );
}

export function PostRecordCard({
  state,
  onOpenInEditor,
  onReveal,
  onRecordAnother,
  onDelete,
  onRetry,
}: PostRecordCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { phase, error, result, interrupted } = state;

  const interruptedNote = interrupted ? (
    <output
      data-testid="post-record-interrupted"
      style={{ margin: 0, fontSize: 13, color: "var(--warning)" }}
    >
      Recording saved up to {formatElapsed(interrupted.elapsedMs)} — {interrupted.message}
    </output>
  ) : null;

  if (phase === "finalizing" || phase === "creatingProject") {
    return (
      <div style={wrap} data-testid="post-record-processing">
        <Card elevation="md" style={{ padding: "var(--space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Spinner />
            <output>
              <CardTitle>Processing recording…</CardTitle>
              <CardMeta>
                {phase === "finalizing"
                  ? "Finalizing file and extracting cursor data"
                  : "Creating project"}
              </CardMeta>
            </output>
          </div>
          {interruptedNote}
        </Card>
      </div>
    );
  }

  if (phase === "error" && (error?.stage === "finalize" || error?.stage === "create")) {
    return (
      <div style={wrap} data-testid="post-record-error">
        <Card elevation="md" style={{ padding: "var(--space-5)" }}>
          <CardTitle>
            {error.stage === "finalize"
              ? "Couldn't finish the recording"
              : "Couldn't create the project"}
          </CardTitle>
          <p
            role="alert"
            style={{ margin: "var(--space-2) 0", color: "var(--danger)", fontSize: 13 }}
          >
            {error.message}
          </p>
          {interruptedNote}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
            <Button variant="primary" onClick={onRetry}>
              Retry
            </Button>
            <Button variant="ghost" onClick={onRecordAnother}>
              Record another
            </Button>
          </div>
        </Card>
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
      <Card elevation="md" style={{ padding: "var(--space-4)" }}>
        <div
          aria-hidden="true"
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-sunken)",
            marginBottom: "var(--space-3)",
          }}
        />
        <CardTitle>{result.name}</CardTitle>
        <CardMeta>
          <span data-testid="post-record-duration" style={{ fontFamily: "var(--font-mono)" }}>
            {formatElapsed(result.durationMs)}
          </span>
          {result.openedEditor ? <span> · Opened in the editor</span> : null}
        </CardMeta>
        {interruptedNote}
        {actionError ? (
          <p
            role="alert"
            style={{ margin: "var(--space-2) 0 0", color: "var(--danger)", fontSize: 13 }}
          >
            {actionError.message}
          </p>
        ) : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginTop: "var(--space-4)",
          }}
        >
          <Button variant="primary" onClick={onOpenInEditor}>
            Open in editor
          </Button>
          <Button variant="secondary" onClick={onReveal}>
            Reveal file
          </Button>
          <Button variant="ghost" onClick={onRecordAnother}>
            Record another
          </Button>
          <Button variant="danger" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </Card>
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
