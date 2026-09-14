import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CaptionsInspector } from "./CaptionsInspector";
import type { CaptionsInspectorProps } from "./CaptionsInspector";
import { DEFAULT_CAPTION_STYLE, IDLE_STATUS } from "./types";
import type { Caption, CaptionStyle } from "./types";

const cap = (id: string, startMs: number, endMs: number, text: string): Caption => ({
  id,
  startMs,
  endMs,
  text,
  words: [],
});

const SAMPLE: Caption[] = [
  cap("a", 1000, 2000, "hello world"),
  cap("b", 3000, 4000, "second line"),
];

function baseProps(overrides: Partial<CaptionsInspectorProps> = {}): CaptionsInspectorProps {
  return {
    captions: [],
    onCaptionsChange: vi.fn(),
    style: DEFAULT_CAPTION_STYLE,
    onStyleChange: vi.fn(),
    status: IDLE_STATUS,
    modelDownloaded: true,
    model: "balanced",
    onModelChange: vi.fn(),
    language: "auto",
    onLanguageChange: vi.fn(),
    onGenerate: vi.fn(),
    onDownloadModel: vi.fn(),
    onSeek: vi.fn(),
    currentMs: 0,
    burnIn: false,
    onBurnInChange: vi.fn(),
    onExportSrt: vi.fn(),
    onExportVtt: vi.fn(),
    ...overrides,
  };
}

/** Stateful harness so split/merge re-render with the new list. */
function Harness(props: { initial: Caption[]; onChange?: (c: Caption[]) => void }): ReactElement {
  const [captions, setCaptions] = useState<Caption[]>(props.initial);
  return (
    <CaptionsInspector
      {...baseProps({
        captions,
        currentMs: 99_000,
        onCaptionsChange: (c) => {
          setCaptions(c);
          props.onChange?.(c);
        },
      })}
    />
  );
}

const rows = (): HTMLTextAreaElement[] =>
  within(screen.getByRole("list", { name: "Caption list" })).getAllByRole(
    "textbox",
  ) as HTMLTextAreaElement[];

describe("CaptionsInspector — states", () => {
  it("empty: shows empty state, generate button and privacy line", () => {
    const props = baseProps();
    render(<CaptionsInspector {...props} />);
    expect(screen.getByText("No captions yet")).toBeInTheDocument();
    expect(screen.getByText("Runs on-device. Nothing leaves your computer.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate captions" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Export .srt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export .vtt" })).toBeDisabled();
  });

  it("model not downloaded: offers a sized download instead of generate", () => {
    const props = baseProps({ modelDownloaded: false, model: "accurate" });
    render(<CaptionsInspector {...props} />);
    expect(screen.queryByRole("button", { name: "Generate captions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Download (1.5 GB)" }));
    expect(props.onDownloadModel).toHaveBeenCalledTimes(1);
  });

  it("model downloading: shows progress and locks selects", () => {
    render(
      <CaptionsInspector
        {...baseProps({ modelDownloaded: false, status: { kind: "downloading", progress: 0.42 } })}
      />,
    );
    expect(screen.getByText(/Downloading Balanced model 42%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Model download" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Download \(/ })).toBeNull();
  });

  it("generating: shows 'Transcribing 34%… 00:14/00:42'", () => {
    render(
      <CaptionsInspector
        {...baseProps({
          status: { kind: "transcribing", progress: 0.34, doneMs: 14_000, totalMs: 42_000 },
        })}
      />,
    );
    const status = screen.getByText(/Transcribing/);
    expect(status.textContent).toBe("Transcribing 34%… 00:14/00:42");
    expect(screen.getByRole("progressbar", { name: "Transcription" })).toHaveAttribute(
      "aria-valuenow",
      "34",
    );
    expect(screen.queryByRole("button", { name: "Generate captions" })).toBeNull();
    expect(screen.queryByText("No captions yet")).toBeNull();
  });

  it("clamps out-of-range progress", () => {
    render(
      <CaptionsInspector {...baseProps({ status: { kind: "downloading", progress: 1.7 } })} />,
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("error: shows message and retry", () => {
    const props = baseProps({
      status: { kind: "error", message: "Couldn't transcribe — no speech detected" },
    });
    render(<CaptionsInspector {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't transcribe — no speech detected");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it("list populated: rows show mono time ranges, click seeks, active row marked", () => {
    const props = baseProps({ captions: SAMPLE, currentMs: 3500 });
    render(<CaptionsInspector {...props} />);
    expect(screen.getByText("00:01.0 – 00:02.0")).toBeInTheDocument();
    expect(rows().map((r) => r.value)).toEqual(["hello world", "second line"]);
    fireEvent.click(screen.getByText("00:03.0 – 00:04.0"));
    expect(props.onSeek).toHaveBeenCalledWith(3000);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[1]).toHaveAttribute("data-active", "true");
    expect(items[0]).not.toHaveAttribute("data-active");
    expect(screen.getByRole("button", { name: "Export .srt" })).toBeEnabled();
  });

  it("editing a row: focus marks it, typing updates text", () => {
    const props = baseProps({ captions: SAMPLE });
    render(<CaptionsInspector {...props} />);
    const first = rows()[0]!;
    fireEvent.focus(first);
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0]).toHaveAttribute(
      "data-editing",
      "true",
    );
    fireEvent.change(first, { target: { value: "hello there" } });
    expect(props.onCaptionsChange).toHaveBeenCalledWith([
      { ...SAMPLE[0], text: "hello there" },
      SAMPLE[1],
    ]);
  });
});

describe("CaptionsInspector — keyboard", () => {
  it("Enter splits at the caret and focuses the new row", () => {
    const onChange = vi.fn();
    render(<Harness initial={[cap("a", 0, 1100, "hello world")]} onChange={onChange} />);
    const input = rows()[0]!;
    act(() => input.focus());
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rows().map((r) => r.value)).toEqual(["hello", "world"]);
    const [, second] = rows();
    expect(document.activeElement).toBe(second);
    expect(second!.selectionStart).toBe(0);
    expect(onChange.mock.calls[0]![0][0].endMs).toBe(600);
  });

  it("Shift+Enter does not split; Enter with a selection or at the end does nothing", () => {
    const onChange = vi.fn();
    render(<Harness initial={[cap("a", 0, 1000, "hello world")]} onChange={onChange} />);
    const input = rows()[0]!;
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    input.setSelectionRange(2, 7);
    fireEvent.keyDown(input, { key: "Enter" });
    input.setSelectionRange(11, 11);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Backspace at start merges into the previous row with caret at the join", () => {
    render(<Harness initial={[cap("a", 0, 1000, "hello"), cap("b", 1000, 2000, "world")]} />);
    const second = rows()[1]!;
    act(() => second.focus());
    second.setSelectionRange(0, 0);
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(rows().map((r) => r.value)).toEqual(["hello world"]);
    const merged = rows()[0]!;
    expect(document.activeElement).toBe(merged);
    expect(merged.selectionStart).toBe(6);
  });

  it("Backspace elsewhere, on the first row, or while searching does not merge", () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={[cap("a", 0, 1000, "hello"), cap("b", 1000, 2000, "world")]}
        onChange={onChange}
      />,
    );
    const [first, second] = rows();
    second!.setSelectionRange(2, 2);
    fireEvent.keyDown(second!, { key: "Backspace" });
    first!.setSelectionRange(0, 0);
    fireEvent.keyDown(first!, { key: "Backspace" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search captions" }), {
      target: { value: "o" },
    });
    const filteredSecond = rows()[1]!;
    filteredSecond.setSelectionRange(0, 0);
    fireEvent.keyDown(filteredSecond, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("split then merge round-trips through the UI", () => {
    render(<Harness initial={[cap("a", 0, 1000, "one two")]} />);
    const input = rows()[0]!;
    input.setSelectionRange(4, 4);
    fireEvent.keyDown(input, { key: "Enter" });
    const second = rows()[1]!;
    second.setSelectionRange(0, 0);
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(rows().map((r) => r.value)).toEqual(["one two"]);
  });
});

describe("CaptionsInspector — search & add", () => {
  it("filters rows and shows a no-match message", () => {
    render(<CaptionsInspector {...baseProps({ captions: SAMPLE })} />);
    const search = screen.getByRole("searchbox", { name: "Search captions" });
    fireEvent.change(search, { target: { value: "SECOND" } });
    expect(rows().map((r) => r.value)).toEqual(["second line"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/No captions match/)).toBeInTheDocument();
  });

  it("adds a caption at the playhead and focuses it", () => {
    render(<Harness initial={SAMPLE} />);
    // Harness playhead is 99s — open space after the last caption.
    fireEvent.click(screen.getByRole("button", { name: "Add caption" }));
    expect(rows()).toHaveLength(3);
    expect(document.activeElement).toBe(rows()[2]);
    expect(screen.getByText("01:39.0 – 01:41.0")).toBeInTheDocument();
  });

  it("disables Add caption when the playhead is inside a caption or at the end", () => {
    const { rerender } = render(
      <CaptionsInspector {...baseProps({ captions: SAMPLE, currentMs: 1500 })} />,
    );
    expect(screen.getByRole("button", { name: "Add caption" })).toBeDisabled();
    rerender(
      <CaptionsInspector {...baseProps({ captions: SAMPLE, currentMs: 5000, durationMs: 5000 })} />,
    );
    expect(screen.getByRole("button", { name: "Add caption" })).toBeDisabled();
    rerender(<CaptionsInspector {...baseProps({ captions: SAMPLE, currentMs: 2000 })} />);
    expect(screen.getByRole("button", { name: "Add caption" })).toBeEnabled();
  });
});

describe("CaptionsInspector — generate controls, style, export", () => {
  it("reports language and model changes", () => {
    const props = baseProps();
    render(<CaptionsInspector {...props} />);
    expect(screen.getByRole("option", { name: "Balanced · 466 MB" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Fast · 75 MB" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "fast" } });
    expect(props.onModelChange).toHaveBeenCalledWith("fast");
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ja" } });
    expect(props.onLanguageChange).toHaveBeenCalledWith("ja");
  });

  function StyleHarness({ spy }: { spy: (s: CaptionStyle) => void }): ReactElement {
    const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
    return (
      <CaptionsInspector
        {...baseProps({
          style,
          onStyleChange: (s) => {
            setStyle(s);
            spy(s);
          },
        })}
      />
    );
  }

  it("preset chips apply preset fields", () => {
    const spy = vi.fn();
    render(<StyleHarness spy={spy} />);
    const karaoke = screen.getByRole("radio", { name: "Karaoke" });
    fireEvent.click(karaoke);
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: "karaoke", wordHighlight: true }),
    );
    expect(karaoke).toHaveAttribute("aria-checked", "true");
    // Word highlight on → highlight color control appears.
    expect(screen.getByLabelText("Highlight")).toBeInTheDocument();
  });

  it("position Custom Y reveals the Y slider; uppercase and max lines update style", () => {
    const spy = vi.fn();
    render(<StyleHarness spy={spy} />);
    expect(screen.queryByLabelText("Y")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Custom Y" }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ position: "custom" }));
    fireEvent.change(screen.getByLabelText("Y"), { target: { value: "30" } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ customY: 30 }));
    fireEvent.click(screen.getByRole("switch", { name: "Uppercase" }));
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ uppercase: true }));
    fireEvent.change(screen.getByLabelText("Max lines"), { target: { value: "9" } });
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ maxLines: 3 }));
  });

  it("font select changes font; 'Add custom font…' calls back without changing font", () => {
    const onAddCustomFont = vi.fn();
    const props = baseProps({ onAddCustomFont, fonts: ["Inter", "Arial"] });
    render(<CaptionsInspector {...props} />);
    const font = screen.getByLabelText("Font");
    fireEvent.change(font, { target: { value: "Arial" } });
    expect(props.onStyleChange).toHaveBeenCalledWith(expect.objectContaining({ font: "Arial" }));
    fireEvent.change(font, { target: { value: "__add-custom-font__" } });
    expect(onAddCustomFont).toHaveBeenCalledTimes(1);
    expect(props.onStyleChange).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown current font selectable and hides custom-font option without handler", () => {
    render(
      <CaptionsInspector
        {...baseProps({ style: { ...DEFAULT_CAPTION_STYLE, font: "Comic Neue" } })}
      />,
    );
    expect(screen.getByLabelText("Font")).toHaveValue("Comic Neue");
    expect(screen.queryByRole("option", { name: "Add custom font…" })).toBeNull();
  });

  it("burn-in switch and sidecar export buttons", () => {
    const props = baseProps({ captions: SAMPLE });
    render(<CaptionsInspector {...props} />);
    fireEvent.click(screen.getByRole("switch", { name: "Burn into video" }));
    expect(props.onBurnInChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Export .srt" }));
    fireEvent.click(screen.getByRole("button", { name: "Export .vtt" }));
    expect(props.onExportSrt).toHaveBeenCalledTimes(1);
    expect(props.onExportVtt).toHaveBeenCalledTimes(1);
  });

  it("export disabled when all captions are blank", () => {
    render(<CaptionsInspector {...baseProps({ captions: [cap("a", 0, 1000, "  ")] })} />);
    expect(screen.getByRole("button", { name: "Export .srt" })).toBeDisabled();
  });
});
