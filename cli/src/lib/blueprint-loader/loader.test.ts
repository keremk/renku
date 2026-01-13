import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from './loader.js';
import { CATALOG_ROOT } from '../../../tests/test-catalog-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const E2E_FIXTURES_ROOT = resolve(__dirname, '..', '..', '..', 'tests', 'end-to-end', 'fixtures');

describe('loadBlueprintBundle', () => {
  it('loads root and nested sub-blueprints', async () => {
    const bundlePath = resolve(E2E_FIXTURES_ROOT, 'cut-scene-video', 'video-audio-music.yaml');
    const bundle = await loadBlueprintBundle(bundlePath, { catalogRoot: CATALOG_ROOT });
    expect(bundle.root.id).toBe('VideoAudioMusic');
    expect(bundle.root.children.size).toBeGreaterThan(0);
    const script = bundle.root.children.get('ScriptProducer');
    expect(script?.document.meta.id).toBe('ScriptProducer');
  });
});
