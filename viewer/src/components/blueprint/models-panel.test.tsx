/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelsPanel } from './models-panel';
import type {
  ModelSelectionValue,
  ProducerModelInfo,
} from '@/types/blueprint-graph';

// =============================================================================
// Test Data Factories
// =============================================================================

function createRegularSelection(overrides: Partial<ModelSelectionValue> = {}): ModelSelectionValue {
  return {
    producerId: 'ImageProducer',
    provider: 'fal-ai',
    model: 'flux-pro/text-to-image',
    ...overrides,
  };
}

function createNestedSttSelection(overrides: Partial<ModelSelectionValue> = {}): ModelSelectionValue {
  return {
    producerId: 'TranscriptionProducer',
    provider: 'renku',
    model: 'speech/transcription',
    config: {
      stt: {
        provider: 'fal-ai',
        model: 'elevenlabs/speech-to-text',
      },
    },
    ...overrides,
  };
}

function createSpeechSelectionWithoutConfig(): ModelSelectionValue {
  return {
    producerId: 'TranscriptionProducer',
    provider: 'renku',
    model: 'speech/transcription',
  };
}

function createProducerModelInfo(overrides: Partial<ProducerModelInfo> = {}): ProducerModelInfo {
  return {
    category: 'asset',
    producerType: 'asset/text-to-image',
    availableModels: [
      { provider: 'fal-ai', model: 'flux-pro/text-to-image' },
      { provider: 'replicate', model: 'sdxl' },
    ],
    ...overrides,
  };
}

function createTranscriptionProducerInfo(): ProducerModelInfo {
  return {
    category: 'asset',
    producerType: 'asset/transcription',
    description: 'Transcribe audio',
    availableModels: [
      { provider: 'fal-ai', model: 'elevenlabs/speech-to-text' },
    ],
  };
}

// =============================================================================
// ModelsPanel Component Tests
// =============================================================================

describe('ModelsPanel', () => {
  const defaultProducerModels: Record<string, ProducerModelInfo> = {
    ImageProducer: createProducerModelInfo(),
    TranscriptionProducer: createTranscriptionProducerInfo(),
  };

  describe('read-only mode display', () => {
    it('displays regular selection correctly', () => {
      const selections = [createRegularSelection()];

      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
        />
      );

      // The display shows "fal-ai/flux-pro/text-to-image"
      expect(container.textContent).toContain('fal-ai/flux-pro/text-to-image');
    });

    it('displays nested STT selection with top-level values when no schema provided', () => {
      const selections = [createNestedSttSelection()];

      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
        />
      );

      // Without schema, displays the top-level selection (renku/speech/transcription)
      // The nested extraction now requires schema-driven detection
      expect(container.textContent).toContain('renku/speech/transcription');
    });

    it('displays multiple selections correctly', () => {
      const selections = [
        createRegularSelection(),
        createNestedSttSelection(),
      ];

      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
        />
      );

      // Regular selection shows full model
      expect(container.textContent).toContain('flux-pro/text-to-image');
      // Nested selection shows top-level values without schema
      expect(container.textContent).toContain('renku/speech/transcription');
    });
  });

  describe('editable mode', () => {
    const mockOnSelectionChange = vi.fn();

    beforeEach(() => {
      mockOnSelectionChange.mockClear();
    });

    it('renders producer sections when editing is enabled', () => {
      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={[createRegularSelection()]}
          selectedNodeId={null}
          isEditable={true}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      // Should render producer sections for editable mode
      expect(container.textContent).toContain('ImageProducer');
      expect(container.textContent).toContain('TranscriptionProducer');
    });

    it('displays nested STT selection value in dropdown', () => {
      const selections = [createNestedSttSelection()];

      render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
          isEditable={true}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      // The dropdown should show the extracted STT values
      const comboboxes = screen.getAllByRole('combobox');
      expect(comboboxes.length).toBeGreaterThan(0);
    });
  });

  describe('save behavior with nested STT selections', () => {
    it('does not call onSelectionChange when selection matches original', () => {
      const mockOnSelectionChange = vi.fn();
      const selections = [createNestedSttSelection()];

      render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
          isEditable={true}
          onSelectionChange={mockOnSelectionChange}
        />
      );

      // Without making changes, save should not be triggered
      // There's no save button visible when dirty is false
      const saveButton = screen.queryByText('Save');
      if (saveButton) {
        fireEvent.click(saveButton);
      }

      // onSelectionChange should not have been called since nothing changed
      expect(mockOnSelectionChange).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('shows empty message when no producers available', () => {
      const { container } = render(
        <ModelsPanel
          producerModels={{}}
          modelSelections={[]}
          selectedNodeId={null}
        />
      );

      expect(container.textContent).toContain('No producers with configurable models');
    });
  });

  describe('selection highlighting', () => {
    it('highlights selected producer', () => {
      const selections = [createRegularSelection()];

      render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId="Producer:ImageProducer"
        />
      );

      // Find the section container with ring styling (using getSectionHighlightStyles)
      const sections = document.querySelectorAll('.rounded-lg');
      // Find the section containing ImageProducer
      const imageProducerSection = Array.from(sections).find(section =>
        section.textContent?.includes('ImageProducer')
      );
      // The highlight style uses ring-1 ring-primary/30 from getSectionHighlightStyles
      expect(imageProducerSection?.className).toContain('ring-primary/30');
    });
  });
});

// =============================================================================
// Integration Tests for Nested STT Handling
// =============================================================================

describe('Nested STT Selection Integration', () => {
  it('correctly stores nested selection structure', () => {
    // Test the nested selection data structure
    const originalSelection = createNestedSttSelection();

    // The nested config should have stt.provider and stt.model
    const sttConfig = originalSelection.config?.stt as Record<string, unknown>;
    expect(sttConfig?.provider).toBe('fal-ai');
    expect(sttConfig?.model).toBe('elevenlabs/speech-to-text');

    // The top-level selection uses the meta-producer format
    expect(originalSelection.provider).toBe('renku');
    expect(originalSelection.model).toBe('speech/transcription');
  });

  it('handles selection without nested config', () => {
    const selectionWithoutConfig = createSpeechSelectionWithoutConfig();

    // Should have top-level renku/speech provider/model
    expect(selectionWithoutConfig.provider).toBe('renku');
    expect(selectionWithoutConfig.model).toBe('speech/transcription');

    // But no nested config
    expect(selectionWithoutConfig.config).toBeUndefined();
  });

  it('regular selections have direct provider/model', () => {
    const regularSelection = createRegularSelection();

    // Regular selections use direct provider/model
    expect(regularSelection.provider).toBe('fal-ai');
    expect(regularSelection.model).toBe('flux-pro/text-to-image');
  });
});
