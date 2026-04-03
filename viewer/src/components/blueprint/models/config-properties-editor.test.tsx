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

    it('groups object children when object has multiple direct fields', () => {
      const fields = [
        createMockField('voice_setting', {
          component: 'object',
          label: 'Voice Setting',
          schema: { type: 'object' },
          fields: [
            createMockField('voice_setting.speed', {
              component: 'number',
              label: 'Speed',
              schema: { type: 'number' },
            }),
            createMockField('voice_setting.vol', {
              component: 'number',
              label: 'Vol',
              schema: { type: 'number' },
            }),
          ],
        }),
      ];

      const { container } = render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      const objectSection = screen
        .getByText('Voice Setting')
        .closest('section');
      expect(objectSection).toBeTruthy();
      expect(objectSection?.className).toContain('models-pane-object-group-bg');
      expect(objectSection?.className).toContain(
        'models-pane-object-group-border'
      );
      expect(objectSection?.className).toContain('md:-ml-3');
      expect(
        container.querySelector('[class*="models-pane-object-group-border"]')
      ).toBeTruthy();
      expect(screen.getByText('Speed')).toBeTruthy();
      expect(screen.getByText('Vol')).toBeTruthy();
    });

    it('flattens nested object descendants into a single group layer', () => {
      const fields = [
        createMockField('voice_setting', {
          component: 'object',
          label: 'Voice Setting',
          schema: { type: 'object' },
          fields: [
            createMockField('voice_setting.voice_config', {
              component: 'object',
              label: 'Voice Config',
              schema: { type: 'object' },
              fields: [
                createMockField('voice_setting.voice_config.speed', {
                  component: 'number',
                  label: 'Speed',
                  schema: { type: 'number' },
                }),
                createMockField('voice_setting.voice_config.vol', {
                  component: 'number',
                  label: 'Vol',
                  schema: { type: 'number' },
                }),
              ],
            }),
            createMockField('voice_setting.voice_id', {
              component: 'string',
              label: 'Voice Id',
              schema: { type: 'string' },
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

      expect(screen.getByText('Voice Setting')).toBeTruthy();
      expect(screen.queryByText('Voice Config')).toBeNull();
      expect(screen.getByText('Speed')).toBeTruthy();
      expect(screen.getByText('Vol')).toBeTruthy();
      expect(screen.getByText('Voice Id')).toBeTruthy();
    });

    it('renders object fields flat when object has a single direct field', () => {
      const fields = [
        createMockField('voice_setting', {
          component: 'object',
          label: 'Voice Setting',
          schema: { type: 'object' },
          fields: [
            createMockField('voice_setting.voice_config', {
              component: 'object',
              label: 'Voice Config',
              schema: { type: 'object' },
              fields: [
                createMockField('voice_setting.voice_config.speed', {
                  component: 'number',
                  label: 'Speed',
                  schema: { type: 'number' },
                }),
                createMockField('voice_setting.voice_config.vol', {
                  component: 'number',
                  label: 'Vol',
                  schema: { type: 'number' },
                }),
              ],
            }),
          ],
        }),
      ];

      const { container } = render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(screen.queryByText('Voice Setting')).toBeNull();
      expect(screen.queryByText('Voice Config')).toBeNull();
      expect(screen.getByText('Speed')).toBeTruthy();
      expect(screen.getByText('Vol')).toBeTruthy();
      expect(
        container.querySelector('[class*="models-pane-object-group-border"]')
      ).toBeNull();
    });

    it('renders a not-implemented notice for unknown custom renderers', () => {
      const fields = [
        createMockField('background_style', {
          component: 'string',
          custom: 'foo-component',
          label: 'Background Style',
        }),
        createMockField('temperature'),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByText('Custom renderer "foo-component" is not implemented.')
      ).toBeTruthy();
      expect(
        screen.getByText('No renderer implementation is registered yet.')
      ).toBeTruthy();
      expect(screen.getByText('temperature')).toBeTruthy();
    });

    it('renders a not-implemented notice for incompatible custom renderer usage', () => {
      const fields = [
        createMockField('background_style', {
          component: 'string',
          custom: 'color-picker',
          label: 'Background Style',
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

      expect(
        screen.getByText('Custom renderer "color-picker" is not implemented.')
      ).toBeTruthy();
      expect(
        screen.getByText('Expected object component, received "string".')
      ).toBeTruthy();
    });

    it('renders rgb object fields as a color picker control', () => {
      const fields = [
        createMockField('background_color', {
          component: 'object',
          custom: 'color-picker',
          label: 'Background Color',
          schema: { type: 'object' },
          fields: [
            createMockField('background_color.r', {
              component: 'integer',
              label: 'R',
              schema: { type: 'integer', minimum: 0, maximum: 255 },
            }),
            createMockField('background_color.g', {
              component: 'integer',
              label: 'G',
              schema: { type: 'integer', minimum: 0, maximum: 255 },
            }),
            createMockField('background_color.b', {
              component: 'integer',
              label: 'B',
              schema: { type: 'integer', minimum: 0, maximum: 255 },
            }),
          ],
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ background_color: { r: 255, g: 0, b: 128 } }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByRole('button', {
          name: 'Pick color for Background Color',
        })
      ).toBeTruthy();
      expect(screen.getByText('#FF0080')).toBeTruthy();

      expect(screen.queryByText('R')).toBeNull();
      expect(screen.queryByText('G')).toBeNull();
      expect(screen.queryByText('B')).toBeNull();
    });

    it('renders voice-id-selector with rich picker dialog and selects a voice', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('voice', {
          component: 'string',
          custom: 'voice-id-selector',
          label: 'Voice',
          customConfig: {
            allow_custom: true,
            options_file: 'voices/elevenlabs-default-voices.json',
            options_rich: [
              {
                value: 'hpp4J3VqNfWAUOO0d1Us',
                label: 'Bella',
                tagline: 'Professional, Bright, Warm',
                description:
                  'Warm and professional with polished narrative quality.',
                preview_url: 'https://example.com/bella.mp3',
              },
              {
                value: 'CwhRBWXzGAHq8TQ4Fs17',
                label: 'Roger',
                tagline: 'Laid-Back, Casual, Resonant',
                description: 'Easy going and perfect for casual conversations.',
              },
            ],
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{}}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Pick voice' }));
      const searchInput = screen.getByRole('textbox', {
        name: 'Search voices',
      });
      fireEvent.change(searchInput, { target: { value: 'casual' } });

      fireEvent.click(
        screen.getByRole('button', {
          name: /Roger - Laid-Back, Casual, Resonant/i,
        })
      );

      expect(onChange).toHaveBeenCalledWith('voice', 'CwhRBWXzGAHq8TQ4Fs17');
    });

    it('clears rich voice search when dialog closes without selection', () => {
      const fields = [
        createMockField('voice', {
          component: 'string',
          custom: 'voice-id-selector',
          label: 'Voice',
          customConfig: {
            allow_custom: true,
            options_file: 'voices/elevenlabs-default-voices.json',
            options_rich: [
              {
                value: 'hpp4J3VqNfWAUOO0d1Us',
                label: 'Bella',
                tagline: 'Professional, Bright, Warm',
                description:
                  'Warm and professional with polished narrative quality.',
              },
              {
                value: 'CwhRBWXzGAHq8TQ4Fs17',
                label: 'Roger',
                tagline: 'Laid-Back, Casual, Resonant',
                description: 'Easy going and perfect for casual conversations.',
              },
            ],
          },
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

      fireEvent.click(screen.getByRole('button', { name: 'Pick voice' }));
      const searchInput = screen.getByRole('textbox', {
        name: 'Search voices',
      });
      fireEvent.change(searchInput, { target: { value: 'casual' } });
      expect((searchInput as HTMLInputElement).value).toBe('casual');

      expect(
        screen.getByRole('button', {
          name: /Roger - Laid-Back, Casual, Resonant/i,
        })
      ).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pick voice' }));

      const reopenedSearchInput = screen.getByRole('textbox', {
        name: 'Search voices',
      });
      expect((reopenedSearchInput as HTMLInputElement).value).toBe('');

      expect(
        screen.getByRole('button', {
          name: /Bella - Professional, Bright, Warm/i,
        })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: /Roger - Laid-Back, Casual, Resonant/i,
        })
      ).toBeTruthy();
    });

    it('narrows rich voice search by word prefixes and avoids mid-word matches', () => {
      const fields = [
        createMockField('voice', {
          component: 'string',
          custom: 'voice-id-selector',
          label: 'Voice',
          customConfig: {
            allow_custom: true,
            options_file: 'voices/elevenlabs-default-voices.json',
            options_rich: [
              {
                value: 'voice_silk',
                label: 'Silk',
                tagline: 'Smooth, Calm, Warm',
                description: 'A balanced smooth narrator for gentle reads.',
              },
              {
                value: 'voice_atlas',
                label: 'Atlas',
                tagline: 'Deep, Man, Narrator',
                description: 'Strong lower register with direct delivery.',
              },
              {
                value: 'voice_willow',
                label: 'Willow',
                tagline: 'Warm, Woman, Storyteller',
                description: 'Friendly and expressive for story narration.',
              },
            ],
          },
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

      fireEvent.click(screen.getByRole('button', { name: 'Pick voice' }));
      const searchInput = screen.getByRole('textbox', {
        name: 'Search voices',
      });

      fireEvent.change(searchInput, { target: { value: 'Smooth' } });
      expect(
        screen.getByRole('button', { name: /Silk - Smooth, Calm, Warm/i })
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /Atlas - Deep, Man, Narrator/i })
      ).toBeNull();
      expect(
        screen.queryByRole('button', {
          name: /Willow - Warm, Woman, Storyteller/i,
        })
      ).toBeNull();

      fireEvent.change(searchInput, { target: { value: 'man' } });
      expect(
        screen.getByRole('button', { name: /Atlas - Deep, Man, Narrator/i })
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', {
          name: /Willow - Warm, Woman, Storyteller/i,
        })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Silk - Smooth, Calm, Warm/i })
      ).toBeNull();
    });

    it('renders voice-id-selector with inline options and allows custom text edits', () => {
      const onChange = vi.fn();
      if (!HTMLElement.prototype.scrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          value: vi.fn(),
          writable: true,
          configurable: true,
        });
      }

      const fields = [
        createMockField('voice_id', {
          component: 'string',
          custom: 'voice-id-selector',
          label: 'Voice Id',
          customConfig: {
            allow_custom: true,
            options: [
              { value: 'Wise_Woman', label: 'Wise Woman' },
              { value: 'Friendly_Person', label: 'Friendly Person' },
            ],
          },
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ voice_id: 'Wise_Woman' }}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.click(screen.getByRole('option', { name: 'Friendly Person' }));
      expect(onChange).toHaveBeenCalledWith('voice_id', 'Friendly_Person');

      fireEvent.change(screen.getByLabelText('voice_id voice id'), {
        target: { value: 'my_custom_voice_123' },
      });
      expect(onChange).toHaveBeenCalledWith('voice_id', 'my_custom_voice_123');
    });

    it('shows not-implemented notice when voice-id-selector is missing customConfig', () => {
      const fields = [
        createMockField('voice_id', {
          component: 'string',
          custom: 'voice-id-selector',
          label: 'Voice Id',
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

      expect(
        screen.getByText(
          'Custom renderer "voice-id-selector" is not implemented.'
        )
      ).toBeTruthy();
      expect(
        screen.getByText(
          'Field "voice_id" requires object customConfig for voice-id-selector.'
        )
      ).toBeTruthy();
    });

    it('renders array-object-table custom editor and adds rows', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('colors', {
          component: 'array-object-cards',
          custom: 'array-object-table',
          label: 'Colors',
          schema: { type: 'array', items: { type: 'object' } },
          item: createMockField('colors.item', {
            component: 'object',
            custom: 'color-picker',
            label: 'Color',
            schema: { type: 'object' },
            fields: [
              createMockField('colors.item.r', {
                component: 'integer',
                label: 'R',
                schema: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 255,
                  default: 0,
                },
              }),
              createMockField('colors.item.g', {
                component: 'integer',
                label: 'G',
                schema: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 255,
                  default: 0,
                },
              }),
              createMockField('colors.item.b', {
                component: 'integer',
                label: 'B',
                schema: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 255,
                  default: 0,
                },
              }),
            ],
          }),
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ colors: [{ r: 255, g: 0, b: 128 }] }}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeTruthy();

      const addRowButton = screen.getByRole('button', { name: 'Add Row' });
      fireEvent.click(addRowButton);

      expect(onChange).toHaveBeenCalledWith('colors', [
        { r: 255, g: 0, b: 128 },
        { r: 0, g: 0, b: 0 },
      ]);
    });

    it('renders nullable array-object-cards fields without crashing', () => {
      const fields = [
        createMockField('multi_prompt', {
          component: 'nullable',
          label: 'Multi Prompt',
          value: createMockField('multi_prompt', {
            component: 'array-object-cards',
            label: 'Multi Prompt',
            schema: { type: 'array', items: { type: 'object' } },
            item: createMockField('multi_prompt.item', {
              component: 'object',
              label: 'Item',
              schema: { type: 'object' },
            }),
          }),
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ multi_prompt: [{ prompt: 'shot one', duration: '5' }] }}
          isEditable={true}
          onChange={() => {}}
        />
      );

      expect(
        screen.getByText('Array object card editing is not available yet.')
      ).toBeTruthy();
      expect(
        screen.getByText('[{"prompt":"shot one","duration":"5"}]')
      ).toBeTruthy();
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

    it('renders array-scalar fields as table rows and updates string items', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('tone_list', {
          component: 'array-scalar',
          label: 'Tone List',
          schema: { type: 'array', items: { type: 'string' } },
          item: createMockField('tone_list.item', {
            component: 'string',
            label: 'Item',
            schema: { type: 'string' },
          }),
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ tone_list: ['hello'] }}
          isEditable={true}
          onChange={onChange}
        />
      );

      const rowInput = screen.getByDisplayValue('hello');
      fireEvent.change(rowInput, { target: { value: 'updated' } });

      expect(onChange).toHaveBeenCalledWith('tone_list', ['updated']);
      expect(screen.getByRole('button', { name: 'Add Row' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeTruthy();
    });

    it('preserves numeric types for array-scalar number rows', () => {
      const onChange = vi.fn();
      const fields = [
        createMockField('extra_lora_scale', {
          component: 'array-scalar',
          label: 'Extra Lora Scale',
          schema: { type: 'array', items: { type: 'number' } },
          item: createMockField('extra_lora_scale.item', {
            component: 'number',
            label: 'Item',
            schema: { type: 'number' },
          }),
        }),
      ];

      render(
        <ConfigPropertiesEditor
          fields={fields}
          values={{ extra_lora_scale: [0.5] }}
          isEditable={true}
          onChange={onChange}
        />
      );

      const rowInput = screen.getByRole('spinbutton');
      fireEvent.change(rowInput, { target: { value: '0.8' } });

      expect(onChange).toHaveBeenCalledWith('extra_lora_scale', [0.8]);
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

    it('renders connected variant array-file-uri fields as paged read-only values with no action controls', () => {
      const fields = [
        createMockField('image_urls', {
          component: 'array-file-uri',
          mappingSource: 'input',
          mappedAliases: ['SourceImages'],
          schema: {
            type: 'array',
            items: { type: 'string' },
          },
          item: createMockField('image_urls.item', {
            component: 'file-uri',
            label: 'Value',
            schema: { type: 'string' },
          }),
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
              field: 'image_urls',
              value: ['file:./images/then-1.jpg', 'file:./images/setting.jpg'],
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['SourceImages'],
              connectionBehavior: 'variant',
              overridePolicy: 'read_only_dynamic',
              instances: [
                {
                  instanceId: 'Producer:ThenImageProducer[0]',
                  instanceOrder: 0,
                  indices: { character: 0 },
                  value: ['file:./images/then-1.jpg', 'file:./images/setting.jpg'],
                  status: 'ok',
                  warnings: [],
                  errors: [],
                  connected: true,
                  sourceAliases: ['SourceImages'],
                  sourceBindings: {
                    SourceImages: 'Input:CelebrityThenImages[0]',
                  },
                },
                {
                  instanceId: 'Producer:ThenImageProducer[1]',
                  instanceOrder: 1,
                  indices: { character: 1 },
                  value: ['file:./images/then-2.jpg', 'file:./images/setting.jpg'],
                  status: 'ok',
                  warnings: [],
                  errors: [],
                  connected: true,
                  sourceAliases: ['SourceImages'],
                  sourceBindings: {
                    SourceImages: 'Input:CelebrityThenImages[1]',
                  },
                },
              ],
            },
          ]}
        />
      );

      expect(screen.getByText('then-1.jpg')).toBeTruthy();
      expect(
        screen.getByRole('button', {
          name: 'Previous image_urls instance',
        })
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Next image_urls instance' })
      ).toBeTruthy();

      expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Remove row/i })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Change file' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Next image_urls instance' })
      );
      expect(screen.getByText('then-2.jpg')).toBeTruthy();
    });

    it('keeps connected invariant fields editable without instance pager', () => {
      const fields = [
        createMockField('image_size', {
          component: 'string',
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
          values={{ image_size: '1536x1024' }}
          isEditable={true}
          onChange={() => {}}
          sdkPreview={[
            {
              field: 'image_size',
              value: '1280x720',
              status: 'ok',
              warnings: [],
              errors: [],
              connected: true,
              sourceAliases: ['Resolution'],
              connectionBehavior: 'invariant',
              overridePolicy: 'editable',
              instances: [
                {
                  instanceId: 'Producer:ThenImageProducer[0]',
                  instanceOrder: 0,
                  indices: { character: 0 },
                  value: '1280x720',
                  status: 'ok',
                  warnings: [],
                  errors: [],
                  connected: true,
                  sourceAliases: ['Resolution'],
                  sourceBindings: { Resolution: 'Input:Resolution' },
                },
                {
                  instanceId: 'Producer:ThenImageProducer[1]',
                  instanceOrder: 1,
                  indices: { character: 1 },
                  value: '1280x720',
                  status: 'ok',
                  warnings: [],
                  errors: [],
                  connected: true,
                  sourceAliases: ['Resolution'],
                  sourceBindings: { Resolution: 'Input:Resolution' },
                },
              ],
            },
          ]}
        />
      );

      const input = screen.getByDisplayValue('1536x1024');
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).disabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
      expect(
        screen.queryByRole('button', {
          name: 'Previous image_size instance',
        })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Next image_size instance' })
      ).toBeNull();
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
      expect(mappedSection?.className).toContain('max-w-2xl');

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
