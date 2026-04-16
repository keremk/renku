import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectBlueprintInDirectory } from './blueprint-detection.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe('detectBlueprintInDirectory', () => {
  it('detects authored blueprints that use imports', async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, 'video.yaml'),
      [
        'meta:',
        '  id: demo-blueprint',
        'outputs:',
        '  - name: FinalVideo',
        '    kind: video',
        'imports:',
        '  - name: SegmentProducer',
        '    producer: demo/segment-producer',
        '',
      ].join('\n')
    );

    const detected = await detectBlueprintInDirectory(dir);

    expect(detected).toEqual({
      blueprintPath: path.join(dir, 'video.yaml'),
      blueprintFolder: dir,
    });
  });

  it('does not treat producer blueprints as top-level authored blueprints', async () => {
    const dir = await createTempDir();
    await writeFile(
      path.join(dir, 'producer.yaml'),
      [
        'meta:',
        '  id: still-image-producer',
        '  kind: producer',
        'outputs:',
        '  - name: Image',
        '    kind: image',
        '',
      ].join('\n')
    );

    const detected = await detectBlueprintInDirectory(dir);

    expect(detected).toBeNull();
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'renku-blueprint-detection-'));
  tempDirs.push(dir);
  return dir;
}
