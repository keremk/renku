/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { switchBlueprint } from './use-blueprint-route';

describe('switchBlueprint', () => {
  it('clears build-specific params without forcing last build selection', () => {
    window.history.replaceState(
      {},
      '',
      '/blueprints?bp=old-blueprint&build=movie-123&movie=movie-123&in=inputs.yaml&last=1'
    );

    switchBlueprint('new-blueprint');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('bp')).toBe('new-blueprint');
    expect(url.searchParams.has('build')).toBe(false);
    expect(url.searchParams.has('movie')).toBe(false);
    expect(url.searchParams.has('in')).toBe(false);
    expect(url.searchParams.has('last')).toBe(false);
  });
});
