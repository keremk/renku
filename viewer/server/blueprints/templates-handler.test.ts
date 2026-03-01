import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readCliConfigMock,
  listCatalogBlueprintTemplatesMock,
  createBlueprintFromTemplateMock,
} = vi.hoisted(() => ({
  readCliConfigMock: vi.fn(),
  listCatalogBlueprintTemplatesMock: vi.fn(),
  createBlueprintFromTemplateMock: vi.fn(),
}));

vi.mock('../generation/index.js', () => ({
  readCliConfig: readCliConfigMock,
}));

vi.mock('@gorenku/core', () => ({
  listCatalogBlueprintTemplates: listCatalogBlueprintTemplatesMock,
  createBlueprintFromTemplate: createBlueprintFromTemplateMock,
}));

import {
  listCatalogTemplates,
  createBlueprintFromCatalogTemplate,
} from './templates-handler.js';

describe('templates-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists templates from configured catalog root', async () => {
    readCliConfigMock.mockResolvedValue({
      storage: { root: '/storage', basePath: 'builds' },
      catalog: { root: '/catalog' },
    });
    listCatalogBlueprintTemplatesMock.mockResolvedValue([
      { name: 'flow-video', title: 'Flow Video', description: 'desc' },
    ]);

    const result = await listCatalogTemplates();

    expect(listCatalogBlueprintTemplatesMock).toHaveBeenCalledWith('/catalog');
    expect(result.templates).toEqual([
      { name: 'flow-video', title: 'Flow Video', description: 'desc' },
    ]);
  });

  it('creates a blueprint from a catalog template', async () => {
    readCliConfigMock.mockResolvedValue({
      storage: { root: '/storage', basePath: 'builds' },
      catalog: { root: '/catalog' },
    });
    createBlueprintFromTemplateMock.mockResolvedValue({
      folderPath: '/storage/my-video',
      blueprintPath: '/storage/my-video/my-video.yaml',
      inputTemplatePath: '/storage/my-video/input-template.yaml',
    });

    const result = await createBlueprintFromCatalogTemplate(
      'flow-video',
      'my-video'
    );

    expect(createBlueprintFromTemplateMock).toHaveBeenCalledWith({
      blueprintName: 'my-video',
      templateName: 'flow-video',
      outputDir: '/storage',
      catalogRoot: '/catalog',
    });
    expect(result).toEqual({
      name: 'my-video',
      blueprintPath: '/storage/my-video/my-video.yaml',
      blueprintFolder: '/storage/my-video',
      inputTemplatePath: '/storage/my-video/input-template.yaml',
    });
  });

  it('throws when catalog is not configured', async () => {
    readCliConfigMock.mockResolvedValue({
      storage: { root: '/storage', basePath: 'builds' },
    });

    await expect(listCatalogTemplates()).rejects.toThrow(
      'Renku catalog is not configured'
    );
  });
});
