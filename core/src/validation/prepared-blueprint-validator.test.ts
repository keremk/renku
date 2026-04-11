import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG_ROOT, TEST_FIXTURES_ROOT } from '../../tests/catalog-paths.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { ValidationErrorCode } from './types.js';
import { validatePreparedBlueprintTree } from './prepared-blueprint-validator.js';

const CONDITION_BLUEPRINT_PATH = resolve(
  TEST_FIXTURES_ROOT,
  'condition-example',
  'condition-example.yaml'
);
const DOCUMENTARY_BLUEPRINT_PATH = resolve(
  TEST_FIXTURES_ROOT,
  '_shared',
  'documentary',
  'documentary.yaml'
);
const tempDirs: string[] = [];

describe('validatePreparedBlueprintTree', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  it('fails when a producer metadata output schema file is missing', async () => {
    const blueprintPath = await createPreparedValidationFixture({
      documentaryOutputSchemaPath: './missing-output.json',
    });
    const { root } = await loadYamlBlueprintTree(blueprintPath, {
      catalogRoot: CATALOG_ROOT,
    });

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(result.validation.valid).toBe(false);
    expect(result.context).toBeUndefined();
    expect(result.validation.errors).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED,
        message: expect.stringContaining('Failed to load output schema'),
      })
    );
  });

  it('fails when a schema-derived edge path does not resolve to a prepared graph node', async () => {
    const blueprintPath = await createPreparedValidationFixture({
      rootBlueprintReplacements: [
        ['ImagePrompts[image]', 'ImagPrompts[image]'],
      ],
    });
    const { root } = await loadYamlBlueprintTree(blueprintPath, {
      catalogRoot: CATALOG_ROOT,
    });

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_NESTED_PATH,
        message: expect.stringContaining('ImagPrompts'),
      })
    );
  });

  it('returns a prepared context with schema-derived graph nodes for valid blueprints', async () => {
    const { root } = await loadYamlBlueprintTree(DOCUMENTARY_BLUEPRINT_PATH, {
      catalogRoot: CATALOG_ROOT,
    });

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(result.context).toBeDefined();
    expect(
      result.context?.graph.nodes.some(
        (node) => node.id === 'VideoScript.Segments[segment].NarrationType'
      )
    ).toBe(true);
    expect(
      result.validation.errors.some(
        (error) =>
          error.code === ValidationErrorCode.BLUEPRINT_VALIDATION_FAILED
      )
    ).toBe(false);
  });
});

async function createPreparedValidationFixture(args: {
  documentaryOutputSchemaPath?: string;
  rootBlueprintReplacements?: Array<[string, string]>;
}): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'renku-prepared-validation-'));
  tempDirs.push(tempDir);

  const documentaryDir = resolve(tempDir, 'documentary');
  await cp(resolve(TEST_FIXTURES_ROOT, '_shared', 'documentary'), documentaryDir, {
    recursive: true,
  });

  let rootBlueprint = await readFile(CONDITION_BLUEPRINT_PATH, 'utf8');
  rootBlueprint = rootBlueprint.replace(
    '../_shared/documentary/documentary.yaml',
    './documentary/documentary.yaml'
  );
  for (const [from, to] of args.rootBlueprintReplacements ?? []) {
    rootBlueprint = rootBlueprint.replace(from, to);
  }

  let documentaryBlueprint = await readFile(DOCUMENTARY_BLUEPRINT_PATH, 'utf8');
  if (args.documentaryOutputSchemaPath) {
    documentaryBlueprint = documentaryBlueprint.replace(
      './documentary-output.json',
      args.documentaryOutputSchemaPath
    );
  }

  await writeFile(resolve(tempDir, 'condition-example.yaml'), rootBlueprint, 'utf8');
  await writeFile(
    resolve(documentaryDir, 'documentary.yaml'),
    documentaryBlueprint,
    'utf8'
  );

  return resolve(tempDir, 'condition-example.yaml');
}
