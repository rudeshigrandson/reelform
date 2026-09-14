import { Button } from "@design/components";

export interface WelcomeProps {
  onNext: () => void;
}

export function Welcome({ onNext }: WelcomeProps) {
  return (
    <section
      aria-labelledby="onboarding-welcome-title"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
    >
      <h1
        id="onboarding-welcome-title"
        style={{
          fontFamily: "var(--font-heading)",
          color: "var(--accent)",
          fontSize: "2.5rem",
          margin: 0,
        }}
      >
        Reelform
      </h1>
      <p
        style={{
          fontFamily: "var(--font-body)",
          color: "var(--text-1)",
          fontSize: "1.125rem",
          margin: 0,
        }}
      >
        Record your screen and turn it into a polished demo video.
      </p>
      <Button variant="primary" onClick={onNext}>
        Get started
      </Button>
    </section>
  );
}
