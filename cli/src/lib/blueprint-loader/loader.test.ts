import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from './loader.js';
import { CATALOG_ROOT, CLI_FIXTURES_BLUEPRINTS } from '../../../tests/test-catalog-paths.js';

describe('loadBlueprintBundle', () => {
  it('loads root and nested sub-blueprints', async () => {
    const bundlePath = resolve(CLI_FIXTURES_BLUEPRINTS, 'cut-scene-video', 'video-audio-music.yaml');
    const bundle = await loadBlueprintBundle(bundlePath, { catalogRoot: CATALOG_ROOT });
    expect(bundle.root.id).toBe('VideoAudioMusic');
    expect(bundle.root.children.size).toBeGreaterThan(0);
    const script = bundle.root.children.get('ScriptProducer');
    expect(script?.document.meta.id).toBe('ScriptProducer');
  });
});
