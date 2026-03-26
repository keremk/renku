/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { browseFolderMock } = vi.hoisted(() => ({
  browseFolderMock: vi.fn(),
}));

vi.mock('@/data/onboarding-client', () => ({
  browseFolder: browseFolderMock,
}));

import { StepStorage } from './step-storage';

describe('StepStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the storage path when browsing succeeds', async () => {
    browseFolderMock.mockResolvedValueOnce({ path: '/tmp/renku-workspace' });
    const onChange = vi.fn();

    render(<StepStorage value='' onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse...' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('/tmp/renku-workspace');
    });
  });

  it('shows browse errors from the API', async () => {
    const errorMessage =
      'Could not open a native folder picker. Linux requires xdg-desktop-portal.';
    browseFolderMock.mockRejectedValueOnce(new Error(errorMessage));
    const onChange = vi.fn();

    render(<StepStorage value='' onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse...' }));

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
