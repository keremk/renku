/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InputCardFooter } from "./input-card-footer";

describe("InputCardFooter", () => {
  it("renders label correctly", () => {
    render(<InputCardFooter label="Test Label" />);

    expect(screen.getByText("Test Label")).toBeTruthy();
  });

  it("shows description in title attribute", () => {
    render(
      <InputCardFooter label="Test Label" description="Test description" />
    );

    const label = screen.getByText("Test Label");
    expect(label.getAttribute("title")).toBe("Test description");
  });

  it("uses label as title when no description", () => {
    render(<InputCardFooter label="Test Label" />);

    const label = screen.getByText("Test Label");
    expect(label.getAttribute("title")).toBe("Test Label");
  });

  it("does not show dropdown when disabled", () => {
    render(
      <InputCardFooter
        label="Test Label"
        onExpand={() => {}}
        onEdit={() => {}}
        disabled
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows dropdown trigger when onExpand provided", () => {
    const onExpand = vi.fn();
    render(<InputCardFooter label="Test Label" onExpand={onExpand} />);

    const trigger = screen.getByRole("button");
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("shows dropdown trigger when onEdit provided", () => {
    const onEdit = vi.fn();
    render(<InputCardFooter label="Test Label" onEdit={onEdit} />);

    const trigger = screen.getByRole("button");
    expect(trigger).toBeTruthy();
  });

  it("shows dropdown trigger when canRemove and onRemove provided", () => {
    const onRemove = vi.fn();
    render(
      <InputCardFooter
        label="Test Label"
        onRemove={onRemove}
        canRemove
      />
    );

    const trigger = screen.getByRole("button");
    expect(trigger).toBeTruthy();
  });

  it("does not show dropdown when canRemove is false and no other actions", () => {
    const onRemove = vi.fn();
    render(
      <InputCardFooter
        label="Test Label"
        onRemove={onRemove}
        canRemove={false}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not show dropdown when no actions available", () => {
    render(<InputCardFooter label="Test Label" />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
