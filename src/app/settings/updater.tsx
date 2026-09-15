import { Button, Dialog } from "@design/components";
import { useCallback, useEffect, useState } from "react";
import { releaseNotesToText } from "../../settings/releaseNotes";
import type { UpdaterControls } from "../../settings/services";
import type { UpdaterState } from "../../settings/types";
import { invoke, onEvent } from "../ipc";

/**
 * Updater UI (SPEC §11; guide S04 "update available" banner, S27 "Update
 * ready" dialog, S24 Updates page) driven by `updater:status` + `updater:changed`.
 */

export interface UpdaterPort {
  status(): Promise<UpdaterState | null>;
  check(): Promise<UpdaterState | null>;
  restart(): Promise<{ ok: boolean } | null>;
  subscribe(listener: (state: UpdaterState) => void): () => void;
}

export const ipcUpdaterPort: UpdaterPort = {
  status: () => invoke("updater:status", undefined),
  check: () => invoke("updater:check", undefined),
  restart: () => invoke("updater:restart", undefined),
  subscribe: (listener) => onEvent("updater:changed", listener),
};

/** Live updater state + actions; `state` stays null outside Electron. */
export function useUpdater(port: UpdaterPort = ipcUpdaterPort): UpdaterControls {
  const [state, setState] = useState<UpdaterState | null>(null);

  useEffect(() => {
    let live = true;
    const unsubscribe = port.subscribe((next) => {
      if (live) setState(next);
    });
    port.status().then(
      (s) => {
        // A push that already arrived is at least as fresh as the initial read.
        if (live && s) setState((prev) => prev ?? s);
      },
      () => undefined,
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, [port]);

  const check = useCallback(async () => {
    const next = await port.check();
    if (next) setState(next);
  }, [port]);

  const restart = useCallback(async () => {
    const res = await port.restart();
    if (res && !res.ok) throw new Error("Couldn't restart to install the update.");
  }, [port]);

  return { state, check, restart };
}

export interface UpdateBannerProps {
  state: UpdaterState | null;
  onRestart: () => void;
  onShowNotes?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}

/** Launcher strip: "Reelform X is available — Restart to update". Only once downloaded. */
export function UpdateBanner({ state, onRestart, onShowNotes, onDismiss }: UpdateBannerProps) {
  if (!state || state.phase !== "downloaded" || !state.info) return null;
  return (
    <section
      aria-label="Update available"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-4)",
        background: "var(--accent-soft)",
        color: "var(--text-1)",
        borderBottom: "1px solid var(--border)",
        fontSize: "13px",
      }}
    >
      <span style={{ flex: 1 }}>
        Reelform {state.info.version} is available — Restart to update
      </span>
      {onShowNotes ? (
        <Button variant="ghost" onClick={onShowNotes}>
          What's new
        </Button>
      ) : null}
      <Button variant="primary" onClick={onRestart}>
        Restart to update
      </Button>
      {onDismiss ? (
        <Button variant="ghost" aria-label="Dismiss update banner" onClick={onDismiss}>
          Later
        </Button>
      ) : null}
    </section>
  );
}

export interface UpdateReadyDialogProps {
  open: boolean;
  version: string;
  releaseNotes: string | null;
  onRestart: () => void;
  onLater: () => void;
}

/** S27 "Update ready" — sanitized release notes + Restart now / Later. */
export function UpdateReadyDialog({
  open,
  version,
  releaseNotes,
  onRestart,
  onLater,
}: UpdateReadyDialogProps) {
  const lines = releaseNotesToText(releaseNotes);
  return (
    <Dialog
      open={open}
      onClose={onLater}
      title="Update ready"
      actions={
        <>
          <Button variant="ghost" onClick={onLater}>
            Later
          </Button>
          <Button variant="primary" onClick={onRestart}>
            Restart now
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Reelform {version} has been downloaded and installs when you restart.
      </p>
      {lines.length > 0 ? (
        <div
          aria-label="Release notes"
          style={{
            maxHeight: "240px",
            overflowY: "auto",
            padding: "var(--space-3)",
            background: "var(--bg-sunken)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static text lines, never reordered
            <p key={i} style={{ margin: "0 0 var(--space-1)" }}>
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p style={{ color: "var(--text-3)" }}>No release notes were published for this version.</p>
      )}
    </Dialog>
  );
}

/**
 * Banner + dialog for the launcher. "Later" hides the banner for that version
 * in this window; a newer downloaded version shows it again.
 */
export function LauncherUpdateNotice({ updater }: { updater: UpdaterControls }) {
  const { state } = updater;
  const version = state?.info?.version ?? null;
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const restart = () => {
    setRestartError(null);
    updater.restart().catch((err: unknown) => {
      setRestartError(err instanceof Error ? err.message : String(err));
    });
  };

  if (!state || state.phase !== "downloaded" || version === null || dismissedVersion === version) {
    return null;
  }
  return (
    <>
      <UpdateBanner
        state={state}
        onRestart={restart}
        onShowNotes={() => setNotesOpen(true)}
        onDismiss={() => setDismissedVersion(version)}
      />
      {restartError ? (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "var(--space-1) var(--space-4)",
            color: "var(--danger)",
            fontSize: "12px",
          }}
        >
          {restartError}
        </p>
      ) : null}
      <UpdateReadyDialog
        open={notesOpen}
        version={version}
        releaseNotes={state.info?.releaseNotes ?? null}
        onRestart={() => {
          setNotesOpen(false);
          restart();
        }}
        onLater={() => setNotesOpen(false)}
      />
    </>
  );
}
