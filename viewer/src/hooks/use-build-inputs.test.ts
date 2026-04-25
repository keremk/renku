/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchBuildInputs, saveBuildInputs } from '@/data/blueprint-client';
import { useBuildInputs } from './use-build-inputs';

vi.mock('@/data/blueprint-client', () => ({
  fetchBuildInputs: vi.fn(),
  saveBuildInputs: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('useBuildInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBuildInputs).mockResolvedValue({
      inputs: { Theme: 'original' },
      models: [],
      inputsPath: '/tmp/inputs.yaml',
    });
  });

  it('keeps the newest input save when overlapping saves resolve out of order', async () => {
    const firstSave = createDeferred<void>();
    const secondSave = createDeferred<void>();
    vi.mocked(saveBuildInputs)
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    const { result } = renderHook(() =>
      useBuildInputs({
        blueprintFolder: '/tmp/blueprint',
        blueprintPath: '/tmp/blueprint/blueprint.yaml',
        selectedBuildId: 'movie-test',
        hasInputsFile: true,
      })
    );

    await waitFor(() => {
      expect(result.current.hasLoadedInputs).toBe(true);
    });

    let firstPromise!: Promise<void>;
    let secondPromise!: Promise<void>;
    await act(async () => {
      firstPromise = result.current.saveInputs({ Theme: 'first draft' });
      secondPromise = result.current.saveInputs({ Theme: 'second draft' });
    });

    await act(async () => {
      secondSave.resolve();
      await secondPromise;
    });
    expect(result.current.inputs?.Theme).toBe('second draft');

    await act(async () => {
      firstSave.resolve();
      await firstPromise;
    });
    expect(result.current.inputs?.Theme).toBe('second draft');
  });
});
