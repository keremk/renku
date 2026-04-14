/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileUriValueControl } from './file-uri-value-control';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';

function createImageField(): ConfigFieldDescriptor {
  return {
    keyPath: 'image_urls.item',
    component: 'file-uri',
    label: 'Value',
    required: false,
    mappingSource: 'none',
    mappedAliases: [],
    schema: {
      type: 'string',
      title: 'Image URL',
      description: 'Image URL',
    },
  };
}

describe('FileUriValueControl', () => {
  it('renders viewer build blob urls as previewable build media instead of raw url text', () => {
    render(
      <FileUriValueControl
        field={createImageField()}
        value='/viewer-api/blueprints/blob?folder=%2Ftmp%2Fdemo&movieId=movie-1&hash=abc123'
        isEditable={false}
        showActionControls={false}
        onChange={() => {}}
        onRemove={() => {}}
      />
    );

    expect(screen.getByText('Build media')).toBeTruthy();

    const image = screen.getByRole('img', { name: 'Build media' });
    expect(image.getAttribute('src')).toContain(
      '/viewer-api/blueprints/blob?folder=%2Ftmp%2Fdemo&movieId=movie-1&hash=abc123'
    );
  });
});
