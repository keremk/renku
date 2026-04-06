import { describe, expect, it } from 'vitest';
import { formatViewerMessage } from './format-viewer-message';

describe('formatViewerMessage', () => {
  it('returns plain text messages unchanged', () => {
    expect(formatViewerMessage('Network timeout')).toBe('Network timeout');
  });

  it('removes HTTP wrapper and preserves runtime code', () => {
    const message =
      'Request failed (400): {"error":"Pinned producer \\"Producer:AudioProducer\\" does not produce reusable canonical artifacts.","code":"R137"}';

    const formatted = formatViewerMessage(message);

    expect(formatted).not.toContain('Request failed (400):');
    expect(formatted).toContain('Pinned producer "AudioProducer" does not produce reusable outputs.');
    expect(formatted).toContain('Code: R137');
  });

  it('formats planning warning object without exposing internal metadata', () => {
    const formatted = formatViewerMessage({
      code: 'CONTROL_PIN_OUT_OF_SCOPE',
      control: 'pin',
      targetId: 'Artifact:Audio[0]',
      message:
        'Ignored pin target Artifact:Audio[0] because it is outside active scope.',
    });

    expect(formatted).toBe(
      'Ignored pin target Audio (item 1) because it is outside selected layer range.'
    );
    expect(formatted).not.toContain('CONTROL_PIN_OUT_OF_SCOPE');
  });

  it('rewrites CLI-specific flags to viewer terms', () => {
    const formatted = formatViewerMessage(
      'Pinning requires an existing movie with reusable outputs. Use --last or --movie-id/--id after a successful run.'
    );

    expect(formatted).toContain('latest run');
    expect(formatted).toContain('selected movie');
    expect(formatted).not.toContain('--last');
    expect(formatted).not.toContain('--movie-id');
  });

  it('formats JSON arrays into a readable combined message', () => {
    const formatted = formatViewerMessage(
      '[{"message":"First issue","code":"R101"},{"error":"Second issue"}]'
    );

    expect(formatted).toBe('First issue (Code: R101); Second issue');
  });

  it('drops non-runtime codes from user-facing output', () => {
    const formatted = formatViewerMessage(
      '{"error":"Ignored pin target Artifact:Audio[0] because it is outside active scope.","code":"CONTROL_PIN_OUT_OF_SCOPE"}'
    );

    expect(formatted).toBe(
      'Ignored pin target Audio (item 1) because it is outside selected layer range.'
    );
    expect(formatted).not.toContain('CONTROL_PIN_OUT_OF_SCOPE');
  });

  it('falls back to cleaned non-json payload when parsing fails', () => {
    expect(formatViewerMessage('Request failed (500): not-json payload')).toBe(
      'not-json payload'
    );
  });
});
