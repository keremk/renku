/**
 * @vitest-environment jsdom
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

const {
  fetchViewerSettingsMock,
  updateViewerStorageRootMock,
  updateViewerApiTokensMock,
  updateViewerArtifactsSettingsMock,
  updateViewerConcurrencyMock,
  browseFolderMock,
  getBrowseFolderSupportMock,
} = vi.hoisted(() => ({
  fetchViewerSettingsMock: vi.fn(),
  updateViewerStorageRootMock: vi.fn(),
  updateViewerApiTokensMock: vi.fn(),
  updateViewerArtifactsSettingsMock: vi.fn(),
  updateViewerConcurrencyMock: vi.fn(),
  browseFolderMock: vi.fn(),
  getBrowseFolderSupportMock: vi.fn(),
}));

vi.mock('@/components/layout/viewer-page-header', () => ({
  ViewerPageHeader: ({ subtitle }: { subtitle: string }) => (
    <div>{subtitle}</div>
  ),
}));

vi.mock('@/hooks/use-blueprint-route', () => ({
  navigateToPath: vi.fn(),
}));

vi.mock('@/data/settings-client', () => ({
  fetchViewerSettings: fetchViewerSettingsMock,
  updateViewerStorageRoot: updateViewerStorageRootMock,
  updateViewerApiTokens: updateViewerApiTokensMock,
  updateViewerArtifactsSettings: updateViewerArtifactsSettingsMock,
  updateViewerConcurrency: updateViewerConcurrencyMock,
}));

vi.mock('@/data/onboarding-client', () => ({
  browseFolder: browseFolderMock,
  getBrowseFolderSupport: getBrowseFolderSupportMock,
}));

import { SettingsPage } from './settings-page';
import {
  fetchViewerSettings,
  updateViewerStorageRoot,
} from '@/data/settings-client';

const SETTINGS_SNAPSHOT = {
  storageRoot: '/Users/test/Renku',
  storageFolderName: 'Renku',
  apiTokens: {
    fal: '',
    replicate: '',
    elevenlabs: '',
    openai: '',
    vercelGateway: '',
  },
  artifacts: {
    enabled: true,
    mode: 'copy' as const,
  },
  concurrency: 1,
};

const originalResizeObserver = globalThis.ResizeObserver;

describe('SettingsPage storage location controls', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fetchViewerSettings).mockResolvedValue(SETTINGS_SNAPSHOT);
    updateViewerStorageRootMock.mockResolvedValue({
      ok: true,
      storageRoot: '/Users/test/Renku-Updated',
      catalogRoot: '/Users/test/Renku-Updated/catalog',
      mode: 'initialized',
    });
    updateViewerApiTokensMock.mockResolvedValue(undefined);
    updateViewerArtifactsSettingsMock.mockResolvedValue({
      ok: true,
      artifacts: {
        enabled: true,
        mode: 'copy',
      },
    });
    updateViewerConcurrencyMock.mockResolvedValue({
      ok: true,
      concurrency: 1,
    });
    browseFolderMock.mockResolvedValue({ path: null });
    getBrowseFolderSupportMock.mockResolvedValue({ supported: true });
  });

  it('shows only the Change action in the main storage row', async () => {
    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /^Select$/ })).toBeNull();
  });

  it('shows storage update errors inside the confirmation dialog', async () => {
    const errorMessage =
      'Server has no catalog path configured. Restart using "renku launch".';
    vi.mocked(updateViewerStorageRoot).mockRejectedValueOnce(
      new Error(errorMessage)
    );

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    const storageInput = await screen.findByLabelText('New storage location');
    fireEvent.change(storageInput, {
      target: { value: '/Users/test/NewRenku' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Change' }));

    await waitFor(() => {
      expect(updateViewerStorageRoot).toHaveBeenCalledWith({
        storageRoot: '/Users/test/NewRenku',
        migrateContent: false,
        allowNonEmptyTarget: false,
      });
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(errorMessage)).toBeTruthy();
  });

  it('requires explicit confirmation for non-empty target folders', async () => {
    const confirmationError = Object.assign(
      new Error('Target folder has existing files.'),
      { status: 409 }
    );

    vi.mocked(updateViewerStorageRoot)
      .mockRejectedValueOnce(confirmationError)
      .mockResolvedValueOnce({
        ok: true,
        storageRoot: '/Users/test/NewRenku',
        catalogRoot: '/Users/test/NewRenku/catalog',
        mode: 'initialized',
      });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    const storageInput = await screen.findByLabelText('New storage location');
    fireEvent.change(storageInput, {
      target: { value: '/Users/test/NewRenku' },
    });

    const confirmButton = screen.getByRole('button', {
      name: 'Confirm Change',
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('Allow existing target content')).toBeTruthy();
      expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    });

    fireEvent.click(
      screen.getByRole('switch', { name: 'Allow existing target content' })
    );

    await waitFor(() => {
      expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(updateViewerStorageRoot).toHaveBeenLastCalledWith({
        storageRoot: '/Users/test/NewRenku',
        migrateContent: false,
        allowNonEmptyTarget: true,
      });
    });
  });

  it('hides folder picker action when native picker is unavailable', async () => {
    getBrowseFolderSupportMock.mockResolvedValueOnce({
      supported: false,
      reason: 'xdg-desktop-portal unavailable',
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    await waitFor(() => {
      expect(
        screen.getByText(/Native folder picker is unavailable on this system/i)
      ).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Select Folder' })).toBeNull();
  });
});
