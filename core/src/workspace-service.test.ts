import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createWorkspaceService,
  WorkspaceSwitchConfirmationRequiredError,
} from './workspace-service.js';
import {
  initWorkspace,
  readCliConfig,
  writeCliConfig,
  type CliConfig,
} from './workspace.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'renku-workspace-service-test-'));
}

async function createCatalogSource(
  rootDir: string,
  sampleContent = 'name: sample'
): Promise<string> {
  const catalogSource = join(rootDir, 'catalog-source');
  await mkdir(join(catalogSource, 'blueprints'), { recursive: true });
  await mkdir(join(catalogSource, 'models'), { recursive: true });
  await mkdir(join(catalogSource, 'producers'), { recursive: true });
  await writeFile(
    join(catalogSource, 'blueprints', 'sample.yaml'),
    sampleContent,
    'utf8'
  );
  return catalogSource;
}

describe('createWorkspaceService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('switches to an existing workspace when required', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const secondaryConfigPath = join(tempDir, 'cli-config-b.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });
    await initWorkspace({
      rootFolder: workspaceB,
      catalogSourceRoot,
      configPath: secondaryConfigPath,
    });

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      requireExistingWorkspace: true,
      syncCatalog: false,
    });

    expect(result.mode).toBe('switched-existing');
    expect(result.rootFolder).toBe(resolve(workspaceB));

    const config = await readCliConfig(configPath);
    expect(config?.storage.root).toBe(resolve(workspaceB));
    expect(config?.catalog?.root).toBe(resolve(workspaceB, 'catalog'));
  });

  it('throws when existing workspace is required but target is not initialized', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const invalidTarget = join(tempDir, 'not-a-workspace');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });
    await mkdir(invalidTarget, { recursive: true });

    await expect(
      service.switchWorkspaceRoot({
        targetRootFolder: invalidTarget,
        catalogSourceRoot,
        configPath,
        migrateContent: false,
        requireExistingWorkspace: true,
        syncCatalog: false,
      })
    ).rejects.toThrow(/Not a valid Renku workspace/);
  });

  it('rejects workspaces with incomplete catalog structure', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const incompleteWorkspace = join(tempDir, 'workspace-incomplete');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    await mkdir(join(incompleteWorkspace, 'catalog', 'blueprints'), {
      recursive: true,
    });
    await writeFile(
      join(incompleteWorkspace, 'catalog', 'blueprints', 'sample.yaml'),
      'name: sample',
      'utf8'
    );

    await expect(
      service.switchWorkspaceRoot({
        targetRootFolder: incompleteWorkspace,
        catalogSourceRoot,
        configPath,
        migrateContent: false,
        requireExistingWorkspace: true,
        syncCatalog: false,
      })
    ).rejects.toThrow(/Not a valid Renku workspace/);
  });

  it('does not treat placeholder-only catalog folders as existing workspaces', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const placeholderWorkspace = join(tempDir, 'workspace-placeholder');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    await mkdir(join(placeholderWorkspace, 'catalog'), {
      recursive: true,
    });
    await writeFile(
      join(placeholderWorkspace, 'catalog', '.DS_Store'),
      '',
      'utf8'
    );

    await expect(
      service.switchWorkspaceRoot({
        targetRootFolder: placeholderWorkspace,
        catalogSourceRoot,
        configPath,
        migrateContent: false,
        requireExistingWorkspace: true,
        syncCatalog: false,
      })
    ).rejects.toThrow(/Not a valid Renku workspace/);
  });

  it('initializes a new workspace when target is empty and switching is allowed', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    const updatedConfig: CliConfig = {
      storage: { root: workspaceA, basePath: 'builds' },
      catalog: { root: resolve(workspaceA, 'catalog') },
      concurrency: 3,
      viewer: { host: '127.0.0.1', port: 4455 },
    };
    await writeCliConfig(updatedConfig, configPath);

    await mkdir(workspaceB, { recursive: true });

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      requireExistingWorkspace: false,
      syncCatalog: true,
    });

    expect(result.mode).toBe('initialized');

    const config = await readCliConfig(configPath);
    expect(config?.storage.root).toBe(resolve(workspaceB));
    expect(config?.concurrency).toBe(3);
    expect(config?.viewer?.port).toBe(4455);

    const copiedBlueprint = await readFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(copiedBlueprint).toBe('name: sample');
  });

  it('initializes a new workspace when target only has placeholder files', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    await mkdir(workspaceB, { recursive: true });
    await writeFile(join(workspaceB, '.gitignore'), '*\n!.gitignore\n', 'utf8');

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      requireExistingWorkspace: false,
      syncCatalog: true,
    });

    expect(result.mode).toBe('initialized');
    expect(result.rootFolder).toBe(resolve(workspaceB));
  });

  it('rejects target folders with non-placeholder files', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    await mkdir(workspaceB, { recursive: true });
    await writeFile(join(workspaceB, 'README.md'), 'occupied', 'utf8');

    await expect(
      service.switchWorkspaceRoot({
        targetRootFolder: workspaceB,
        catalogSourceRoot,
        configPath,
        migrateContent: false,
        allowNonEmptyTarget: false,
        requireExistingWorkspace: false,
        syncCatalog: true,
      })
    ).rejects.toBeInstanceOf(WorkspaceSwitchConfirmationRequiredError);
  });

  it('adopts non-empty target folders when explicitly allowed', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    await mkdir(workspaceB, { recursive: true });
    await writeFile(join(workspaceB, 'README.md'), 'occupied', 'utf8');

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      allowNonEmptyTarget: true,
      requireExistingWorkspace: false,
      syncCatalog: true,
    });

    expect(result.mode).toBe('initialized');

    const existingFile = await readFile(join(workspaceB, 'README.md'), 'utf8');
    expect(existingFile).toBe('occupied');
  });

  it('migrates existing workspace content when migrateContent is enabled', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(tempDir);
    const configPath = join(tempDir, 'cli-config.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });

    const customBlueprintFolder = join(workspaceA, 'my-blueprint');
    await mkdir(customBlueprintFolder, { recursive: true });
    await writeFile(
      join(customBlueprintFolder, 'my-blueprint.yaml'),
      'name: my-blueprint',
      'utf8'
    );

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: true,
      requireExistingWorkspace: false,
      syncCatalog: true,
    });

    expect(result.mode).toBe('migrated');

    const migratedBlueprint = await readFile(
      join(workspaceB, 'my-blueprint', 'my-blueprint.yaml'),
      'utf8'
    );
    expect(migratedBlueprint).toBe('name: my-blueprint');

    const sourceBlueprint = await readFile(
      join(workspaceA, 'my-blueprint', 'my-blueprint.yaml'),
      'utf8'
    );
    expect(sourceBlueprint).toBe('name: my-blueprint');
  });

  it('updates catalog when switching to an existing workspace with sync enabled', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(
      tempDir,
      'name: source-v2'
    );
    const configPath = join(tempDir, 'cli-config.json');
    const secondaryConfigPath = join(tempDir, 'cli-config-b.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });
    await initWorkspace({
      rootFolder: workspaceB,
      catalogSourceRoot,
      configPath: secondaryConfigPath,
    });

    await writeFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'name: stale',
      'utf8'
    );

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      requireExistingWorkspace: false,
      syncCatalog: true,
    });

    expect(result.mode).toBe('switched-existing');

    const updatedTemplate = await readFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(updatedTemplate).toBe('name: source-v2');
  });

  it('does not update catalog when switching to an existing workspace with sync disabled', async () => {
    const service = createWorkspaceService();
    const catalogSourceRoot = await createCatalogSource(
      tempDir,
      'name: source-v2'
    );
    const configPath = join(tempDir, 'cli-config.json');
    const secondaryConfigPath = join(tempDir, 'cli-config-b.json');
    const workspaceA = join(tempDir, 'workspace-a');
    const workspaceB = join(tempDir, 'workspace-b');

    await initWorkspace({
      rootFolder: workspaceA,
      catalogSourceRoot,
      configPath,
    });
    await initWorkspace({
      rootFolder: workspaceB,
      catalogSourceRoot,
      configPath: secondaryConfigPath,
    });

    await writeFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'name: stale',
      'utf8'
    );

    const result = await service.switchWorkspaceRoot({
      targetRootFolder: workspaceB,
      catalogSourceRoot,
      configPath,
      migrateContent: false,
      requireExistingWorkspace: false,
      syncCatalog: false,
    });

    expect(result.mode).toBe('switched-existing');

    const template = await readFile(
      join(workspaceB, 'catalog', 'blueprints', 'sample.yaml'),
      'utf8'
    );
    expect(template).toBe('name: stale');
  });
});
