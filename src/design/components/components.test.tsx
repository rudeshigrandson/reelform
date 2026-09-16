import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, Dialog, Segmented, Tag } from "./index";

describe("Button", () => {
  it("applies the variant class and fires onClick", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Record
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Record" });
    expect(btn).toHaveClass("btn", "btn-primary");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("theme-aware variants", () => {
  it("renders the destructive button variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("btn", "btn-danger");
  });

  it("renders the filled destructive variant", () => {
    render(<Button variant="danger-solid">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("btn", "btn-danger-solid");
  });

  it("Dialog tone adds its border class; default adds none", () => {
    const { rerender } = render(
      <Dialog open onClose={() => {}} title="Delete this project?" tone="danger">
        Body
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("dialog", "dialog-danger");
    rerender(
      <Dialog open onClose={() => {}} title="Session restored" tone="success">
        Body
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("dialog-success");
    rerender(
      <Dialog open onClose={() => {}} title="Save changes?">
        Body
      </Dialog>,
    );
    expect(screen.getByRole("dialog").className).toBe("dialog");
  });

  it("Segmented size=sm adds the dense class; default does not", () => {
    const opts = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ] as const;
    const { rerender } = render(
      <Segmented name="s" value="a" options={opts} onChange={() => {}} size="sm" />,
    );
    expect(screen.getByRole("radiogroup")).toHaveClass("seg", "seg-sm");
    rerender(<Segmented name="s" value="a" options={opts} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup")).not.toHaveClass("seg-sm");
  });
});

describe("Segmented", () => {
  it("selects the checked option and reports changes", () => {
    function Harness() {
      const [v, setV] = useState<"auto" | "full" | "half">("auto");
      return (
        <Segmented
          name="quality"
          value={v}
          onChange={setV}
          options={[
            { value: "auto", label: "Auto" },
            { value: "full", label: "Full" },
            { value: "half", label: "Half" },
          ]}
        />
      );
    }
    render(<Harness />);
    const auto = screen.getByRole("radio", { name: "Auto" }) as HTMLInputElement;
    const full = screen.getByRole("radio", { name: "Full" }) as HTMLInputElement;
    expect(auto.checked).toBe(true);
    fireEvent.click(full);
    expect(full.checked).toBe(true);
    expect(auto.checked).toBe(false);
  });
});

describe("Tag", () => {
  it("renders with the variant class", () => {
    render(<Tag variant="accent">New</Tag>);
    expect(screen.getByText("New")).toHaveClass("tag", "tag-accent");
  });
});

describe("Dialog", () => {
  it("renders only when open and closes on Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open={false} onClose={onClose} title="Delete project">
        Are you sure?
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <Dialog open onClose={onClose} title="Delete project">
        Are you sure?
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click but not on panel click", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T">
        Body
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    // backdrop is the dialog's parent
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is labelled by its title; closeLabel adds a ✕ button; focusPanelOnOpen focuses the panel", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="Crop">
        Body
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Crop" })).not.toHaveFocus();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    rerender(
      <Dialog open onClose={onClose} title="Crop" width={420} closeLabel="Close" focusPanelOnOpen>
        Body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Crop" });
    expect(dialog.style.width).toBe("min(420px, 100%)");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focusPanelOnOpen moves focus to the panel on open", () => {
    render(
      <Dialog open onClose={() => {}} title="Crop" focusPanelOnOpen>
        Body
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveFocus();
  });
});
