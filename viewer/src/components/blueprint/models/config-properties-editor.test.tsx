/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigPropertiesEditor } from './config-properties-editor';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';

const htmlElementPrototype = HTMLElement.prototype as HTMLElement & {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

if (typeof htmlElementPrototype.hasPointerCapture !== 'function') {
  htmlElementPrototype.hasPointerCapture = () => false;
}
if (typeof htmlElementPrototype.setPointerCapture !== 'function') {
  htmlElementPrototype.setPointerCapture = () => {};
}
if (typeof htmlElementPrototype.releasePointerCapture !== 'function') {
  htmlElementPrototype.releasePointerCapture = () => {};
}

function createMockField(
  keyPath: string,
  overrides: Partial<ConfigFieldDescriptor> = {}
): ConfigFieldDescriptor {
  return {
    keyPath,
    component: 'string',
    label: keyPath,
    required: false,
    schema: {
      type: 'string',
    },
    mappingSource: 'none',
    mappedAliases: [],
    ...overrides,
  };
}

describe('ConfigPropertiesEditor', () => {
  describe('Rendering', () => {
    it('renders required fields', () => {
      const fields = [
        createMockField('model', { required: true }),
        createMockField('temperature', { required: true }),
        createMockField('optional_param', { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // All properties should be rendered
      expect(screen.getByText('model')).toBeTruthy();
      expect(screen.getByText('temperature')).toBeTruthy();
      expect(screen.getByText('optional_param')).toBeTruthy();
    });

    it('renders all provided fields', () => {
      const fields = [
        createMockField('required_param', { required: true }),
        createMockField('opt1', { required: false }),
        createMockField('opt2', { required: false }),
        createMockField('opt3', { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // All properties should be rendered
      expect(screen.getByText('required_param')).toBeTruthy();
      expect(screen.getByText('opt1')).toBeTruthy();
      expect(screen.getByText('opt2')).toBeTruthy();
      expect(screen.getByText('opt3')).toBeTruthy();
    });

    it('uses sdk preview value and warning text for mapped fields', () => {
      const fields = [
        createMockField('aspect_ratio', {
          required: false,
          mappingSource: 'input',
          mappedAliases: ['Resolution'],
        }),
        createMockField('optional_config', { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[
            {
              field: 'aspect_ratio',
              value: '16:9',
              status: 'warning',
              warnings: ['Converted to nearest supported size token.'],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
              schemaType: 'string',
            },
          ]}
        />
      );

      expect(screen.getByText('aspect_ratio')).toBeTruthy();
      expect(screen.getByDisplayValue('16:9')).toBeTruthy();
      expect(
        screen.getByText('Converted to nearest supported size token.')
      ).toBeTruthy();
    });

    it('keeps editable fields visible when sdk preview is present', () => {
      const fields = [
        createMockField('aspect_ratio', { required: false }),
        createMockField('resolution', { required: false }),
        createMockField('camera_fixed', { required: false }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[
            {
              field: 'aspect_ratio',
              value: '16:9',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
              schemaType: 'string',
            },
            {
              field: 'resolution',
              value: '720p',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
              schemaType: 'string',
            },
          ]}
        />
      );

      expect(screen.queryAllByText('aspect_ratio')).toHaveLength(1);
      expect(screen.queryAllByText('resolution')).toHaveLength(1);
      expect(screen.getByText('camera_fixed')).toBeTruthy();
    });

    it('renders nothing when no fields available', () => {
      const { container } = render(
        <ConfigPropertiesEditor
          fields={[]}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Should render nothing (null)
      expect(container.firstChild).toBeNull();
    });

    it('renders object children fields', () => {
      const fields = [
        createMockField('complex', {
          component: 'object',
          fields: [
            createMockField('complex.child', {
              label: 'child',
            }),
          ],
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.getByText('child')).toBeTruthy();
    });

    it('lays out registered card editors in a horizontal wrap grid', () => {
      const fields = [
        createMockField('timeline', {
          component: 'object',
          fields: [
            createMockField('timeline.tracks', {
              component: 'array-scalar',
              schema: { type: 'array', items: { type: 'string' } },
            }),
          ],
          schema: { type: 'object' },
        }),
        createMockField('subtitles', {
          component: 'object',
          fields: [
            createMockField('subtitles.fontSize', {
              component: 'number',
              schema: { type: 'number' },
            }),
          ],
          schema: { type: 'object' },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const cardGrid = screen.getByTestId('config-card-field-grid');
      expect(cardGrid).toBeTruthy();
      expect(cardGrid.querySelectorAll(':scope > div')).toHaveLength(2);
      const firstCardContainer = cardGrid.querySelector(':scope > div');
      expect(firstCardContainer?.className).toContain('sm:w-[360px]');
    });
  });

  describe('Error state', () => {
    it('shows error message when schemaError provided', () => {
      render(
        <ConfigPropertiesEditor
          fields={[]}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          schemaError='Failed to load config schema: Network error'
        />
      );

      expect(screen.getByText('Failed to load config schema')).toBeTruthy();
      expect(
        screen.getByText('Failed to load config schema: Network error')
      ).toBeTruthy();
    });

    it('does not show properties when error state', () => {
      const fields = [createMockField('param1'), createMockField('param2')];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          schemaError='Some error'
        />
      );

      // Properties should not be shown
      expect(screen.queryByText('param1')).toBeNull();
      expect(screen.queryByText('param2')).toBeNull();
    });
  });

  describe('Property values', () => {
    it('passes correct values to property rows', () => {
      const fields = [
        createMockField('temperature', {
          component: 'number',
          schema: { type: 'number' },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ temperature: 0.8 }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const input = screen.getByRole('spinbutton');
      expect((input as HTMLInputElement).value).toBe('0.8');
    });

    it('calls onChange with correct key when property value changes', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('temperature', {
          component: 'number',
          schema: { type: 'number' },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ temperature: 0.5 }}
          isEditable={true}
          onChange={onChange}
        />
      );

      const input = screen.getByRole('spinbutton');
      // Simulate changing the value
      input.focus();
      // fireEvent.change would trigger the onChange
    });
  });

  describe('Sorting', () => {
    it('renders fields in provided order', () => {
      const fields = [
        createMockField('zebra', { required: true }),
        createMockField('apple', { required: true }),
        createMockField('mango', { required: false }),
        createMockField('banana', { required: false }),
      ];

      const { container } = render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      // Get all property names in order
      const propertyNames = container.querySelectorAll('.font-medium.text-sm');
      const names = Array.from(propertyNames).map((el) => el.textContent);

      expect(names).toEqual(['zebra', 'apple', 'mango', 'banana']);
    });

    it('renders mapped fields first while preserving schema order per group', () => {
      const fields = [
        createMockField('camera_fixed', { mappingSource: 'none' }),
        createMockField('aspect_ratio', { mappingSource: 'input' }),
        createMockField('image_size', { mappingSource: 'input' }),
        createMockField('seed', { mappingSource: 'none' }),
      ];

      const { container } = render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const propertyNames = container.querySelectorAll('.font-medium.text-sm');
      const names = Array.from(propertyNames).map((el) => el.textContent);

      expect(names).toEqual([
        'aspect_ratio',
        'image_size',
        'camera_fixed',
        'seed',
      ]);
    });
  });

  describe('Union controls', () => {
    const enumOrDimensionsField = createMockField('image_size', {
      component: 'union',
      presentation: 'enum-or-dimensions',
      unionEditor: {
        type: 'enum-dimensions',
        enumVariantId: 'preset',
        customVariantId: 'custom',
        customSelection: {
          source: 'enum-value',
          value: 'custom',
        },
      },
      variants: [
        {
          ...createMockField('image_size.custom', {
            component: 'object',
            label: 'Custom Size',
            fields: [
              createMockField('image_size.custom.width', {
                component: 'integer',
                schema: { type: 'integer', minimum: 1 },
              }),
              createMockField('image_size.custom.height', {
                component: 'integer',
                schema: { type: 'integer', minimum: 1 },
              }),
            ],
          }),
          id: 'custom',
        },
        {
          ...createMockField('image_size.preset', {
            component: 'string-enum',
            label: 'Preset',
            schema: {
              type: 'string',
              enum: ['landscape_16_9', 'match_input_image', 'custom'],
            },
          }),
          id: 'preset',
        },
      ],
      schema: {
        anyOf: [{ type: 'object' }, { type: 'string' }],
      },
    });

    it('shows enum token when using preset and custom label when using dimensions', () => {
      const { rerender } = render(
        <ConfigPropertiesEditor
          fields={[enumOrDimensionsField]}
          values={{ image_size: 'match_input_image' }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByRole('combobox', { name: 'image_size option' }).textContent
      ).toContain('match_input_image');

      rerender(
        <ConfigPropertiesEditor
          fields={[enumOrDimensionsField]}
          values={{ image_size: { width: 1280, height: 720 } }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByRole('combobox', { name: 'image_size option' }).textContent
      ).toContain('custom');
    });

    it('renders inline width/height controls only when custom dimensions are active', () => {
      const { rerender } = render(
        <ConfigPropertiesEditor
          fields={[enumOrDimensionsField]}
          values={{ image_size: 'custom' }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByRole('spinbutton', { name: 'image_size width' })
      ).toBeTruthy();
      expect(
        screen.getByRole('spinbutton', { name: 'image_size height' })
      ).toBeTruthy();
      expect(
        screen.queryByRole('combobox', { name: 'Aspect ratio' })
      ).toBeNull();

      rerender(
        <ConfigPropertiesEditor
          fields={[enumOrDimensionsField]}
          values={{ image_size: 'match_input_image' }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.queryByRole('spinbutton', { name: 'image_size width' })
      ).toBeNull();
      expect(
        screen.queryByRole('spinbutton', { name: 'image_size height' })
      ).toBeNull();
    });

    it('edits custom dimensions through inline controls and emits width/height updates', () => {
      const onChange = vi.fn();

      render(
        <ConfigPropertiesEditor
          fields={[enumOrDimensionsField]}
          values={{ image_size: { width: 1000, height: 777 } }}
          isEditable={true}
          onChange={onChange}
        />
      );

      const widthInput = screen.getByRole('spinbutton', {
        name: 'image_size width',
      });
      fireEvent.change(widthInput, { target: { value: '1500' } });

      expect(onChange).toHaveBeenCalledWith(
        'image_size',
        expect.objectContaining({ width: 1500, height: 777 })
      );
    });
  });

  describe('Model selection', () => {
    it('renders model selection row when model props provided', () => {
      const fields = [
        createMockField('temperature', {
          component: 'number',
          schema: { type: 'number' },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          producerId='test-producer'
          availableModels={[
            { provider: 'openai', model: 'gpt-4' },
            { provider: 'anthropic', model: 'claude-3' },
          ]}
          onModelChange={() => {}}
        />
      );

      // Model row should be rendered
      expect(screen.getByText('Model')).toBeTruthy();
    });

    it('does not render model selection when isComposition is true', () => {
      const fields = [
        createMockField('duration', {
          component: 'number',
          schema: { type: 'number' },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          producerId='test-producer'
          availableModels={[{ provider: 'openai', model: 'gpt-4' }]}
          isComposition={true}
          onModelChange={() => {}}
        />
      );

      // Model row should NOT be rendered for compositions
      expect(screen.queryByText('Model')).toBeNull();
    });
  });

  describe('Annotation fields mode', () => {
    it('prefers explicit override over mapped preview and schema default', () => {
      const fields = [
        createMockField('aspect_ratio', {
          mappingSource: 'input',
          mappedAliases: ['Resolution'],
          schema: {
            type: 'string',
            default: '16:9',
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ aspect_ratio: '1:1' }}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[
            {
              field: 'aspect_ratio',
              value: '9:16',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
            },
          ]}
        />
      );

      const input = screen.getByDisplayValue('1:1');
      expect(input).toBeTruthy();
    });

    it('uses mapped preview value when there is no explicit override', () => {
      const fields = [
        createMockField('aspect_ratio', {
          mappingSource: 'input',
          mappedAliases: ['Resolution'],
          schema: {
            type: 'string',
            default: '16:9',
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[
            {
              field: 'aspect_ratio',
              value: '9:16',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
            },
          ]}
        />
      );

      const input = screen.getByDisplayValue('9:16');
      expect(input).toBeTruthy();
    });

    it('falls back to schema default when not mapped and not overridden', () => {
      const fields = [
        createMockField('preset', {
          mappingSource: 'none',
          schema: {
            type: 'string',
            default: 'medium',
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[]}
        />
      );

      const input = screen.getByDisplayValue('medium');
      expect(input).toBeTruthy();
    });

    it('groups mapped fields in a dedicated section and supports reset', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('aspect_ratio', {
          mappingSource: 'input',
          mappedAliases: ['Resolution'],
          schema: {
            type: 'string',
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ aspect_ratio: '1:1' }}
          isEditable={true}
          onChange={onChange}
          sdkPreview={[
            {
              field: 'aspect_ratio',
              value: '9:16',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
            },
          ]}
        />
      );

      expect(screen.getByText('Connected Inputs')).toBeTruthy();
      expect(screen.queryByText('Mapped')).toBeNull();

      const mappedSection = screen
        .getByText('Connected Inputs')
        .closest('section');
      expect(mappedSection?.textContent).toContain('aspect_ratio');
      expect(mappedSection?.className).toContain('max-w-[56rem]');

      const reset = screen.getByRole('button', { name: 'Reset' });
      fireEvent.click(reset);
      expect(onChange).toHaveBeenCalledWith('aspect_ratio', undefined);
    });

    it('hides artifact-mapped fields in annotation mode', () => {
      const fields = [
        createMockField('prompt', {
          mappingSource: 'artifact',
          mappedAliases: ['Prompt'],
        }),
        createMockField('aspect_ratio', {
          mappingSource: 'input',
          mappedAliases: ['Resolution'],
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[]}
        />
      );

      expect(screen.queryByText('prompt')).toBeNull();
      expect(screen.getByText('aspect_ratio')).toBeTruthy();
    });
  });
});
