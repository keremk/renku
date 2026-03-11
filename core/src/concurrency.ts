export const DEFAULT_CLI_CONCURRENCY = 1;
export const MIN_CLI_CONCURRENCY = 1;
export const MAX_CLI_CONCURRENCY = 10;

export function normalizeCliConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CLI_CONCURRENCY;
  }

  if (!Number.isInteger(value)) {
    throw new Error('Concurrency must be an integer.');
  }

  if (value < MIN_CLI_CONCURRENCY) {
    return MIN_CLI_CONCURRENCY;
  }

  if (value > MAX_CLI_CONCURRENCY) {
    return MAX_CLI_CONCURRENCY;
  }

  return value;
}
