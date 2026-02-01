/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PropertyRow } from "./property-row";

describe("PropertyRow", () => {
  it("renders property name", () => {
    render(
      <PropertyRow name="temperature">
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.getByText("temperature")).toBeTruthy();
  });

  it("renders type badge when type provided", () => {
    render(
      <PropertyRow name="temperature" type="number">
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.getByText("number")).toBeTruthy();
  });

  it("does not render type badge when type not provided", () => {
    render(
      <PropertyRow name="temperature">
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.queryByText("string")).toBeNull();
    expect(screen.queryByText("number")).toBeNull();
  });

  it("shows required indicator when required=true", () => {
    render(
      <PropertyRow name="temperature" required={true}>
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.getByText("*")).toBeTruthy();
  });

  it("does not show required indicator when required=false", () => {
    render(
      <PropertyRow name="temperature" required={false}>
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.queryByText("*")).toBeNull();
  });

  it("renders description when provided", () => {
    render(
      <PropertyRow name="temperature" description="Controls randomness">
        <input type="number" />
      </PropertyRow>
    );

    expect(screen.getByText("Controls randomness")).toBeTruthy();
  });

  it("does not render description when not provided", () => {
    render(
      <PropertyRow name="temperature">
        <input type="number" />
      </PropertyRow>
    );

    // Should only have the name, not a description paragraph
    const container = screen.getByText("temperature").closest("div");
    expect(container?.querySelector("p")).toBeNull();
  });

  it("renders children (input control)", () => {
    render(
      <PropertyRow name="temperature">
        <input type="number" data-testid="test-input" />
      </PropertyRow>
    );

    expect(screen.getByTestId("test-input")).toBeTruthy();
  });

  it("applies max-w-2xl constraint to container", () => {
    const { container } = render(
      <PropertyRow name="temperature">
        <input type="number" />
      </PropertyRow>
    );

    const wrapper = container.firstChild;
    expect((wrapper as HTMLElement).className).toContain("max-w-2xl");
  });

  it("applies custom className when provided", () => {
    const { container } = render(
      <PropertyRow name="temperature" className="custom-class">
        <input type="number" />
      </PropertyRow>
    );

    const wrapper = container.firstChild;
    expect((wrapper as HTMLElement).className).toContain("custom-class");
  });

  it("renders with all props together", () => {
    render(
      <PropertyRow
        name="safety_tolerance"
        type="integer"
        description="Safety level from 1-10"
        required={true}
      >
        <input type="number" min={1} max={10} data-testid="safety-input" />
      </PropertyRow>
    );

    expect(screen.getByText("safety_tolerance")).toBeTruthy();
    expect(screen.getByText("integer")).toBeTruthy();
    expect(screen.getByText("Safety level from 1-10")).toBeTruthy();
    expect(screen.getByText("*")).toBeTruthy();
    expect(screen.getByTestId("safety-input")).toBeTruthy();
  });
});
