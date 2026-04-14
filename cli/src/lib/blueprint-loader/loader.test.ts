import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from './loader.js';
import {
  CATALOG_ROOT,
  CLI_FIXTURES_BLUEPRINTS,
  SHARED_TEST_CATALOG_ROOT,
} from '../../../tests/test-catalog-paths.js';

describe('loadBlueprintBundle', () => {
  it('loads root and nested sub-blueprints', async () => {
    const bundlePath = resolve(CLI_FIXTURES_BLUEPRINTS, 'pipeline-orchestration', 'video-audio-music-timeline', 'video-audio-music-timeline.yaml');
    const bundle = await loadBlueprintBundle(bundlePath, { catalogRoot: CATALOG_ROOT });
    expect(bundle.root.id).toBe('VideoAudioMusic');
    expect(bundle.root.children.size).toBeGreaterThan(0);
    const script = bundle.root.children.get('ScriptProducer');
    expect(script?.document.meta.id).toBe('ScriptProducer');
  });

  it('loads local composite producer fixtures through path imports', async () => {
    const bundlePath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'composite-local-video',
      'composite-local-video.yaml'
    );
    const bundle = await loadBlueprintBundle(bundlePath, {
      catalogRoot: CATALOG_ROOT,
    });

    const composite = bundle.root.children.get('SegmentUnit');
    expect(composite?.document.meta.id).toBe('SegmentUnit');
    expect(composite?.children.has('PrepImage')).toBe(true);
    expect(composite?.children.has('MainVideo')).toBe(true);
  });

  it('loads catalog composite producer fixtures from direct-file modules', async () => {
    const bundlePath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'composite-catalog-video',
      'composite-catalog-video.yaml'
    );
    const bundle = await loadBlueprintBundle(bundlePath, {
      catalogRoot: SHARED_TEST_CATALOG_ROOT,
    });

    const composite = bundle.root.children.get('VoiceConditionedVideo');
    expect(composite?.document.meta.id).toBe('DirectCompositeVideo');
    expect(composite?.children.has('PrepImage')).toBe(true);
    expect(composite?.children.has('MainVideo')).toBe(true);
  });

  it('loads catalog composite producer fixtures from nested-folder modules', async () => {
    const bundlePath = resolve(
      CLI_FIXTURES_BLUEPRINTS,
      'pipeline-orchestration',
      'composite-catalog-nested-video',
      'composite-catalog-nested-video.yaml'
    );
    const bundle = await loadBlueprintBundle(bundlePath, {
      catalogRoot: SHARED_TEST_CATALOG_ROOT,
    });

    const composite = bundle.root.children.get('NestedVideoUnit');
    expect(composite?.document.meta.id).toBe('NestedCompositeVideo');
    expect(composite?.children.has('PrepImage')).toBe(true);
    expect(composite?.children.has('MainVideo')).toBe(true);
  });
});
