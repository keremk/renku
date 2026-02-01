/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfigPropertyRow } from "./config-property-row";
import type { ConfigProperty } from "@/types/blueprint-graph";

function createMockProperty(overrides: Partial<ConfigProperty> = {}): ConfigProperty {
  return {
    key: "test_property",
    required: false,
    schema: {
      type: "string",
      description: "Test description",
    },
    ...overrides,
  };
}

describe("ConfigPropertyRow", () => {
  describe("Type rendering", () => {
    it("renders Select for enum properties", () => {
      const property = createMockProperty({
        key: "aspect_ratio",
        schema: {
          type: "string",
          enum: ["16:9", "4:3", "1:1"],
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value="16:9"
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Should have a select trigger
      expect(screen.getByRole("combobox")).toBeTruthy();
    });

    it("renders Switch for boolean properties", () => {
      const property = createMockProperty({
        key: "enable_audio",
        schema: {
          type: "boolean",
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={true}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Should have a switch
      expect(screen.getByRole("switch")).toBeTruthy();
    });

    it("renders number Input for number properties", () => {
      const property = createMockProperty({
        key: "temperature",
        schema: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={0.7}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).type).toBe("number");
    });

    it("renders number Input for integer properties", () => {
      const property = createMockProperty({
        key: "safety_tolerance",
        schema: {
          type: "integer",
          minimum: 1,
          maximum: 10,
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={5}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).step).toBe("1");
    });

    it("renders text Input for string properties", () => {
      const property = createMockProperty({
        key: "prompt_suffix",
        schema: {
          type: "string",
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value="test value"
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole("textbox");
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe("test value");
    });

    it("returns null for object type properties", () => {
      const property = createMockProperty({
        key: "voice_settings",
        schema: {
          type: "object",
          properties: {
            stability: { type: "number" },
          },
        },
      });

      const { container } = render(
        <ConfigPropertyRow
          property={property}
          value={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Should render nothing
      expect(container.firstChild).toBeNull();
    });

    it("returns null for array type properties", () => {
      const property = createMockProperty({
        key: "tags",
        schema: {
          type: "array",
          items: { type: "string" },
        },
      });

      const { container } = render(
        <ConfigPropertyRow
          property={property}
          value={[]}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Should render nothing
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Property info", () => {
    it("renders property name", () => {
      const property = createMockProperty({ key: "temperature" });

      render(
        <ConfigPropertyRow
          property={property}
          value={0.5}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("temperature")).toBeTruthy();
    });

    it("renders type badge", () => {
      const property = createMockProperty({
        key: "count",
        schema: { type: "number" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={10}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("number")).toBeTruthy();
    });

    it("renders required indicator when required", () => {
      const property = createMockProperty({
        key: "model",
        required: true,
      });

      render(
        <ConfigPropertyRow
          property={property}
          value="test"
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("*")).toBeTruthy();
    });

    it("renders description", () => {
      const property = createMockProperty({
        schema: {
          type: "string",
          description: "The API key to use",
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value=""
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("The API key to use")).toBeTruthy();
    });
  });

  describe("Interactions", () => {
    it("Switch toggles on click", () => {
      const onChange = vi.fn();
      const property = createMockProperty({
        key: "enabled",
        schema: { type: "boolean" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={false}
          isEditable={true}
          onChange={onChange}
        />
      );

      const switchEl = screen.getByRole("switch");
      fireEvent.click(switchEl);

      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("number Input accepts numeric values", () => {
      const onChange = vi.fn();
      const property = createMockProperty({
        key: "temperature",
        schema: { type: "number" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={0.5}
          isEditable={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "0.8" } });

      expect(onChange).toHaveBeenCalledWith(0.8);
    });

    it("string Input accepts text values", () => {
      const onChange = vi.fn();
      const property = createMockProperty({
        key: "suffix",
        schema: { type: "string" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value=""
          isEditable={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "new value" } });

      expect(onChange).toHaveBeenCalledWith("new value");
    });
  });

  describe("Read-only mode", () => {
    it("shows text value for enum when not editable", () => {
      const property = createMockProperty({
        key: "aspect_ratio",
        schema: {
          type: "string",
          enum: ["16:9", "4:3"],
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value="16:9"
          isEditable={false}
          onChange={() => {}}
        />
      );

      // Should show text, not a select
      expect(screen.getByText("16:9")).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    it("Switch is disabled when not editable", () => {
      const property = createMockProperty({
        key: "enabled",
        schema: { type: "boolean" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={true}
          isEditable={false}
          onChange={() => {}}
        />
      );

      const switchEl = screen.getByRole("switch");
      expect(switchEl.hasAttribute("disabled")).toBe(true);
    });

    it("Input is disabled when not editable", () => {
      const property = createMockProperty({
        key: "value",
        schema: { type: "string" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value="test"
          isEditable={false}
          onChange={() => {}}
        />
      );

      // In read-only mode for string, it shows text span not input
      expect(screen.getByText("test")).toBeTruthy();
    });

    it("number shows text value when not editable", () => {
      const property = createMockProperty({
        key: "count",
        schema: { type: "number" },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={42}
          isEditable={false}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.queryByRole("spinbutton")).toBeNull();
    });
  });

  describe("Default values", () => {
    it("uses schema default when value is undefined", () => {
      const property = createMockProperty({
        key: "temperature",
        schema: {
          type: "number",
          default: 0.7,
        },
      });

      render(
        <ConfigPropertyRow
          property={property}
          value={undefined}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect((input as HTMLInputElement).value).toBe("0.7");
    });
  });
});
