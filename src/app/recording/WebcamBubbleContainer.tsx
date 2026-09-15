import { Button } from "@design/components";
import { useCallback, useEffect, useRef, useState } from "react";
import { WebcamBubble } from "../../overlays/WebcamBubble";
import type { BubbleShape } from "../../overlays/types";
import type { RecordingBus } from "./bus";
import type { WindowsPort } from "./port";

/**
 * Webcam bubble window container (guide S09, SPEC §5.7): a live
 * `getUserMedia` preview in its own content-protected window (never captured —
 * the webcam is recorded as a separate track). Hover reveals mirror, size
 * (S/M/L), shape and hide. States: starting, live, no camera, access denied,
 * error.
 */

export interface PreviewTrack {
  stop(): void;
}

export interface PreviewStream {
  getTracks(): PreviewTrack[];
}

export interface WebcamPreviewConstraints {
  audio: false;
  video: {
    deviceId?: { exact: string } | undefined;
    width: { ideal: number };
    height: { ideal: number };
  };
}

export type BubbleSize = "S" | "M" | "L";
export const BUBBLE_SIZES: Record<BubbleSize, number> = { S: 120, M: 180, L: 240 };

export type PreviewStatus = "starting" | "live" | "no-camera" | "denied" | "error";

export interface WebcamBubbleContainerProps {
  getUserMedia: (constraints: WebcamPreviewConstraints) => Promise<PreviewStream>;
  /** `undefined` / "" → system default camera. Updated from the bus snapshot. */
  deviceId?: string | undefined;
  bus?: RecordingBus | undefined;
  windows?: Pick<WindowsPort, "closeKind"> | undefined;
  initialSize?: BubbleSize | undefined;
  initialShape?: BubbleShape | undefined;
  initialMirror?: boolean | undefined;
  /** Binds the stream to the `<video>`; defaults to `video.srcObject = stream`. */
  attachStream?: ((video: HTMLVideoElement, stream: PreviewStream | null) => void) | undefined;
}

const defaultAttach = (video: HTMLVideoElement, stream: PreviewStream | null): void => {
  // The app passes real MediaStreams; the structural type keeps tests DOM-free.
  video.srcObject = stream as MediaStream | null;
};

export function previewStatusForError(err: unknown): PreviewStatus {
  const name =
    err && typeof err === "object"
      ? String((err as { name?: unknown; code?: unknown }).name ?? (err as { code?: unknown }).code)
      : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "denied";
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  )
    return "no-camera";
  return "error";
}

const STATUS_COPY: Record<Exclude<PreviewStatus, "live">, string> = {
  starting: "Starting camera…",
  "no-camera": "No camera",
  denied: "Camera access denied",
  error: "Camera unavailable",
};

export function WebcamBubbleContainer({
  getUserMedia,
  deviceId: deviceProp,
  bus,
  windows,
  initialSize = "M",
  initialShape = "circle",
  initialMirror = true,
  attachStream = defaultAttach,
}: WebcamBubbleContainerProps) {
  const [deviceId, setDeviceId] = useState<string | undefined>(deviceProp);
  const [status, setStatus] = useState<PreviewStatus>("starting");
  const [size, setSize] = useState<BubbleSize>(initialSize);
  const [shape, setShape] = useState<BubbleShape>(initialShape);
  const [mirror, setMirror] = useState(initialMirror);
  const [hover, setHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<PreviewStream | null>(null);

  useEffect(() => setDeviceId(deviceProp), [deviceProp]);

  useEffect(() => {
    if (!bus) return;
    const off = bus.subscribe((m) => {
      if (m.type === "snapshot" && m.snapshot?.webcamDeviceId != null) {
        setDeviceId(m.snapshot.webcamDeviceId || undefined);
      }
    });
    bus.post({ type: "snapshotRequest" });
    return off;
  }, [bus]);

  useEffect(() => {
    let cancelled = false;
    setStatus("starting");
    const constraints: WebcamPreviewConstraints = {
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };
    getUserMedia(constraints).then(
      (stream) => {
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        setStatus("live");
      },
      (err: unknown) => {
        if (!cancelled) setStatus(previewStatusForError(err));
      },
    );
    return () => {
      cancelled = true;
      const s = streamRef.current;
      streamRef.current = null;
      if (s) for (const t of s.getTracks()) t.stop();
    };
  }, [getUserMedia, deviceId]);

  // Bind after the <video> mounts for the live state.
  useEffect(() => {
    const video = videoRef.current;
    if (status === "live" && video) attachStream(video, streamRef.current);
  }, [status, attachStream]);

  const hide = useCallback(() => {
    void windows?.closeKind("webcam-bubble").catch(() => {});
  }, [windows]);

  const px = BUBBLE_SIZES[size];

  return (
    <div
      data-testid="webcam-bubble-container"
      data-status={status}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      style={{ position: "fixed", inset: 0 }}
    >
      <WebcamBubble size={px} shape={shape}>
        {status === "live" ? (
          <video
            ref={videoRef}
            data-testid="webcam-video"
            data-mirrored={mirror ? "true" : "false"}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: mirror ? "scaleX(-1)" : "none",
            }}
          />
        ) : (
          <span
            role={status === "starting" ? "status" : "alert"}
            data-testid="webcam-status"
            style={{
              padding: "var(--space-2)",
              textAlign: "center",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              color: status === "denied" ? "var(--danger)" : "var(--text-2)",
            }}
          >
            {STATUS_COPY[status]}
          </span>
        )}
      </WebcamBubble>
      {hover ? (
        <div
          data-testid="webcam-controls"
          style={{
            position: "absolute",
            left: 0,
            top: px + 8,
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-1)",
            padding: "var(--space-1)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border)",
          }}
        >
          <Button
            variant="ghost"
            aria-pressed={mirror}
            aria-label="Mirror"
            onClick={() => setMirror((m) => !m)}
          >
            ⇋
          </Button>
          {(Object.keys(BUBBLE_SIZES) as BubbleSize[]).map((s) => (
            <Button
              key={s}
              variant={s === size ? "secondary" : "ghost"}
              aria-pressed={s === size}
              aria-label={`Size ${s}`}
              onClick={() => setSize(s)}
            >
              {s}
            </Button>
          ))}
          <Button
            variant="ghost"
            aria-label={shape === "circle" ? "Rounded square" : "Circle"}
            onClick={() => setShape((v) => (v === "circle" ? "rounded" : "circle"))}
          >
            {shape === "circle" ? "▢" : "◯"}
          </Button>
          {windows ? (
            <Button variant="ghost" aria-label="Hide preview" onClick={hide}>
              ✕
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
