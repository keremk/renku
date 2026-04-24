import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  it('fails when a whole-object schema-backed producer output reference does not resolve', async () => {
    const blueprintPath = await createWholeObjectPreparedValidationFixture({
      sourceReference: 'SourceDirector.AssetPlann',
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
        message: expect.stringContaining('AssetPlann'),
      })
    );
  });

  it('accepts whole-object schema-backed producer output references when they resolve', async () => {
    const blueprintPath = await createWholeObjectPreparedValidationFixture({
      sourceReference: 'SourceDirector.AssetPlan',
    });
    const { root } = await loadYamlBlueprintTree(blueprintPath, {
      catalogRoot: CATALOG_ROOT,
    });

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it('accepts fixed item condition references for schema-derived array fields', async () => {
    const blueprintPath = await createPreparedValidationFixture({
      rootBlueprintReplacements: [
        [
          'DocProducer.VideoScript.Segments[segment].NarrationType',
          'DocProducer.VideoScript.Segments[0].NarrationType',
        ],
      ],
    });
    const { root } = await loadYamlBlueprintTree(blueprintPath, {
      catalogRoot: CATALOG_ROOT,
    });

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(result.validation.errors).not.toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.CONDITION_PATH_INVALID,
        message: expect.stringContaining('Segments[0].NarrationType'),
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
        (node) =>
          node.id === 'Output:VideoScript.Segments[segment].NarrationType'
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

async function createWholeObjectPreparedValidationFixture(args: {
  sourceReference: string;
}): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'renku-prepared-whole-object-'));
  tempDirs.push(tempDir);
  await mkdir(resolve(tempDir, 'source'), { recursive: true });
  await mkdir(resolve(tempDir, 'target'), { recursive: true });

  const rootBlueprint = `meta:
  name: Whole Object Validation Fixture
  id: WholeObjectValidationFixture
  version: 0.1.0

inputs:
  - name: NumOfSegments
    type: int
    required: true

outputs:
  - name: Result
    type: string
    required: true

imports:
  - name: SourceDirector
    path: ./source/source.yaml
  - name: TargetDirector
    path: ./target/target.yaml

connections:
  - from: NumOfSegments
    to: SourceDirector.NumOfSegments
  - from: ${args.sourceReference}
    to: TargetDirector.AssetPlan
  - from: TargetDirector.Result
    to: Result
`;

  const sourceProducer = `meta:
  name: Source Director
  id: SourceDirector
  kind: producer
  version: 0.1.0
  outputSchema: ./source-output.json

inputs:
  - name: NumOfSegments
    type: int
    required: true

outputs:
  - name: AssetPlan
    type: json
    arrays:
      - path: Segments
        countInput: NumOfSegments
`;

  const targetProducer = `meta:
  name: Target Director
  id: TargetDirector
  kind: producer
  version: 0.1.0

inputs:
  - name: AssetPlan
    type: json
    required: true

outputs:
  - name: Result
    type: string
`;

  const sourceSchema = JSON.stringify(
    {
      name: 'AssetPlan',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          Segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Title: { type: 'string' },
              },
              required: ['Title'],
              additionalProperties: false,
            },
          },
        },
        required: ['Segments'],
        additionalProperties: false,
      },
    },
    null,
    2
  );

  await writeFile(resolve(tempDir, 'root.yaml'), rootBlueprint, 'utf8');
  await writeFile(resolve(tempDir, 'source', 'source.yaml'), sourceProducer, 'utf8');
  await writeFile(
    resolve(tempDir, 'source', 'source-output.json'),
    sourceSchema,
    'utf8'
  );
  await writeFile(resolve(tempDir, 'target', 'target.yaml'), targetProducer, 'utf8');

  return resolve(tempDir, 'root.yaml');
}
