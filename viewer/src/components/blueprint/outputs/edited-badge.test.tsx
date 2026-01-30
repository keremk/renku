/**
 * @vitest-environment jsdom
 */

/**
 * Tests for the EditedBadge component.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditedBadge } from "./edited-badge";

describe("EditedBadge", () => {
  it("renders with 'Edited' text", () => {
    render(<EditedBadge />);
    expect(screen.getByText("Edited")).toBeDefined();
  });

  it("applies custom className", () => {
    const { container } = render(<EditedBadge className="custom-class" />);
    const badge = container.querySelector("span");
    expect(badge?.classList.contains("custom-class")).toBe(true);
  });

  it("has amber styling classes", () => {
    const { container } = render(<EditedBadge />);
    const badge = container.querySelector("span");
    // Check for amber color classes
    expect(badge?.className).toContain("amber");
  });
});
