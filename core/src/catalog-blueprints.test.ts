import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertValidBlueprintName,
  createBlueprintFromTemplate,
  listCatalogBlueprintTemplates,
} from './catalog-blueprints.js';
import { isRenkuError, RuntimeErrorCode } from './errors/index.js';

const MINIMAL_BLUEPRINT_YAML = `meta:
  name: Template Title
  description: Template description
  id: TemplateId
  version: 0.1.0

artifacts:
  - name: OutputImage
    type: image
`;

describe('assertValidBlueprintName', () => {
  it('accepts kebab-case names', () => {
    expect(() => assertValidBlueprintName('my-blueprint')).not.toThrow();
  });

  it('throws for invalid names', () => {
    expect(() => assertValidBlueprintName('My Blueprint')).toThrow(
      'Blueprint name must be in kebab-case'
    );
  });
});

describe('listCatalogBlueprintTemplates', () => {
  it('lists templates sorted by folder name using meta fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-catalog-list-'));
    try {
      const catalogRoot = join(root, 'catalog');
      await createTemplate(
        catalogRoot,
        'z-template',
        'Zeta Story',
        'Zeta desc'
      );
      await createTemplate(
        catalogRoot,
        'a-template',
        'Alpha Story',
        'Alpha desc'
      );

      const templates = await listCatalogBlueprintTemplates(catalogRoot);

      expect(templates).toEqual([
        {
          name: 'a-template',
          title: 'Alpha Story',
          description: 'Alpha desc',
        },
        {
          name: 'z-template',
          title: 'Zeta Story',
          description: 'Zeta desc',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws when input-template.yaml is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-catalog-missing-input-'));
    try {
      const templateFolder = join(
        root,
        'catalog',
        'blueprints',
        'broken-template'
      );
      await mkdir(templateFolder, { recursive: true });
      await writeFile(
        join(templateFolder, 'broken-template.yaml'),
        MINIMAL_BLUEPRINT_YAML,
        'utf8'
      );

      await expect(
        listCatalogBlueprintTemplates(join(root, 'catalog'))
      ).rejects.toThrow('missing input-template.yaml');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('createBlueprintFromTemplate', () => {
  it('copies a template and renames the blueprint yaml to the new name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-create-from-template-'));
    try {
      const catalogRoot = join(root, 'catalog');
      await createTemplate(
        catalogRoot,
        'flow-video',
        'Flow Video',
        'Flow desc',
        {
          blueprintFilename: 'continuous-video.yaml',
        }
      );

      const nestedDir = join(
        catalogRoot,
        'blueprints',
        'flow-video',
        'scenario-prompt'
      );
      await mkdir(nestedDir, { recursive: true });
      await writeFile(
        join(nestedDir, 'scenario-prompt.toml'),
        'hello = "world"'
      );

      const result = await createBlueprintFromTemplate({
        blueprintName: 'my-new-video',
        templateName: 'flow-video',
        outputDir: join(root, 'workspace'),
        catalogRoot,
      });

      expect(result.folderPath).toBe(
        resolve(root, 'workspace', 'my-new-video')
      );
      expect(result.blueprintPath).toBe(
        resolve(root, 'workspace', 'my-new-video', 'my-new-video.yaml')
      );

      await expect(
        access(resolve(root, 'workspace', 'my-new-video', 'my-new-video.yaml'))
      ).resolves.toBeUndefined();

      await expect(
        access(
          resolve(root, 'workspace', 'my-new-video', 'continuous-video.yaml')
        )
      ).rejects.toThrow();

      const copiedPrompt = await readFile(
        resolve(
          root,
          'workspace',
          'my-new-video',
          'scenario-prompt',
          'scenario-prompt.toml'
        ),
        'utf8'
      );
      expect(copiedPrompt).toBe('hello = "world"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws when destination folder already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-create-existing-'));
    try {
      const catalogRoot = join(root, 'catalog');
      await createTemplate(catalogRoot, 'ads', 'Ads', 'Ads desc');

      const existingFolder = join(root, 'workspace', 'already-exists');
      await mkdir(existingFolder, { recursive: true });

      await expect(
        createBlueprintFromTemplate({
          blueprintName: 'already-exists',
          templateName: 'ads',
          outputDir: join(root, 'workspace'),
          catalogRoot,
        })
      ).rejects.toMatchObject({
        code: RuntimeErrorCode.STORAGE_PATH_ESCAPE,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('throws CATALOG_BLUEPRINT_NOT_FOUND for unknown templates', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'renku-create-missing-template-')
    );
    try {
      const catalogRoot = join(root, 'catalog');
      await mkdir(join(catalogRoot, 'blueprints'), { recursive: true });

      try {
        await createBlueprintFromTemplate({
          blueprintName: 'new-blueprint',
          templateName: 'does-not-exist',
          outputDir: join(root, 'workspace'),
          catalogRoot,
        });
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect(isRenkuError(error)).toBe(true);
        if (isRenkuError(error)) {
          expect(error.code).toBe(RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects template names that escape catalog/blueprints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-create-template-escape-'));
    try {
      const catalogRoot = join(root, 'catalog');
      await mkdir(join(catalogRoot, 'blueprints'), { recursive: true });

      const escapedTemplateFolder = join(catalogRoot, 'escaped-template');
      await mkdir(escapedTemplateFolder, { recursive: true });
      await writeFile(
        join(escapedTemplateFolder, 'escaped-template.yaml'),
        MINIMAL_BLUEPRINT_YAML,
        'utf8'
      );
      await writeFile(
        join(escapedTemplateFolder, 'input-template.yaml'),
        'inputs: {}\nmodels: []\n',
        'utf8'
      );

      await expect(
        createBlueprintFromTemplate({
          blueprintName: 'new-blueprint',
          templateName: '../escaped-template',
          outputDir: join(root, 'workspace'),
          catalogRoot,
        })
      ).rejects.toMatchObject({
        code: RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
        message: 'Blueprint "../escaped-template" not found in the catalog.',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTemplate(
  catalogRoot: string,
  templateName: string,
  title: string,
  description: string,
  options: {
    blueprintFilename?: string;
  } = {}
): Promise<void> {
  const templateFolder = join(catalogRoot, 'blueprints', templateName);
  await mkdir(templateFolder, { recursive: true });

  const blueprintFilename = options.blueprintFilename ?? `${templateName}.yaml`;
  const blueprintYaml = MINIMAL_BLUEPRINT_YAML.replace(
    'Template Title',
    title
  ).replace('Template description', description);

  await writeFile(
    join(templateFolder, blueprintFilename),
    blueprintYaml,
    'utf8'
  );
  await writeFile(
    join(templateFolder, 'input-template.yaml'),
    'inputs: {}\nmodels: []\n',
    'utf8'
  );
}
