/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TextInputCard } from "./text-input-card";

describe("TextInputCard", () => {
  const defaultInput = {
    name: "testInput",
    type: "text" as const,
    description: "Test description",
    required: false,
  };

  it("renders input name", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value="Test value"
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("testInput")).toBeTruthy();
  });

  it("displays string value as preview", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value="Hello world"
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("displays number value as string", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value={42}
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("42")).toBeTruthy();
  });

  it("shows placeholder for undefined value", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value={undefined}
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("No content")).toBeTruthy();
  });

  it("shows placeholder for null value", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value={null}
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("No content")).toBeTruthy();
  });

  it("shows placeholder for empty string", () => {
    render(
      <TextInputCard
        input={defaultInput}
        value=""
        onChange={() => {}}
        isEditable={false}
      />
    );

    expect(screen.getByText("No content")).toBeTruthy();
  });

  it("truncates long text in preview", () => {
    const longText = "A".repeat(300);
    render(
      <TextInputCard
        input={defaultInput}
        value={longText}
        onChange={() => {}}
        isEditable={false}
      />
    );

    // Preview should be truncated with ellipsis (200 char limit + ...)
    const preview = screen.getByText(/A{200}\.\.\./);
    expect(preview).toBeTruthy();
  });

  it("opens dialog when card is clicked for editing", async () => {
    render(
      <TextInputCard
        input={defaultInput}
        value="Test value"
        onChange={() => {}}
        isEditable={true}
      />
    );

    // Find and click the card (it's the outer clickable element)
    const previewText = screen.getByText("Test value");
    const cardButton = previewText.closest("button");
    expect(cardButton).toBeTruthy();
    fireEvent.click(cardButton!);

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("calls onChange when dialog saves", async () => {
    const onChange = vi.fn();
    render(
      <TextInputCard
        input={defaultInput}
        value="Initial value"
        onChange={onChange}
        isEditable={true}
      />
    );

    // Open dialog
    const previewText = screen.getByText("Initial value");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Find textarea and modify
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New value" } });

    // Click save
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(onChange).toHaveBeenCalledWith("New value");
  });

  it("does not call onChange when dialog is cancelled", async () => {
    const onChange = vi.fn();
    render(
      <TextInputCard
        input={defaultInput}
        value="Initial value"
        onChange={onChange}
        isEditable={true}
      />
    );

    // Open dialog
    const previewText = screen.getByText("Initial value");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Modify textarea
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "New value" } });

    // Click cancel
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("displays description in dialog header", async () => {
    render(
      <TextInputCard
        input={defaultInput}
        value="Test value"
        onChange={() => {}}
        isEditable={true}
      />
    );

    // Open dialog
    const previewText = screen.getByText("Test value");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    expect(screen.getByText("Test description")).toBeTruthy();
  });

  it("applies default state styling when not selected", () => {
    const { container } = render(
      <TextInputCard
        input={defaultInput}
        value="Test"
        onChange={() => {}}
        isEditable={false}
        isSelected={false}
      />
    );

    // Get the card wrapper
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-border");
  });

  it("applies selected state styling when selected", () => {
    const { container } = render(
      <TextInputCard
        input={defaultInput}
        value="Test"
        onChange={() => {}}
        isEditable={false}
        isSelected={true}
      />
    );

    // Get the card wrapper - MediaCard uses border-primary for selected state
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-primary");
  });
});
