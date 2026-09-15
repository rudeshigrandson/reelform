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
          borderRadius: "var(--radius-full)",
          background: "var(--success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          color: "var(--on-accent)",
        }}
      >
        ✓
      </div>
      <h2 id="onboarding-done-title" style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
        You're all set
      </h2>
      <p style={{ color: "var(--text-2)", margin: 0 }}>
        Reelform is ready. You can change these any time in Settings.
      </p>
      <Button variant="primary" onClick={onFinish}>
        Start recording
      </Button>
    </section>
  );
}
