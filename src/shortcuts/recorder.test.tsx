import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsOverlay, ShortcutsOverlayHost } from "./ShortcutsOverlay";
import { ShortcutsProvider } from "./ShortcutsProvider";
import { evaluateRecordedKey, filterShortcuts, groupShortcuts } from "./recorder";
import { resolveShortcuts } from "./registry";

afterEach(cleanup);

const ev = (
  key: string,
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("evaluateRecordedKey", () => {
  const mac = resolveShortcuts("mac");

  it("plain Escape cancels, modifier-only and Tab are ignored", () => {
    expect(evaluateRecordedKey("editor.save", ev("Escape", "Escape"), mac, "mac")).toEqual({
      kind: "cancel",
    });
    expect(
      evaluateRecordedKey("editor.save", ev("Meta", "MetaLeft", { metaKey: true }), mac, "mac")
        .kind,
    ).toBe("ignore");
    expect(evaluateRecordedKey("editor.save", ev("Tab", "Tab"), mac, "mac").kind).toBe("ignore");
  });

  it("modified Escape is a candidate (not a cancel)", () => {
    const r = evaluateRecordedKey(
      "editor.save",
      ev("Escape", "Escape", { shiftKey: true }),
      mac,
      "mac",
    );
    expect(r.kind).toBe("candidate");
  });

  it("detects blocking duplicates in the same scope", () => {
    const r = evaluateRecordedKey("editor.export", ev("s", "KeyS", { metaKey: true }), mac, "mac");
    expect(r).toMatchObject({ kind: "candidate", display: "⌘S", blocking: true, unchanged: false });
    if (r.kind === "candidate")
      expect(r.conflicts[0]?.ids).toEqual(["editor.export", "editor.save"]);
  });

  it("global shortcuts block everywhere", () => {
    const r = evaluateRecordedKey(
      "editor.export",
      ev("r", "KeyR", { metaKey: true, shiftKey: true }),
      mac,
      "mac",
    );
    expect(r).toMatchObject({ kind: "candidate", blocking: true });
  });

  it("global shortcuts need Ctrl/Alt/Cmd unless they are function keys", () => {
    expect(evaluateRecordedKey("record.toggle", ev("r", "KeyR"), mac, "mac")).toMatchObject({
      kind: "invalid",
      display: "R",
    });
    expect(
      evaluateRecordedKey("record.toggle", ev("R", "KeyR", { shiftKey: true }), mac, "mac").kind,
    ).toBe("invalid");
    expect(evaluateRecordedKey("record.toggle", ev("F9", "F9"), mac, "mac").kind).toBe("candidate");
    expect(
      evaluateRecordedKey("record.toggle", ev("9", "Digit9", { altKey: true }), mac, "mac").kind,
    ).toBe("candidate");
    // Editor-scope shortcuts may stay single keys.
    expect(evaluateRecordedKey("editor.playPause", ev("p", "KeyP"), mac, "mac").kind).toBe(
      "candidate",
    );
  });

  it("editor vs timeline is a non-blocking shadow", () => {
    const r = evaluateRecordedKey("timeline.split", ev(" ", "Space"), mac, "mac");
    expect(r).toMatchObject({ kind: "candidate", blocking: false });
    if (r.kind === "candidate") expect(r.conflicts[0]?.kind).toBe("shadow");
  });

  it("flags the current binding as unchanged and uses layout-independent codes", () => {
    expect(
      evaluateRecordedKey("editor.save", ev("s", "KeyS", { metaKey: true }), mac, "mac"),
    ).toMatchObject({ unchanged: true });
    // ⌥E on mac yields a dead key; the physical code still maps to E.
    expect(
      evaluateRecordedKey("editor.export", ev("Dead", "KeyE", { altKey: true }), mac, "mac"),
    ).toMatchObject({ display: "⌥E" });
  });
});

describe("grouping and search", () => {
  const win = resolveShortcuts("win");
  it("groups in Global, Editor, Timeline order", () => {
    expect(groupShortcuts(win).map((g) => g.group)).toEqual(["Global", "Editor", "Timeline"]);
    expect(groupShortcuts(win).flatMap((g) => g.rows)).toHaveLength(win.length);
  });

  it("searches labels, groups and key display, case-insensitively, all terms", () => {
    expect(filterShortcuts(win, "UNDO").map((r) => r.id)).toEqual(["editor.undo"]);
    expect(filterShortcuts(win, "ctrl+shift+z").map((r) => r.id)).toEqual(["editor.redo"]);
    expect(filterShortcuts(win, "timeline delete").map((r) => r.id)).toEqual([
      "timeline.delete",
      "timeline.rippleDelete",
    ]);
    expect(filterShortcuts(win, "   ")).toHaveLength(win.length);
    expect(filterShortcuts(win, "zzz")).toHaveLength(0);
  });
});

describe("ShortcutsOverlay (S25)", () => {
  it("lists grouped shortcuts, filters by search, shows an empty result", () => {
    const onClose = vi.fn();
    const onCustomize = vi.fn();
    render(<ShortcutsOverlay open onClose={onClose} platform="mac" onCustomize={onCustomize} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(dialog).getByRole("region", { name: "Global" })).toBeInTheDocument();
    expect(within(dialog).getByText("⌘Z")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveFocus();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "redo" } });
    expect(within(dialog).queryByText("Undo")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Redo")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing-here" } });
    expect(screen.getByText(/no shortcuts match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Customize…" }));
    expect(onCustomize).toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("uses the provider's overrides and marks unassigned shortcuts", () => {
    render(
      <ShortcutsProvider platform="win" overrides={{ "editor.undo": "", "editor.redo": "Ctrl+Y" }}>
        <ShortcutsOverlay open onClose={() => {}} />
      </ShortcutsProvider>,
    );
    const undoRow = screen.getByText("Undo").closest("li") as HTMLElement;
    expect(undoRow).toHaveTextContent("Unassigned");
    expect(screen.getByText("Ctrl+Y")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ShortcutsOverlay open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the host toggles on ? (Shift+/) through the provider", () => {
    render(
      <ShortcutsProvider platform="mac">
        <ShortcutsOverlayHost />
      </ShortcutsProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "?", code: "Slash", shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
