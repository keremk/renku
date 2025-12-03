import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEventLog,
  hashArtefactOutput,
  hashInputPayload,
  hashInputs,
} from './event-log.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import type { ArtefactEvent, InputEvent } from './types.js';

function memoryContext() {
  return createStorageContext({ kind: 'memory', basePath: 'builds' });
}

describe('EventLog', () => {
  it('appends and streams input events', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);

    const payload = { prompt: 'tell me a story', temperature: 0.8 };
    const inputEvent: InputEvent = {
      id: 'InquiryPrompt',
      revision: 'rev-0001',
      hash: hashInputPayload(payload),
      payload,
      editedBy: 'user',
      createdAt: new Date().toISOString(),
    };

    await eventLog.appendInput('demo', inputEvent);

    const collected: InputEvent[] = [];
    for await (const evt of eventLog.streamInputs('demo')) {
      collected.push(evt);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(inputEvent);
  });

  it('supports tailing inputs after a given revision', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);

    const eventFactory = (revision: 'rev-0001' | 'rev-0002' | 'rev-0003'): InputEvent => ({
      id: `input-${revision}`,
      revision,
      hash: hashInputPayload({ revision }),
      payload: { revision },
      editedBy: 'system',
      createdAt: new Date(Date.now() + Number(revision.slice(-1))).toISOString(),
    });

    await eventLog.appendInput('demo', eventFactory('rev-0001'));
    await eventLog.appendInput('demo', eventFactory('rev-0002'));
    await eventLog.appendInput('demo', eventFactory('rev-0003'));

    const collected: InputEvent[] = [];
    for await (const evt of eventLog.streamInputs('demo', 'rev-0002')) {
      collected.push(evt);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0].revision).toBe('rev-0003');
  });

  it('appends artefact events and streams them back', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);

    const artefactEvent: ArtefactEvent = {
      artefactId: 'segment_script_0',
      revision: 'rev-0002',
      inputsHash: hashInputs(['input:script_prompt', 'input:audience']),
      output: {
        blob: {
          hash: hashArtefactOutput({ blob: { hash: 'narration-hash', size: 48, mimeType: 'text/plain' } }),
          size: 48,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'script_producer',
      diagnostics: { latencyMs: 1200 },
      createdAt: new Date().toISOString(),
    };

    await eventLog.appendArtefact('demo', artefactEvent);

    const collected: ArtefactEvent[] = [];
    for await (const evt of eventLog.streamArtefacts('demo')) {
      collected.push(evt);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(artefactEvent);
  });

  it('produces stable hashes for equivalent payloads', () => {
    const first = hashInputPayload({ a: 1, b: { c: 2 } });
    const second = hashInputPayload({ b: { c: 2 }, a: 1 });
    expect(first).toBe(second);

    const outputHash = hashArtefactOutput({
      blob: { hash: 'sha', size: 1, mimeType: 'text/plain' },
    });
    const outputHashPermuted = hashArtefactOutput({
      blob: { mimeType: 'text/plain', size: 1, hash: 'sha' },
    });
    expect(outputHash).toBe(outputHashPermuted);
  });

  it('handles concurrent appends on the local filesystem backend', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renku-event-log-'));
    try {
      const ctx = createStorageContext({
        kind: 'local',
        rootDir: root,
        basePath: 'builds',
      });
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);

      const artefacts: ArtefactEvent[] = Array.from({ length: 20 }, (_, index) => ({
        artefactId: `segment_script_${index}`,
        revision: `rev-${String(index + 1).padStart(4, '0')}`,
        inputsHash: hashInputs([`input:${index}`]),
        output: {
          blob: {
            hash: `payload-${index}-hash`,
            size: `payload-${index}`.length,
            mimeType: 'text/plain',
          },
        },
        status: 'succeeded',
        producedBy: 'script_producer',
        createdAt: new Date(Date.now() + index).toISOString(),
      }));

      await Promise.all(
        artefacts.map((event) => eventLog.appendArtefact('demo', event)),
      );

      const logPath = join(root, 'builds/demo/events/artefacts.log');
      const raw = await readFile(logPath, 'utf8');
      const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      expect(lines).toHaveLength(artefacts.length);
      const parsed = lines.map((line) => JSON.parse(line) as ArtefactEvent);
      const seenIds = new Set(parsed.map((evt) => evt.artefactId));
      expect(seenIds.size).toBe(artefacts.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
