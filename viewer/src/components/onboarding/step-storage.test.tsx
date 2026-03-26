/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { browseFolderMock, getBrowseFolderSupportMock } = vi.hoisted(() => ({
  browseFolderMock: vi.fn(),
  getBrowseFolderSupportMock: vi.fn(),
}));

vi.mock('@/data/onboarding-client', () => ({
  browseFolder: browseFolderMock,
  getBrowseFolderSupport: getBrowseFolderSupportMock,
}));

import { StepStorage } from './step-storage';

describe('StepStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBrowseFolderSupportMock.mockResolvedValue({ supported: true });
  });

  it('updates the storage path when browsing succeeds', async () => {
    browseFolderMock.mockResolvedValueOnce({ path: '/tmp/renku-workspace' });
    const onChange = vi.fn();

    render(<StepStorage value='' onChange={onChange} />);

    const browseButton = await screen.findByRole('button', {
      name: 'Browse...',
    });
    fireEvent.click(browseButton);

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

    const browseButton = await screen.findByRole('button', {
      name: 'Browse...',
    });
    fireEvent.click(browseButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hides browse button when native picker support is unavailable', async () => {
    getBrowseFolderSupportMock.mockResolvedValueOnce({
      supported: false,
      reason: 'org.freedesktop.portal.Desktop not available',
    });

    render(<StepStorage value='' onChange={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Native folder picker is unavailable on this system/i)
      ).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Browse...' })).toBeNull();
  });
});
