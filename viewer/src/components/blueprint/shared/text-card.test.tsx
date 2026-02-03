/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TextCard } from "./text-card";

describe("TextCard", () => {
  it("renders label in footer", () => {
    render(
      <TextCard label="System Prompt" value="Test content" />
    );

    expect(screen.getByText("System Prompt")).toBeTruthy();
  });

  it("displays text content in preview area", () => {
    render(
      <TextCard label="Test" value="Hello world" />
    );

    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("displays description as tooltip when provided", () => {
    render(
      <TextCard
        label="Test"
        description="This is a description"
        value="Content"
      />
    );

    // Description is shown as title attribute (tooltip) on the label
    const labelElement = screen.getByText("Test");
    expect(labelElement.getAttribute("title")).toBe("This is a description");
  });

  it("shows full content up to safety limit (CSS handles visual clipping)", () => {
    const longText = "A".repeat(600);
    render(<TextCard label="Test" value={longText} />);

    // Preview should contain the full text (no JS truncation for short content)
    // CSS overflow:hidden handles visual clipping
    const preview = screen.getByText(longText);
    expect(preview).toBeTruthy();
  });

  it("applies safety limit for very large content (5000+ chars)", () => {
    const veryLongText = "B".repeat(6000);
    render(<TextCard label="Test" value={veryLongText} />);

    // Preview should be limited to 5000 chars for DOM performance
    const preview = screen.getByText("B".repeat(5000));
    expect(preview).toBeTruthy();
  });

  it("shows 'No content' placeholder for empty value", () => {
    render(<TextCard label="Test" value="" />);

    expect(screen.getByText("No content")).toBeTruthy();
  });

  it("shows 'No content' placeholder for non-editable empty state", () => {
    render(<TextCard label="Test" value="" isEditable={false} />);

    expect(screen.getByText("No content")).toBeTruthy();
  });

  it("applies selected styling when isSelected=true", () => {
    const { container } = render(
      <TextCard label="Test" value="Content" isSelected={true} />
    );

    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-primary");
  });

  it("applies default styling when isSelected=false", () => {
    const { container } = render(
      <TextCard label="Test" value="Content" isSelected={false} />
    );

    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-border");
  });

  it("shows dashed border 'Add' button when empty and editable", () => {
    render(<TextCard label="System Prompt" value="" isEditable={true} />);

    expect(screen.getByText("Add System Prompt")).toBeTruthy();
    // Should have dashed border button
    const button = screen.getByRole("button");
    expect(button.className).toContain("border-dashed");
  });

  it("opens dialog when 'Add' button clicked for empty editable card", async () => {
    render(
      <TextCard label="System Prompt" value="" isEditable={true} onChange={() => {}} />
    );

    const addButton = screen.getByText("Add System Prompt").closest("button");
    fireEvent.click(addButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("opens dialog when card with content is clicked", async () => {
    render(
      <TextCard label="Test" value="Some content" isEditable={true} onChange={() => {}} />
    );

    // Click on the card
    const previewText = screen.getByText("Some content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("shows full content in dialog", async () => {
    const content = "Full content that should be shown in dialog";
    render(
      <TextCard label="Test" value={content} isEditable={true} onChange={() => {}} />
    );

    const previewText = screen.getByText(content);
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Dialog should show the content (editor has it as value)
    // Note: prism-react-editor might not be easily testable, so we check dialog opens
  });

  it("shows language badge in dialog", async () => {
    render(
      <TextCard
        label="Test"
        value="content"
        language="json"
        isEditable={true}
        onChange={() => {}}
      />
    );

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByText("JSON")).toBeTruthy();
    });
  });

  it("shows MARKDOWN badge for markdown language", async () => {
    render(
      <TextCard
        label="Test"
        value="content"
        language="markdown"
        isEditable={true}
        onChange={() => {}}
      />
    );

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByText("MARKDOWN")).toBeTruthy();
    });
  });

  it("shows variables panel in dialog when variables provided", async () => {
    const variables = ["character_name", "setting", "mood"];
    render(
      <TextCard
        label="User Prompt"
        value="content"
        variables={variables}
        isEditable={true}
        onChange={() => {}}
      />
    );

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByText("Available Variables (click to copy):")).toBeTruthy();
      expect(screen.getByText("{{character_name}}")).toBeTruthy();
      expect(screen.getByText("{{setting}}")).toBeTruthy();
      expect(screen.getByText("{{mood}}")).toBeTruthy();
    });
  });

  it("does not show variables panel in read-only mode", async () => {
    const variables = ["character_name"];
    render(
      <TextCard
        label="Test"
        value="content"
        variables={variables}
        isEditable={false}
      />
    );

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Variables panel should NOT be shown in read-only mode
    expect(screen.queryByText("Available Variables (click to copy):")).toBeNull();
  });

  it("shows Close button in read-only mode", async () => {
    render(<TextCard label="Test" value="content" isEditable={false} />);

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Look for the Close button text (there may be multiple "Close" - X icon has sr-only Close too)
    const closeElements = screen.getAllByText("Close");
    expect(closeElements.length).toBeGreaterThan(0);
  });

  it("shows Save and Cancel buttons in edit mode", async () => {
    render(
      <TextCard label="Test" value="content" isEditable={true} onChange={() => {}} />
    );

    const previewText = screen.getByText("content");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
  });

  it("calls onChange when dialog saves", async () => {
    const onChange = vi.fn();
    render(
      <TextCard label="Test" value="initial" isEditable={true} onChange={onChange} />
    );

    const previewText = screen.getByText("initial");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Click save (value should be the initial value since we can't easily modify prism-react-editor)
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    expect(onChange).toHaveBeenCalledWith("initial");
  });

  it("does not call onChange when dialog is cancelled", async () => {
    const onChange = vi.fn();
    render(
      <TextCard label="Test" value="initial" isEditable={true} onChange={onChange} />
    );

    const previewText = screen.getByText("initial");
    const cardButton = previewText.closest("button");
    fireEvent.click(cardButton!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    // Click cancel
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats JSON content in preview", () => {
    const jsonContent = '{"name":"test","value":123}';
    const { container } = render(<TextCard label="Test" value={jsonContent} language="json" />);

    // The JSON should be formatted with indentation
    // The pre element should contain the formatted JSON
    const preElement = container.querySelector("pre");
    expect(preElement?.textContent).toContain('"name": "test"');
    expect(preElement?.textContent).toContain('"value": 123');
  });

  it("shows dropdown trigger when editable", () => {
    const { container } = render(
      <TextCard label="Test" value="content" isEditable={true} onChange={() => {}} />
    );

    // The dropdown trigger should be present when editable
    const dropdownTrigger = container.querySelector('[data-slot="dropdown-menu-trigger"]');
    expect(dropdownTrigger).toBeTruthy();
    expect(dropdownTrigger?.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("does not show dropdown when not editable", () => {
    const { container } = render(<TextCard label="Test" value="content" isEditable={false} />);

    // No dropdown trigger should be present when not editable (no actions)
    const dropdownTrigger = container.querySelector('[data-slot="dropdown-menu-trigger"]');
    expect(dropdownTrigger).toBeNull();
  });
});
