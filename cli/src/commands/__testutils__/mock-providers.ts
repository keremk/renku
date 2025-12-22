import { vi } from 'vitest';

vi.mock('@gorenku/providers', async () => {
  const actual = await vi.importActual<typeof import('@gorenku/providers')>('@gorenku/providers');
  return {
    ...actual,
    createProviderRegistry: (options?: Parameters<typeof actual.createProviderRegistry>[0]) =>
      actual.createProviderRegistry({
        ...(options ?? {}),
        mode: 'mock',
      }),
  };
});
