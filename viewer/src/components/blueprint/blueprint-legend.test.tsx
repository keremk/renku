/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlueprintLegend } from './blueprint-legend';

describe('BlueprintLegend', () => {
  it('shows only dependency and status items for the producer-only graph', () => {
    render(<BlueprintLegend />);

    expect(screen.getByText('Dependency')).toBeTruthy();
    expect(screen.getByText('Conditional dependency')).toBeTruthy();
    expect(screen.getByText('Success')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();

    expect(screen.queryByText('Input')).toBeNull();
    expect(screen.queryByText('Output')).toBeNull();
    expect(screen.queryByText('Producer')).toBeNull();
    expect(screen.queryByText('Connection')).toBeNull();
    expect(screen.queryByText('Conditional')).toBeNull();
  });
});
