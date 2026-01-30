/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TextEditDialog } from "./text-edit-dialog";

describe("TextEditDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    label: "Test Label",
    value: "Initial value",
    onSave: vi.fn(),
  };

  it("renders when open", () => {
    render(<TextEditDialog {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Test Label")).toBeTruthy();
  });

  it("does not render when closed", () => {
    render(<TextEditDialog {...defaultProps} open={false} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("displays description when provided", () => {
    render(
      <TextEditDialog {...defaultProps} description="Test description" />
    );

    expect(screen.getByText("Test description")).toBeTruthy();
  });

  it("initializes textarea with value", () => {
    render(<TextEditDialog {...defaultProps} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Initial value");
  });

  it("calls onSave with edited value when Save clicked", () => {
    const onSave = vi.fn();
    render(<TextEditDialog {...defaultProps} onSave={onSave} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New value" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith("New value");
  });

  it("calls onOpenChange(false) when Save clicked", () => {
    const onOpenChange = vi.fn();
    render(<TextEditDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not call onSave when Cancel clicked", () => {
    const onSave = vi.fn();
    render(<TextEditDialog {...defaultProps} onSave={onSave} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New value" } });

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) when Cancel clicked", () => {
    const onOpenChange = vi.fn();
    render(<TextEditDialog {...defaultProps} onOpenChange={onOpenChange} />);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows placeholder in textarea", () => {
    render(<TextEditDialog {...defaultProps} value="" />);

    const textarea = screen.getByPlaceholderText("Enter Test Label...");
    expect(textarea).toBeTruthy();
  });

  it("allows editing text content", () => {
    render(<TextEditDialog {...defaultProps} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Completely new content" } });

    expect(textarea.value).toBe("Completely new content");
  });
});
