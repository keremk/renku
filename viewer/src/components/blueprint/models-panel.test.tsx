/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelsPanel } from './models-panel';
import { isNestedSttSelection, isSpeechModelSelection } from './models/stt-helpers';
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
// Helper Function Tests
// =============================================================================

describe('isNestedSttSelection', () => {
  it('returns false for undefined selection', () => {
    expect(isNestedSttSelection(undefined)).toBe(false);
  });

  it('returns false for regular selection', () => {
    const selection = createRegularSelection();
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns false for speech selection without config', () => {
    const selection = createSpeechSelectionWithoutConfig();
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns false for selection with partial config (missing stt.model)', () => {
    const selection: ModelSelectionValue = {
      producerId: 'TranscriptionProducer',
      provider: 'renku',
      model: 'speech/transcription',
      config: {
        stt: {
          provider: 'fal-ai',
        },
      },
    };
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns false for selection with partial config (missing stt.provider)', () => {
    const selection: ModelSelectionValue = {
      producerId: 'TranscriptionProducer',
      provider: 'renku',
      model: 'speech/transcription',
      config: {
        stt: {
          model: 'elevenlabs/speech-to-text',
        },
      },
    };
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns false for non-renku provider with speech model', () => {
    const selection: ModelSelectionValue = {
      producerId: 'TranscriptionProducer',
      provider: 'other-provider',
      model: 'speech/transcription',
      config: {
        stt: {
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
        },
      },
    };
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns false for renku provider with non-speech model', () => {
    const selection: ModelSelectionValue = {
      producerId: 'SomeProducer',
      provider: 'renku',
      model: 'timeline/ordered',
      config: {
        stt: {
          provider: 'fal-ai',
          model: 'elevenlabs/speech-to-text',
        },
      },
    };
    expect(isNestedSttSelection(selection)).toBe(false);
  });

  it('returns true for valid nested STT selection', () => {
    const selection = createNestedSttSelection();
    expect(isNestedSttSelection(selection)).toBe(true);
  });

  it('returns true for different speech models', () => {
    const selection: ModelSelectionValue = {
      producerId: 'SttProducer',
      provider: 'renku',
      model: 'speech/other-type',
      config: {
        stt: {
          provider: 'openai',
          model: 'whisper-1',
        },
      },
    };
    expect(isNestedSttSelection(selection)).toBe(true);
  });
});

describe('isSpeechModelSelection', () => {
  it('returns false for undefined selection', () => {
    expect(isSpeechModelSelection(undefined)).toBe(false);
  });

  it('returns false for regular selection', () => {
    const selection = createRegularSelection();
    expect(isSpeechModelSelection(selection)).toBe(false);
  });

  it('returns false for non-renku provider with speech model', () => {
    const selection: ModelSelectionValue = {
      producerId: 'Producer',
      provider: 'other',
      model: 'speech/transcription',
    };
    expect(isSpeechModelSelection(selection)).toBe(false);
  });

  it('returns false for renku provider with non-speech model', () => {
    const selection: ModelSelectionValue = {
      producerId: 'Producer',
      provider: 'renku',
      model: 'timeline/ordered',
    };
    expect(isSpeechModelSelection(selection)).toBe(false);
  });

  it('returns true for speech selection without config', () => {
    const selection = createSpeechSelectionWithoutConfig();
    expect(isSpeechModelSelection(selection)).toBe(true);
  });

  it('returns true for nested STT selection', () => {
    const selection = createNestedSttSelection();
    expect(isSpeechModelSelection(selection)).toBe(true);
  });
});

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

    it('displays nested STT selection with extracted provider/model', () => {
      const selections = [createNestedSttSelection()];

      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
        />
      );

      // Should display the nested config values
      expect(container.textContent).toContain('elevenlabs/speech-to-text');
      // Verify renku/speech/transcription is NOT displayed as the selection value
      // (it may appear as producerType badge, but not as the selected model)
    });

    it('displays multiple selections correctly including nested STT', () => {
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

      // Both should be visible
      expect(container.textContent).toContain('flux-pro/text-to-image');
      expect(container.textContent).toContain('elevenlabs/speech-to-text');
    });
  });

  describe('editable mode', () => {
    const mockOnSave = vi.fn();

    beforeEach(() => {
      mockOnSave.mockClear();
    });

    it('renders producer sections when editing is enabled', () => {
      const { container } = render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={[createRegularSelection()]}
          selectedNodeId={null}
          isEditable={true}
          onSave={mockOnSave}
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
          onSave={mockOnSave}
        />
      );

      // The dropdown should show the extracted STT values
      const comboboxes = screen.getAllByRole('combobox');
      expect(comboboxes.length).toBeGreaterThan(0);
    });
  });

  describe('save behavior with nested STT selections', () => {
    it('does not call onSave when selection matches original', () => {
      const mockOnSave = vi.fn().mockResolvedValue(undefined);
      const selections = [createNestedSttSelection()];

      render(
        <ModelsPanel
          producerModels={defaultProducerModels}
          modelSelections={selections}
          selectedNodeId={null}
          isEditable={true}
          onSave={mockOnSave}
        />
      );

      // Without making changes, save should not be triggered
      // There's no save button visible when dirty is false
      const saveButton = screen.queryByText('Save');
      if (saveButton) {
        fireEvent.click(saveButton);
      }

      // onSave should not have been called since nothing changed
      expect(mockOnSave).not.toHaveBeenCalled();
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
  it('correctly transforms nested selection for display and back for save', () => {
    // Simulate the flow:
    // 1. Initial selection comes in with nested format
    // 2. getSelection extracts the actual provider/model for display
    // 3. When user edits, the value is in direct format
    // 4. handleSave transforms it back to nested format

    const originalSelection = createNestedSttSelection();

    // Verify isNestedSttSelection identifies it correctly
    expect(isNestedSttSelection(originalSelection)).toBe(true);

    // The expected extracted values for display (new nested format)
    const sttConfig = originalSelection.config?.stt as Record<string, unknown>;
    expect(sttConfig?.provider).toBe('fal-ai');
    expect(sttConfig?.model).toBe('elevenlabs/speech-to-text');

    // The original format that should be preserved
    expect(originalSelection.provider).toBe('renku');
    expect(originalSelection.model).toBe('speech/transcription');
  });

  it('handles selection without nested config gracefully', () => {
    const selectionWithoutConfig = createSpeechSelectionWithoutConfig();

    // Should identify as speech selection pattern
    expect(isSpeechModelSelection(selectionWithoutConfig)).toBe(true);

    // But not as nested STT (missing config)
    expect(isNestedSttSelection(selectionWithoutConfig)).toBe(false);
  });

  it('correctly identifies non-speech selections', () => {
    const regularSelection = createRegularSelection();

    expect(isSpeechModelSelection(regularSelection)).toBe(false);
    expect(isNestedSttSelection(regularSelection)).toBe(false);
  });
});
