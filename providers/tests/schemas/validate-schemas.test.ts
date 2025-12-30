import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { CATALOG_PRODUCERS_ROOT } from '../test-catalog-paths.js';

const SCHEMAS_ROOT = CATALOG_PRODUCERS_ROOT;

async function listJsonSchemas(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsonSchemas(full)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.json') {
      files.push(full);
    }
  }
  return files;
}

describe('blueprint module schemas', () => {
  it('all JSON schemas compile with Ajv', async () => {
    // Ensure root exists (sanity guard)
    const stats = await stat(SCHEMAS_ROOT);
    expect(stats.isDirectory()).toBe(true);

    const schemaPaths = await listJsonSchemas(SCHEMAS_ROOT);
    expect(schemaPaths.length).toBeGreaterThan(0);

    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    for (const schemaPath of schemaPaths) {
      const contents = await readFile(schemaPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch (error) {
        throw new Error(`Schema "${schemaPath}" is not valid JSON: ${(error as Error).message}`);
      }
      try {
        ajv.compile(parsed as any);
      } catch (error) {
        throw new Error(`Schema "${schemaPath}" failed meta validation: ${(error as Error).message}`);
      }
    }
  });
});
