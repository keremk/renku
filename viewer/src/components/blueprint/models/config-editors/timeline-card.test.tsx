/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TimelineCard, type TimelineConfig } from "./timeline-card";

const TIMELINE_DEFAULTS: TimelineConfig = {
  tracks: ["Video", "Audio", "Music"],
  masterTracks: ["Audio"],
  audioClip: { artifact: "AudioSegments", volume: 1 },
  videoClip: { artifact: "VideoSegments" },
  musicClip: { artifact: "Music", volume: 0.3 },
};

describe("TimelineCard", () => {
  describe("Auto-persist defaults", () => {
    it("calls onChange with defaults when value is undefined and isEditable is true", async () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          isEditable={true}
          onChange={onChange}
        />
      );

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(TIMELINE_DEFAULTS);
      });
    });

    it("does not call onChange when value is undefined but isEditable is false", () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          isEditable={false}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not call onChange when value is already defined", () => {
      const onChange = vi.fn();
      const customConfig: TimelineConfig = {
        tracks: ["Image", "Audio"],
        masterTracks: ["Audio"],
      };

      render(
        <TimelineCard
          value={customConfig}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not call onChange when onChange is undefined", () => {
      const { container } = render(
        <TimelineCard
          value={undefined}
          isEditable={true}
          onChange={undefined}
        />
      );

      expect(container).toBeTruthy();
    });
  });

  describe("Rendering", () => {
    it("renders track badges for configured tracks", () => {
      const { container } = render(
        <TimelineCard
          value={{
            tracks: ["Video", "Audio", "Music"],
            masterTracks: ["Audio"],
          }}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain("Video");
      expect(container.textContent).toContain("Audio");
      expect(container.textContent).toContain("Music");
    });

    it("renders volume summary for clips with volume", () => {
      const { container } = render(
        <TimelineCard
          value={{
            tracks: ["Audio", "Music"],
            masterTracks: ["Audio"],
            audioClip: { artifact: "AudioSegments", volume: 1 },
            musicClip: { artifact: "Music", volume: 0.3 },
          }}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain("Audio: 100%");
      expect(container.textContent).toContain("Music: 30%");
    });

    it("merges partial config with defaults", () => {
      const { container } = render(
        <TimelineCard
          value={{ tracks: ["Image"] }}
          isEditable={false}
        />
      );

      // Should show Image track from value
      expect(container.textContent).toContain("Image");
    });

    it("shows edit button when isEditable is true", () => {
      const { container } = render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={true}
          onChange={vi.fn()}
        />
      );

      expect(container.textContent).toContain("Edit");
    });

    it("hides edit button when isEditable is false", () => {
      const { container } = render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={false}
        />
      );

      const buttons = container.querySelectorAll("button");
      const editButton = Array.from(buttons).find(
        (b) => b.textContent === "Edit"
      );
      expect(editButton).toBeUndefined();
    });

    it("renders the Timeline footer label", () => {
      const { container } = render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain("Timeline");
    });
  });
});
