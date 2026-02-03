/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImageCard } from "./image-card";

describe("ImageCard", () => {
  const defaultProps = {
    url: "https://example.com/image.png",
    title: "Test Image",
    footer: <span>Footer Content</span>,
  };

  it("renders image element with correct src", () => {
    render(<ImageCard {...defaultProps} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe(defaultProps.url);
  });

  it("sets alt text from title prop", () => {
    render(<ImageCard {...defaultProps} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("alt")).toBe("Test Image");
  });

  it("renders footer content", () => {
    const { container } = render(<ImageCard {...defaultProps} />);
    expect(container.textContent).toContain("Footer Content");
  });

  it("uses lazy loading", () => {
    render(<ImageCard {...defaultProps} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("image is wrapped in clickable button", () => {
    const { container } = render(<ImageCard {...defaultProps} />);
    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    const img = button?.querySelector("img");
    expect(img).toBeTruthy();
  });

  it("opens expand dialog when clicked", async () => {
    render(<ImageCard {...defaultProps} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  it("has expand icon with opacity-0 (shows on hover via CSS)", () => {
    const { container } = render(<ImageCard {...defaultProps} />);
    const icon = container.querySelector(".opacity-0");
    expect(icon).toBeTruthy();
  });

  it("applies selected styling when isSelected=true", () => {
    const { container } = render(<ImageCard {...defaultProps} isSelected={true} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-primary");
  });

  it("applies default styling when isSelected=false", () => {
    const { container } = render(<ImageCard {...defaultProps} isSelected={false} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-border");
  });

  it("expand dialog shows correct title", async () => {
    render(<ImageCard {...defaultProps} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText("Test Image")).toBeTruthy();
    });
  });

  it("uses theme-aware background", () => {
    const { container } = render(<ImageCard {...defaultProps} />);
    const button = container.querySelector("button.aspect-video");
    expect(button?.className).toContain("bg-muted/50");
  });

  it("image has object-contain class for proper scaling", () => {
    render(<ImageCard {...defaultProps} />);
    const img = screen.getByRole("img");
    expect(img.className).toContain("object-contain");
  });
});
