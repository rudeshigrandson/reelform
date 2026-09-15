import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "../../overlays/Countdown";
import type { RecordingPort } from "../../recording/port";
import type { RecordingBus } from "./bus";
import type { WindowsPort } from "./port";

/**
 * Countdown window container (guide S08, SPEC §5.6/§5.7). Main runs the
 * countdown and emits one `countdown` event per second; this overlay shows it
 * (seeded from the launcher's bus snapshot, since the window opens after the
 * first tick). Esc discards the session in main. The window closes itself when
 * capture starts, the session is discarded, or starting fails.
 */

export interface CountdownContainerProps {
  port: Pick<RecordingPort, "subscribe" | "discard">;
  bus?: RecordingBus | undefined;
  windows?: Pick<WindowsPort, "closeKind"> | undefined;
  sessionId?: string | undefined;
  initialCount?: number | undefined;
}

export function CountdownContainer({
  port,
  bus,
  windows,
  sessionId: initialSession,
  initialCount,
}: CountdownContainerProps) {
  const [count, setCount] = useState<number | null>(initialCount ?? null);
  const [total, setTotal] = useState<number | null>(initialCount ?? null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(initialSession ?? null);

  const close = useCallback(() => {
    setClosed(true);
    void windows?.closeKind("countdown").catch(() => {});
  }, [windows]);

  useEffect(() => {
    const offPort = port.subscribe((e) => {
      if (session.current === null && e.type === "countdown") session.current = e.sessionId;
      if (e.sessionId !== session.current) return;
      switch (e.type) {
        case "countdown":
          setCount(e.remaining);
          setTotal((t) => Math.max(t ?? 0, e.remaining));
          return;
        case "started":
        case "discarded":
        case "error":
          close();
          return;
        default:
          return;
      }
    });
    const offBus = bus?.subscribe((m) => {
      if (m.type !== "snapshot" || !m.snapshot?.sessionId) return;
      const snap = m.snapshot;
      if (session.current === null) session.current = snap.sessionId;
      if (snap.sessionId !== session.current) return;
      if (snap.phase === "countdown" && snap.countdownRemaining !== null) {
        setCount((c) =>
          c === null ? snap.countdownRemaining : Math.min(c, snap.countdownRemaining ?? c),
        );
        if (snap.countdownTotal !== null) setTotal(snap.countdownTotal);
      } else if (snap.phase !== "starting") {
        close();
      }
    });
    bus?.post({ type: "snapshotRequest" });
    return () => {
      offPort();
      offBus?.();
    };
  }, [port, bus, close]);

  const onCancel = useCallback(() => {
    const id = session.current;
    if (!id) {
      close();
      return;
    }
    port.discard(id).then(close, (err: unknown) => {
      const message =
        err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "Couldn't cancel the recording";
      setError(message);
    });
  }, [port, close]);

  if (closed) return null;
  if (count === null) {
    return (
      <div data-testid="countdown-waiting" role="status" style={{ position: "fixed", inset: 0 }} />
    );
  }
  return (
    <>
      <Countdown count={count} total={total ?? undefined} onCancel={onCancel} />
      {error ? (
        <p
          role="alert"
          style={{
            position: "fixed",
            bottom: "var(--space-8)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            margin: 0,
            padding: "var(--space-1) var(--space-3)",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-panel-raised)",
            color: "var(--danger)",
            fontFamily: "var(--font-body)",
            fontSize: 13,
          }}
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
