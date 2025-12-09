# Integration Tests

These integration tests call real API providers (OpenAI, Replicate, etc.) and are expensive/slow.

## Running Tests

By default, tests are skipped unless specific environment variables are set. See individual test files for available environment variables.

Example:
```bash
RUN_VIDEO_SEEDANCE_PRO_FAST=1 pnpm test:integration
```

## Saving Test Artifacts

By default, generated files (videos, images, audio, etc.) are **not** saved to disk.

To save test artifacts for manual inspection, set the `SAVE_TEST_ARTIFACTS` environment variable:

```bash
SAVE_TEST_ARTIFACTS=1 RUN_VIDEO_VEO_FAST=1 pnpm test:integration
```

Generated files will be saved to `providers/tmp/` which is git-ignored.

### Using .env file

You can create a `.env` file in the `providers` directory:

```env
REPLICATE_API_TOKEN=your-token-here
SAVE_TEST_ARTIFACTS=1
RUN_ALL_VIDEO_TESTS=1
```

The tests will automatically load environment variables from the `.env` file using dotenv.
