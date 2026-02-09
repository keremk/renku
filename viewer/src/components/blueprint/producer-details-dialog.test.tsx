/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProducerDetailsDialog } from "./producer-details-dialog";

describe("ProducerDetailsDialog", () => {
  it("renders producer metadata and detailed bindings", () => {
    render(
      <ProducerDetailsDialog
        open={true}
        onOpenChange={vi.fn()}
        producer={{
          nodeId: "Producer:AudioGen",
          label: "AudioGen",
          producerType: "asset/text-to-audio",
          description: "Generate narration",
          loop: "segment",
          status: "running",
          inputBindings: [
            {
              from: "Input.Script",
              to: "AudioGen.Script",
              sourceType: "input",
              targetType: "producer",
              isConditional: false,
            },
          ],
          outputBindings: [
            {
              from: "AudioGen.GeneratedAudio",
              to: "NarrationArtifact",
              sourceType: "producer",
              targetType: "output",
              isConditional: true,
              conditionName: "NeedsNarration",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("AudioGen")).toBeTruthy();
    expect(screen.getByText("asset/text-to-audio")).toBeTruthy();
    expect(screen.getByText("Generate narration")).toBeTruthy();
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.queryByText("this producer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inputs (1)" }));
    expect(screen.getAllByText("Script").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Current producer")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Outputs (1)" }));
    expect(screen.getByText("GeneratedAudio")).toBeTruthy();
    expect(screen.getByText("NarrationArtifact")).toBeTruthy();
    expect(screen.getByText("if NeedsNarration")).toBeTruthy();
  });
});
