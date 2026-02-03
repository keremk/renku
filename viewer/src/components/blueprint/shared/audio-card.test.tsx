/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AudioCard } from "./audio-card";

// Mock HTMLMediaElement methods
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

describe("AudioCard", () => {
  const defaultProps = {
    url: "https://example.com/audio.mp3",
    title: "Test Audio",
    footer: <span>Footer Content</span>,
  };

  it("renders hidden audio element with correct src", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const audio = container.querySelector("audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toBe(defaultProps.url);
  });

  it("renders footer content", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    expect(container.textContent).toContain("Footer Content");
  });

  it("uses preload metadata", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("preload")).toBe("metadata");
  });

  it("sets title attribute for accessibility", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("title")).toBe("Test Audio");
  });

  it("renders play button", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const playButton = container.querySelector('button[aria-label="Play"]');
    expect(playButton).toBeTruthy();
  });

  it("renders mute button", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const muteButton = container.querySelector('button[aria-label="Mute"]');
    expect(muteButton).toBeTruthy();
  });

  it("calls play when play button clicked", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const playButton = container.querySelector('button[aria-label="Play"]');
    expect(playButton).toBeTruthy();

    fireEvent.click(playButton!);
    // Verify play was called on the audio element
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("applies selected styling when isSelected=true", () => {
    const { container } = render(<AudioCard {...defaultProps} isSelected={true} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-primary");
  });

  it("applies default styling when isSelected=false", () => {
    const { container } = render(<AudioCard {...defaultProps} isSelected={false} />);
    const card = container.querySelector(".rounded-xl");
    expect(card?.className).toContain("border-border");
  });

  it("renders waveform visualization bars", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const waveformBars = container.querySelectorAll(".rounded-full.w-1");
    expect(waveformBars.length).toBe(32);
  });

  it("renders progress bar", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    const progressBar = container.querySelector(".cursor-pointer.group");
    expect(progressBar).toBeTruthy();
  });

  it("displays time in correct format", () => {
    const { container } = render(<AudioCard {...defaultProps} />);
    // Initial state should show 0:00
    expect(container.textContent).toContain("0:00");
  });
});
