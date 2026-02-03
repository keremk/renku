/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VideoCard } from "./video-card";

describe("VideoCard", () => {
  const defaultProps = {
    url: "https://example.com/video.mp4",
    title: "Test Video",
    footer: <span>Footer Content</span>,
  };

  it("renders video element with correct src", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toBe(defaultProps.url);
  });

  it("renders footer content", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    expect(container.textContent).toContain("Footer Content");
  });

  it("renders video controls", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const video = container.querySelector("video");
    expect(video?.hasAttribute("controls")).toBe(true);
  });

  it("uses preload metadata", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const video = container.querySelector("video");
    expect(video?.getAttribute("preload")).toBe("metadata");
  });

  it("applies selected styling when isSelected=true", () => {
    const { container } = render(<VideoCard {...defaultProps} isSelected={true} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-primary");
  });

  it("applies default styling when isSelected=false", () => {
    const { container } = render(<VideoCard {...defaultProps} isSelected={false} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-border");
  });

  it("uses aspect-video container", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const aspectContainer = container.querySelector(".aspect-video");
    expect(aspectContainer).toBeTruthy();
  });

  it("uses theme-aware background", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const aspectContainer = container.querySelector(".aspect-video");
    expect(aspectContainer?.className).toContain("bg-muted/50");
  });

  it("video has object-contain class for proper scaling", () => {
    const { container } = render(<VideoCard {...defaultProps} />);
    const video = container.querySelector("video");
    expect(video?.className).toContain("object-contain");
  });
});
