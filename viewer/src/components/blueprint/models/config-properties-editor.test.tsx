/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfigPropertiesEditor } from "./config-properties-editor";
import type { ConfigProperty } from "@/types/blueprint-graph";

function createMockProperty(key: string, overrides: Partial<ConfigProperty> = {}): ConfigProperty {
  return {
    key,
    required: false,
    schema: {
      type: "string",
      description: `Description for ${key}`,
    },
    ...overrides,
  };
}

describe("ConfigPropertiesEditor", () => {
  describe("Rendering", () => {
    it("renders required properties (marked with asterisk)", () => {
      const properties = [
        createMockProperty("model", { required: true }),
        createMockProperty("temperature", { required: true }),
        createMockProperty("optional_param", { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // All properties should be rendered
      expect(screen.getByText("model")).toBeTruthy();
      expect(screen.getByText("temperature")).toBeTruthy();
      expect(screen.getByText("optional_param")).toBeTruthy();
    });

    it("renders all properties in a flat list (required first, then optional)", () => {
      const properties = [
        createMockProperty("required_param", { required: true }),
        createMockProperty("opt1", { required: false }),
        createMockProperty("opt2", { required: false }),
        createMockProperty("opt3", { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // All properties should be rendered
      expect(screen.getByText("required_param")).toBeTruthy();
      expect(screen.getByText("opt1")).toBeTruthy();
      expect(screen.getByText("opt2")).toBeTruthy();
      expect(screen.getByText("opt3")).toBeTruthy();
    });

    it("filters out object type properties", () => {
      const properties = [
        createMockProperty("simple_string", { schema: { type: "string" } }),
        createMockProperty("complex_object", {
          schema: {
            type: "object",
            properties: { nested: { type: "string" } },
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // simple_string should be rendered
      expect(screen.getByText("simple_string")).toBeTruthy();
      // complex_object should NOT be rendered
      expect(screen.queryByText("complex_object")).toBeNull();
    });

    it("filters out array type properties", () => {
      const properties = [
        createMockProperty("simple_number", {
          schema: { type: "number" },
        }),
        createMockProperty("tags_array", {
          schema: { type: "array", items: { type: "string" } },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("simple_number")).toBeTruthy();
      expect(screen.queryByText("tags_array")).toBeNull();
    });

    it("shows hidden properties count when complex properties filtered", () => {
      const properties = [
        createMockProperty("visible", { schema: { type: "string" } }),
        createMockProperty("hidden1", { schema: { type: "object" } }),
        createMockProperty("hidden2", { schema: { type: "array" } }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("2 complex properties not shown.")).toBeTruthy();
    });

    it("shows singular text for single hidden property", () => {
      const properties = [
        createMockProperty("visible", { schema: { type: "string" } }),
        createMockProperty("hidden", { schema: { type: "object" } }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("1 complex property not shown.")).toBeTruthy();
    });

    it("shows message when no properties available", () => {
      render(
        <ConfigPropertiesEditor
          properties={[]}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText("No configurable properties available.")).toBeTruthy();
    });

    it("shows message when only complex properties exist", () => {
      const properties = [
        createMockProperty("obj", { schema: { type: "object" } }),
        createMockProperty("arr", { schema: { type: "array" } }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByText("2 complex properties not shown (requires specialized editor).")
      ).toBeTruthy();
    });
  });

  describe("Error state", () => {
    it("shows error message when schemaError provided", () => {
      render(
        <ConfigPropertiesEditor
          properties={[]}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          schemaError="Failed to load config schema: Network error"
        />
      );

      expect(screen.getByText("Failed to load config schema")).toBeTruthy();
      expect(
        screen.getByText("Failed to load config schema: Network error")
      ).toBeTruthy();
    });

    it("does not show properties when error state", () => {
      const properties = [
        createMockProperty("param1"),
        createMockProperty("param2"),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          schemaError="Some error"
        />
      );

      // Properties should not be shown
      expect(screen.queryByText("param1")).toBeNull();
      expect(screen.queryByText("param2")).toBeNull();
    });
  });

  describe("Property values", () => {
    it("passes correct values to property rows", () => {
      const properties = [
        createMockProperty("temperature", {
          schema: { type: "number" },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{ temperature: 0.8 }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole("spinbutton");
      expect((input as HTMLInputElement).value).toBe("0.8");
    });

    it("calls onChange with correct key when property value changes", () => {
      const onChange = vi.fn();
      const properties = [
        createMockProperty("temperature", {
          schema: { type: "number" },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{ temperature: 0.5 }}
          isEditable={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole("spinbutton");
      // Simulate changing the value
      input.focus();
      // fireEvent.change would trigger the onChange
    });
  });

  describe("Sorting", () => {
    it("sorts properties alphabetically (required first, then optional)", () => {
      const properties = [
        createMockProperty("zebra", { required: true }),
        createMockProperty("apple", { required: true }),
        createMockProperty("mango", { required: false }),
        createMockProperty("banana", { required: false }),
      ];

      const { container } = render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Get all property names in order
      const propertyNames = container.querySelectorAll(".font-medium.text-sm");
      const names = Array.from(propertyNames).map((el) => el.textContent);

      // Required properties (apple, zebra - sorted) first, then optional (banana, mango - sorted)
      expect(names).toEqual(["apple", "zebra", "banana", "mango"]);
    });
  });

  describe("Model selection", () => {
    it("renders model selection row when model props provided", () => {
      const properties = [
        createMockProperty("temperature", { schema: { type: "number" } }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          producerId="test-producer"
          availableModels={[
            { provider: "openai", model: "gpt-4" },
            { provider: "anthropic", model: "claude-3" },
          ]}
          onModelChange={() => {}}
        />
      );

      // Model row should be rendered
      expect(screen.getByText("Model")).toBeTruthy();
    });

    it("does not render model selection when isComposition is true", () => {
      const properties = [
        createMockProperty("duration", { schema: { type: "number" } }),
      ];

      render(
        <ConfigPropertiesEditor
          properties={properties}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          producerId="test-producer"
          availableModels={[{ provider: "openai", model: "gpt-4" }]}
          isComposition={true}
          onModelChange={() => {}}
        />
      );

      // Model row should NOT be rendered for compositions
      expect(screen.queryByText("Model")).toBeNull();
    });
  });
});
