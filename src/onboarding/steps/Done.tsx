import { Button } from "@design/components";

export interface DoneProps {
  onFinish: () => void;
}

export function Done({ onFinish }: DoneProps) {
  return (
    <section
      aria-labelledby="onboarding-done-title"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "var(--radius-full, 999px)",
          background: "var(--color-accent-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          color: "var(--color-surface)",
        }}
      >
        ✓
      </div>
      <h2
        id="onboarding-done-title"
        style={{
          fontFamily: "var(--font-heading)",
          color: "var(--color-text)",
          fontSize: "1.75rem",
          margin: 0,
        }}
      >
        You're all set
      </h2>
      <p style={{ fontFamily: "var(--font-body)", color: "var(--color-text)", margin: 0 }}>
        Reelform is ready. Let's capture your first recording.
      </p>
      <Button variant="primary" onClick={onFinish}>
        Start recording
      </Button>
    </section>
  );
}
