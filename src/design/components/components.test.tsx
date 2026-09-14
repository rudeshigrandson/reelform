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
});
