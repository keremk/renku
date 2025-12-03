import { vi } from 'vitest';

vi.mock('@renku/providers', async () => {
  const actual = await vi.importActual<typeof import('@renku/providers')>('@renku/providers');
  return {
    ...actual,
    createProviderRegistry: (options?: Parameters<typeof actual.createProviderRegistry>[0]) =>
      actual.createProviderRegistry({
        ...(options ?? {}),
        mode: 'mock',
      }),
  };
});
