#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichSchemaWithRenkuConstraints } from './schema-constraints.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const modelsRoot = resolve(repoRoot, 'catalog', 'models');

function parseFlags(argv) {
  const flags = {
    dryRun: false,
    check: false,
  };

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }

    if (arg === '--check') {
      flags.check = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return flags;
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function listJsonFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const absolutePath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === '.json') {
      files.push(absolutePath);
    }
  }

  return files;
}

function resolveTargetSchema(document, filePath) {
  if (!isObjectRecord(document)) {
    throw new Error(`Expected top-level object in ${filePath}`);
  }

  if (isObjectRecord(document.input_schema)) {
    return document.input_schema;
  }

  if (document.type === 'object' && isObjectRecord(document.properties)) {
    return document;
  }

  throw new Error(
    `Expected either "input_schema" object or root JSON schema object in ${filePath}`
  );
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const files = await listJsonFiles(modelsRoot);

  let updated = 0;
  let unchanged = 0;

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');

    let document;
    try {
      document = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const targetSchema = resolveTargetSchema(document, filePath);
    const beforeConstraints = JSON.stringify(
      targetSchema['x-renku-constraints'] ?? null
    );

    enrichSchemaWithRenkuConstraints(targetSchema);

    const afterConstraints = JSON.stringify(
      targetSchema['x-renku-constraints'] ?? null
    );

    if (beforeConstraints === afterConstraints) {
      unchanged += 1;
      continue;
    }

    updated += 1;

    if (!flags.dryRun && !flags.check) {
      await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`);
    }
  }

  const mode = flags.check ? 'check' : flags.dryRun ? 'dry-run' : 'write';
  console.log(
    `[catalog:migrate-schema-constraints] mode=${mode} scanned=${files.length} updated=${updated} unchanged=${unchanged}`
  );

  if (flags.check && updated > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    '[catalog:migrate-schema-constraints] Failed:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
