/**
 * @vitest-environment jsdom
 */

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateBuildDialog } from './create-build-dialog';

vi.mock('@/data/blueprint-client', () => ({
  createBuild: vi.fn(),
}));

vi.mock('@/hooks/use-blueprint-route', () => ({
  updateBlueprintRoute: vi.fn(),
}));

import { createBuild } from '@/data/blueprint-client';
import { updateBlueprintRoute } from '@/hooks/use-blueprint-route';

function DialogHarness({
  onRefresh = vi.fn().mockResolvedValue(undefined),
}: {
  onRefresh?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button type='button' onClick={() => setOpen(true)}>
        reopen
      </button>
      <CreateBuildDialog
        open={open}
        onOpenChange={setOpen}
        blueprintFolder='/tmp/blueprints/example'
        onRefresh={onRefresh}
      />
    </div>
  );
}

describe('CreateBuildDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates an unnamed build and closes after success', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createBuild).mockResolvedValue({
      movieId: 'movie-1',
      inputsPath: '/tmp/blueprints/example/builds/movie-1/inputs.yaml',
    });

    render(<DialogHarness onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create Build' }));

    await waitFor(() => {
      expect(createBuild).toHaveBeenCalledWith(
        '/tmp/blueprints/example',
        undefined
      );
    });

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
      expect(updateBlueprintRoute).toHaveBeenCalledWith('movie-1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Create New Build')).toBeNull();
    });
  });

  it('shows an inline error and keeps the dialog open when creation fails', async () => {
    vi.mocked(createBuild).mockRejectedValue(new Error('Creation failed badly'));

    render(<DialogHarness />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Test Run' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Build' }));

    await waitFor(() => {
      expect(screen.getByText('Creation failed badly')).toBeTruthy();
    });

    expect(screen.getByText('Create New Build')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Test Run'
    );
  });

  it('resets the input when the dialog is closed and reopened', async () => {
    render(<DialogHarness />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Temporary Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Create New Build')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'reopen' }));

    await waitFor(() => {
      expect(screen.getByText('Create New Build')).toBeTruthy();
    });

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
