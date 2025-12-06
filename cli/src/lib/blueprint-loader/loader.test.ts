import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadBlueprintBundle } from './loader.js';
import { getBundledBlueprintsRoot } from '../config-assets.js';

describe('loadBlueprintBundle', () => {
  it('loads root and nested sub-blueprints', async () => {
    const bundlePath = resolve(getBundledBlueprintsRoot(), 'cut-scene-video', 'video-audio-music.yaml');
    const bundle = await loadBlueprintBundle(bundlePath);
    expect(bundle.root.id).toBe('VideoAudioMusic');
    expect(bundle.root.children.size).toBeGreaterThan(0);
    const script = bundle.root.children.get('ScriptProducer');
    expect(script?.document.meta.id).toBe('ScriptProducer');
  });
});
