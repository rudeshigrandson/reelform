import { useEffect, useState } from "react";

/** M0 launcher shell — proves the IPC bridge + renderer are wired end to end. */
export function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    window.reelform
      ?.invoke("system:ping", undefined)
      .then((r) => setVersion(r.version))
      .catch(() => setVersion("unavailable"));
  }, []);

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: "#0a0a0b",
        color: "#e6e6e8",
        gap: "0.5rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Reelform</h1>
      <p style={{ opacity: 0.6 }}>
        main process: {version === null ? "connecting…" : `v${version}`}
      </p>
    </main>
  );
}
