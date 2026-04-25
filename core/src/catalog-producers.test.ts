import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  listCatalogProducerEntrypoints,
  resolveCatalogProducerPath,
} from './catalog-producers.js';

describe('catalog producer discovery', () => {
  it('resolves direct producer files', async () => {
    const root = await makeCatalogRoot();
    await writeFile(
      join(root, 'producers', 'video', 'text-to-video.yaml'),
      'meta:\n  id: TextToVideo\n'
    );

    const result = resolveCatalogProducerPath(
      join(root, 'producers'),
      'video/text-to-video'
    );

    expect(result.status).toBe('found');
    expect(result.status === 'found' ? result.path : '').toBe(
      join(root, 'producers', 'video', 'text-to-video.yaml')
    );
  });

  it('resolves folder producer entrypoints without exposing private YAML files', async () => {
    const root = await makeCatalogRoot();
    const packageRoot = join(root, 'producers', 'video', 'seedance-video-generator');
    await mkdir(join(packageRoot, 'text-route'), { recursive: true });
    await writeFile(
      join(packageRoot, 'seedance-video-generator.yaml'),
      'meta:\n  id: SeedanceVideoGenerator\n'
    );
    await writeFile(
      join(packageRoot, 'text-route', 'producer.yaml'),
      'meta:\n  id: PrivateTextRoute\n'
    );

    const result = resolveCatalogProducerPath(
      join(root, 'producers'),
      'video/seedance-video-generator'
    );
    expect(result.status).toBe('found');
    expect(result.status === 'found' ? result.path : '').toBe(
      join(packageRoot, 'seedance-video-generator.yaml')
    );

    await expect(
      listCatalogProducerEntrypoints(join(root, 'producers'))
    ).resolves.toEqual([
      {
        path: join(packageRoot, 'seedance-video-generator.yaml'),
        qualifiedName: 'video/seedance-video-generator',
      },
    ]);
  });

  it('reports invalid folder producers with missing canonical entrypoints', async () => {
    const root = await makeCatalogRoot();
    const packageRoot = join(root, 'producers', 'video', 'bad-package');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, 'wrong-name.yaml'),
      'meta:\n  id: WrongName\n'
    );

    const result = resolveCatalogProducerPath(
      join(root, 'producers'),
      'video/bad-package'
    );

    expect(result.status).toBe('invalidFolder');
    expect(result.status === 'invalidFolder' ? result.message : '').toContain(
      'entrypoint must be named "bad-package.yaml"'
    );
  });
});

async function makeCatalogRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'renku-catalog-producers-'));
  await mkdir(resolve(root, 'producers', 'video'), { recursive: true });
  return root;
}
