/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyMediaPlaceholder } from "./empty-media-placeholder";

describe("EmptyMediaPlaceholder", () => {
  it("renders image placeholder correctly", () => {
    const onClick = vi.fn();
    render(<EmptyMediaPlaceholder mediaType="image" onClick={onClick} />);

    expect(screen.getByText("Add image")).toBeTruthy();
  });

  it("renders video placeholder correctly", () => {
    const onClick = vi.fn();
    render(<EmptyMediaPlaceholder mediaType="video" onClick={onClick} />);

    expect(screen.getByText("Add video")).toBeTruthy();
  });

  it("renders audio placeholder correctly", () => {
    const onClick = vi.fn();
    render(<EmptyMediaPlaceholder mediaType="audio" onClick={onClick} />);

    expect(screen.getByText("Add audio")).toBeTruthy();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<EmptyMediaPlaceholder mediaType="image" onClick={onClick} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <EmptyMediaPlaceholder mediaType="image" onClick={onClick} disabled />
    );

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies disabled styling when disabled", () => {
    const onClick = vi.fn();
    render(
      <EmptyMediaPlaceholder mediaType="image" onClick={onClick} disabled />
    );

    const button = screen.getByRole("button");
    expect(button).toHaveProperty("disabled", true);
    expect(button.className).toContain("opacity-50");
  });

  it("applies custom className", () => {
    const onClick = vi.fn();
    render(
      <EmptyMediaPlaceholder
        mediaType="image"
        onClick={onClick}
        className="custom-class"
      />
    );

    const button = screen.getByRole("button");
    expect(button.className).toContain("custom-class");
  });
});
