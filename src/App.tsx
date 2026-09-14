import { Button } from "@design/components";
import { useEffect, useState } from "react";
import { getAppVersion } from "./app/ipc";
import { useAppStore } from "./app/store";
import { EditorWindow } from "./editor/EditorWindow";
import { ExportDialog } from "./export/ui/ExportDialog";
import { RecordingHud } from "./hud/RecordingHud";
import { Launcher, sampleLauncherProps } from "./launcher/Launcher";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { ProjectBrowser } from "./projects/ProjectBrowser";
import { Settings } from "./settings/Settings";

/**
 * Pre-window-management app shell. A single window switches between the built
 * screens via the store; the real multi-window model (SPEC §2) will replace the
 * dev nav with actual BrowserWindows. The dev nav is a temporary scaffold.
 */
export function App() {
  const s = useAppStore();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAppVersion()
      .then((v) => {
        if (alive && v) setVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Onboarding takes over the whole window.
  if (s.view === "onboarding") {
    return (
      <OnboardingFlow
        permissions={s.permissions}
        onRequestPermission={s.requestPermission}
        defaults={s.defaults}
        onDefaultsChange={s.updateDefaults}
        onFinish={s.finishOnboarding}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <DevNav version={version} />

      {s.view === "projects" && (
        <ProjectBrowser
          projects={s.projects}
          onOpen={s.openProject}
          onNew={s.newRecording}
          onImport={s.newRecording}
          onCardAction={s.cardAction}
        />
      )}

      {s.view === "launcher" && (
        <Launcher
          sources={sampleLauncherProps.sources}
          micDevices={sampleLauncherProps.micDevices}
          webcamDevices={sampleLauncherProps.webcamDevices}
          systemAudioSupported={sampleLauncherProps.systemAudioSupported}
          onStart={s.startRecording}
          onOpenSettings={s.openSettings}
        />
      )}

      {s.view === "editor" && (
        <EditorWindow
          projectName={s.activeProjectName ?? "Untitled Demo"}
          onExport={s.openExport}
        />
      )}

      {s.view === "settings" && <Settings settings={s.settings} onChange={s.updateSettings} />}

      {s.recording && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <RecordingHud
            phase={s.recording.phase}
            elapsedMs={s.recording.elapsedMs}
            micLevel={s.recording.micLevel}
            sourceLabel={s.recording.sourceLabel}
            warning={s.recording.warning}
            onStop={s.stopRecording}
            onPauseToggle={() => {}}
            onDiscard={() => useAppStore.setState({ recording: null })}
          />
        </div>
      )}

      <ExportDialog
        open={s.exportOpen}
        durationMs={92_000}
        phase={s.exportPhase}
        progress={0.4}
        onExport={s.runExport}
        onCancel={s.closeExport}
        onClose={s.closeExport}
        onCancelExport={s.closeExport}
      />
    </div>
  );
}

/** Temporary top-level navigation until the multi-window model lands. */
function DevNav({ version }: { version: string | null }) {
  const navigate = useAppStore((st) => st.navigate);
  const view = useAppStore((st) => st.view);
  const items: Array<{ label: string; to: Parameters<typeof navigate>[0] }> = [
    { label: "Projects", to: "projects" },
    { label: "Launcher", to: "launcher" },
    { label: "Editor", to: "editor" },
    { label: "Settings", to: "settings" },
  ];
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-2) var(--space-4)",
        background: "var(--color-neutral-900)",
        color: "var(--color-neutral-200)",
      }}
    >
      <span style={{ fontFamily: "var(--font-heading)", marginRight: "var(--space-2)" }}>
        Reelform
      </span>
      {items.map((it) => (
        <Button
          key={it.to}
          variant={view === it.to ? "primary" : "ghost"}
          onClick={() => navigate(it.to)}
        >
          {it.label}
        </Button>
      ))}
      <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.6 }}>
        {version ? `main v${version}` : "browser (no bridge)"} · dev nav
      </span>
    </nav>
  );
}
