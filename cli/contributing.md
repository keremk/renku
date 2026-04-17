# Contributing

# Dev Environment Setup

The CLI no longer includes an MCP server. For local development, use the standard workspace commands from the repository root:

```bash
pnpm dev:cli
pnpm build:cli
pnpm lint:cli
pnpm type-check:cli
pnpm test:cli
```

If you want to run the CLI test suite directly inside the package, follow the repository rule and run Vitest from `cli/`:

```bash
cd cli && pnpm vitest run --pool=threads --poolOptions.threads.singleThread
```
