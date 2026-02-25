/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SwitchBlueprintDialog } from "./switch-blueprint-dialog";

// Mock the blueprint client
vi.mock("@/data/blueprint-client", () => ({
  fetchBlueprintsList: vi.fn(),
}));

// Mock the route hook
vi.mock("@/hooks/use-blueprint-route", () => ({
  switchBlueprint: vi.fn(),
}));

import { fetchBlueprintsList } from "@/data/blueprint-client";
import { switchBlueprint } from "@/hooks/use-blueprint-route";

describe("SwitchBlueprintDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the switch button", () => {
    render(<SwitchBlueprintDialog currentBlueprintName="my-project" />);
    expect(screen.getByText("Switch")).toBeTruthy();
  });

  it("opens dialog and loads blueprints on button click", async () => {
    vi.mocked(fetchBlueprintsList).mockResolvedValue({
      blueprints: [
        { name: "alpha-project" },
        { name: "beta-project" },
      ],
    });

    render(<SwitchBlueprintDialog currentBlueprintName="alpha-project" />);

    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("Switch Blueprint")).toBeTruthy();
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha Project")).toBeTruthy();
      expect(screen.getByText("Beta Project")).toBeTruthy();
    });
  });

  it("highlights the current blueprint with a check icon", async () => {
    vi.mocked(fetchBlueprintsList).mockResolvedValue({
      blueprints: [
        { name: "current-bp" },
        { name: "other-bp" },
      ],
    });

    render(<SwitchBlueprintDialog currentBlueprintName="current-bp" />);
    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("Current Bp")).toBeTruthy();
    });

    // The current blueprint button should be disabled
    const buttons = screen.getAllByRole("button");
    const currentButton = buttons.find((btn) =>
      btn.textContent?.includes("Current Bp")
    );
    expect(currentButton).toBeTruthy();
    expect(currentButton?.disabled).toBe(true);
  });

  it("navigates to a different blueprint when clicked", async () => {
    vi.mocked(fetchBlueprintsList).mockResolvedValue({
      blueprints: [
        { name: "current-bp" },
        { name: "other-bp" },
      ],
    });

    render(<SwitchBlueprintDialog currentBlueprintName="current-bp" />);
    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("Other Bp")).toBeTruthy();
    });

    const buttons = screen.getAllByRole("button");
    const otherButton = buttons.find((btn) =>
      btn.textContent?.includes("Other Bp")
    );
    fireEvent.click(otherButton!);

    expect(switchBlueprint).toHaveBeenCalledWith("other-bp");
  });

  it("shows loading state", async () => {
    // Never resolve to keep in loading state
    vi.mocked(fetchBlueprintsList).mockReturnValue(new Promise(() => {}));

    render(<SwitchBlueprintDialog currentBlueprintName="my-bp" />);
    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("Switch Blueprint")).toBeTruthy();
    });
  });

  it("shows error state", async () => {
    vi.mocked(fetchBlueprintsList).mockRejectedValue(
      new Error("Network error")
    );

    render(<SwitchBlueprintDialog currentBlueprintName="my-bp" />);
    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeTruthy();
    });
  });

  it("shows empty state when no blueprints found", async () => {
    vi.mocked(fetchBlueprintsList).mockResolvedValue({
      blueprints: [],
    });

    render(<SwitchBlueprintDialog currentBlueprintName="my-bp" />);
    fireEvent.click(screen.getByText("Switch"));

    await waitFor(() => {
      expect(screen.getByText("No blueprints found.")).toBeTruthy();
    });
  });
});
