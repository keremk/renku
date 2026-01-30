/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaInputCard, AddMediaCard } from "./media-input-card";

describe("MediaInputCard", () => {
  const defaultInput = {
    name: "testImage",
    type: "image" as const,
    description: "Test image input",
    required: false,
  };

  const defaultProps = {
    input: defaultInput,
    value: undefined,
    onChange: vi.fn(),
    isEditable: true,
    blueprintFolder: "/path/to/blueprint",
    movieId: "test-movie-id",
  };

  describe("when value is empty", () => {
    it("renders empty placeholder for image", () => {
      render(<MediaInputCard {...defaultProps} />);

      expect(screen.getByText("Add image")).toBeTruthy();
    });

    it("renders empty placeholder for video", () => {
      render(
        <MediaInputCard
          {...defaultProps}
          input={{ ...defaultInput, type: "video" }}
        />
      );

      expect(screen.getByText("Add video")).toBeTruthy();
    });

    it("renders empty placeholder for audio", () => {
      render(
        <MediaInputCard
          {...defaultProps}
          input={{ ...defaultInput, type: "audio" }}
        />
      );

      expect(screen.getByText("Add audio")).toBeTruthy();
    });

    it("disables placeholder when not editable", () => {
      render(<MediaInputCard {...defaultProps} isEditable={false} />);

      const button = screen.getByRole("button");
      expect(button).toHaveProperty("disabled", true);
    });

    it("disables placeholder when blueprintFolder is null", () => {
      render(<MediaInputCard {...defaultProps} blueprintFolder={null} />);

      const button = screen.getByRole("button");
      expect(button).toHaveProperty("disabled", true);
    });

    it("disables placeholder when movieId is null", () => {
      render(<MediaInputCard {...defaultProps} movieId={null} />);

      const button = screen.getByRole("button");
      expect(button).toHaveProperty("disabled", true);
    });
  });

  describe("when value has file reference", () => {
    const propsWithValue = {
      ...defaultProps,
      value: "file:./input-files/test-image.png",
    };

    it("renders media card with label", () => {
      render(<MediaInputCard {...propsWithValue} />);

      expect(screen.getByText("testImage")).toBeTruthy();
    });

    it("renders array index in label when arrayIndex provided", () => {
      render(
        <MediaInputCard
          {...propsWithValue}
          value={["file:./input-files/test.png"]}
          arrayIndex={0}
          input={{ ...defaultInput, type: "array", itemType: "image" }}
        />
      );

      expect(screen.getByText("testImage[0]")).toBeTruthy();
    });

    it("shows dropdown trigger for actions", () => {
      render(<MediaInputCard {...propsWithValue} />);

      // Find the dropdown trigger
      const trigger = screen.getByRole("button", { name: "" });
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    });
  });

  describe("array handling", () => {
    const arrayInput = {
      ...defaultInput,
      type: "array" as const,
      itemType: "image" as const,
    };

    it("handles array value with arrayIndex", () => {
      const value = [
        "file:./input-files/image1.png",
        "file:./input-files/image2.png",
      ];
      render(
        <MediaInputCard
          {...defaultProps}
          input={arrayInput}
          value={value}
          arrayIndex={1}
        />
      );

      expect(screen.getByText("testImage[1]")).toBeTruthy();
    });
  });
});

describe("AddMediaCard", () => {
  it("renders add placeholder for image", () => {
    render(<AddMediaCard mediaType="image" onAdd={() => {}} />);

    expect(screen.getByText("Add image")).toBeTruthy();
  });

  it("renders add placeholder for video", () => {
    render(<AddMediaCard mediaType="video" onAdd={() => {}} />);

    expect(screen.getByText("Add video")).toBeTruthy();
  });

  it("renders add placeholder for audio", () => {
    render(<AddMediaCard mediaType="audio" onAdd={() => {}} />);

    expect(screen.getByText("Add audio")).toBeTruthy();
  });

  it("calls onAdd when clicked", () => {
    const onAdd = vi.fn();
    render(<AddMediaCard mediaType="image" onAdd={onAdd} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("does not call onAdd when disabled", () => {
    const onAdd = vi.fn();
    render(<AddMediaCard mediaType="image" onAdd={onAdd} disabled />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onAdd).not.toHaveBeenCalled();
  });
});
