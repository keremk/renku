import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import {
  createEventLog,
  createStorageContext,
  initializeMovieStorage,
  persistBlobToStorage,
} from '@gorenku/core';
import { getProducerFieldPreview } from './producer-field-preview-handler.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const CATALOG_ROOT = path.join(REPO_ROOT, 'catalog');

describe('getProducerFieldPreview', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((tempDir) =>
        rm(tempDir, { recursive: true, force: true })
      )
    );
  });

  it('returns producer field preview fields without producer-level contract errors for animated-edu blueprint', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerFieldPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        'Input:Resolution': { width: 1280, height: 720 },
        'Input:NarrationAudioProducer.LanguageCode': 'eng',
        'Input:TranscriptionProducer.LanguageCode': 'eng',
      },
      models: [
        {
          producerId: 'Producer:CharacterImageProducer',
          provider: 'fal-ai',
          model: 'flux-2',
        },
        {
          producerId: 'Producer:NarrationAudioProducer',
          provider: 'fal-ai',
          model: 'elevenlabs/tts/eleven-v3',
        },
        {
          producerId: 'Producer:LipsyncVideoProducer',
          provider: 'fal-ai',
          model: 'ltx-2.3/audio-to-video',
        },
        {
          producerId: 'Producer:TranscriptionProducer',
          provider: 'renku',
          model: 'speech/transcription',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const imagePreview = response.producers['Producer:CharacterImageProducer'];
    expect((imagePreview?.fields.length ?? 0) > 0).toBe(true);

    const narrationPreview =
      response.producers['Producer:NarrationAudioProducer'];
    expect((narrationPreview?.fields.length ?? 0) > 0).toBe(true);
    expect(
      narrationPreview?.fields.some((field) => field.field === 'language_code')
    ).toBe(true);

    const lipsyncPreview = response.producers['Producer:LipsyncVideoProducer'];
    expect(lipsyncPreview).toBeDefined();
    expect(Array.isArray(lipsyncPreview?.fields)).toBe(true);

    const transcriptionPreview =
      response.producers['Producer:TranscriptionProducer'];
    expect((transcriptionPreview?.fields.length ?? 0) > 0).toBe(true);
    expect(
      transcriptionPreview?.fields.some(
        (field) => field.field === 'languageCode'
      )
    ).toBe(true);
  });

  it('keeps preview non-blocking when runtime inputs are incomplete', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'animated-edu-characters',
      'animated-edu-characters.yaml'
    );

    const response = await getProducerFieldPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {},
      models: [
        {
          producerId: 'Producer:CharacterImageProducer',
          provider: 'fal-ai',
          model: 'flux-2',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);
    const preview = response.producers['Producer:CharacterImageProducer'];
    expect((preview?.fields.length ?? 0) > 0).toBe(true);
    expect(preview?.fields.every((field) => field.status !== 'error')).toBe(
      true
    );
    expect(
      preview?.fields.some((field) => field.status === 'warning')
    ).toBe(true);
  });

  it('marks connected variant fields as read-only dynamic and provides per-instance previews', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'celebrity-then-now',
      'celebrity-then-now.yaml'
    );

    const response = await getProducerFieldPreview({
      blueprintPath,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        'Input:CelebrityThenImages': [
          'file:./images/then-1.jpg',
          'file:./images/then-2.jpg',
        ],
        'Input:CelebrityNowImages': [
          'file:./images/now-1.jpg',
          'file:./images/now-2.jpg',
        ],
        'Input:SettingImage': 'file:./images/setting.jpg',
        'Input:Theme': 'Theme',
        'Input:EnvironmentDescription': 'Environment',
        'Input:VisualStyle': 'Visual style',
        'Input:NumOfSegments': 2,
        'Input:SegmentDuration': 15,
        'Input:MeetingDuration': 10,
        'Input:TransitionDuration': 5,
        'Input:Resolution': { width: 1280, height: 720 },
      },
      models: [
        {
          producerId: 'Producer:ThenImageProducer',
          provider: 'fal-ai',
          model: 'qwen-image-edit-2511',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const imagePreview = response.producers['Producer:ThenImageProducer'];
    const imageUrlsField = imagePreview?.fields.find(
      (field) => field.field === 'image_urls'
    );
    expect(imageUrlsField).toBeDefined();
    expect(imageUrlsField?.connectionBehavior).toBe('variant');
    expect(imageUrlsField?.overridePolicy).toBe('read_only_dynamic');
    expect(imageUrlsField?.instances).toHaveLength(2);

    const firstInstanceValue = imageUrlsField?.instances?.[0]?.value as
      | unknown[]
      | undefined;
    const secondInstanceValue = imageUrlsField?.instances?.[1]?.value as
      | unknown[]
      | undefined;
    expect(Array.isArray(firstInstanceValue)).toBe(true);
    expect(Array.isArray(secondInstanceValue)).toBe(true);
    expect(firstInstanceValue?.[0]).toBe('file:./images/then-1.jpg');
    expect(secondInstanceValue?.[0]).toBe('file:./images/then-2.jpg');
    expect(firstInstanceValue?.[1]).toBe('file:./images/setting.jpg');
    expect(secondInstanceValue?.[1]).toBe('file:./images/setting.jpg');

    const imageSizeField = imagePreview?.fields.find(
      (field) => field.field === 'image_size'
    );
    expect(imageSizeField).toBeDefined();
    expect(imageSizeField?.connectionBehavior).toBe('invariant');
    expect(imageSizeField?.overridePolicy).toBe('editable');
    expect(imageSizeField?.instances).toHaveLength(2);
  });

  it('resolves canonical prompt artifacts from the selected build for composite leaf producers', async () => {
    const blueprintPath = path.join(
      CATALOG_ROOT,
      'blueprints',
      'celebrity-then-now',
      'celebrity-then-now.yaml'
    );
    const blueprintFolder = await mkdtemp(
      path.join(os.tmpdir(), 'producer-field-preview-')
    );
    tempDirs.push(blueprintFolder);

    const movieId = 'movie-preview';
    const storage = createStorageContext({
      kind: 'local',
      rootDir: blueprintFolder,
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, movieId);
    const eventLog = createEventLog(storage);

    const promptArtifacts = [
      {
        artifactId:
          'Artifact:DirectorProducer.Script.Characters[0].TogetherImagePrompt',
        text: 'Compose the younger and older celebrity standing together in the same scene.',
        producerJobId: 'Producer:DirectorProducer',
      },
      {
        artifactId:
          'Artifact:DirectorProducer.Script.Characters[1].TogetherImagePrompt',
        text: 'Create a reunion portrait with both eras of the celebrity sharing the frame.',
        producerJobId: 'Producer:DirectorProducer',
      },
    ] as const;
    const imageArtifacts = [
      {
        artifactId: 'Artifact:ThenImageProducer.ComposedImage[0]',
        payload: new Uint8Array([137, 80, 78, 71, 0]),
      },
      {
        artifactId: 'Artifact:NowImageProducer.ComposedImage[0]',
        payload: new Uint8Array([137, 80, 78, 71, 1]),
      },
      {
        artifactId: 'Artifact:ThenImageProducer.ComposedImage[1]',
        payload: new Uint8Array([137, 80, 78, 71, 2]),
      },
      {
        artifactId: 'Artifact:NowImageProducer.ComposedImage[1]',
        payload: new Uint8Array([137, 80, 78, 71, 3]),
      },
    ] as const;

    for (const promptArtifact of promptArtifacts) {
      const blob = await persistBlobToStorage(storage, movieId, {
        data: promptArtifact.text,
        mimeType: 'text/plain',
      });
      await eventLog.appendArtifact(movieId, {
        artifactId: promptArtifact.artifactId,
        revision: 'rev-preview',
        inputsHash: 'inputs-preview',
        output: { blob },
        status: 'succeeded',
        producerJobId: promptArtifact.producerJobId,
        producerId: 'Producer:DirectorProducer',
        createdAt: '2026-04-14T12:00:00Z',
        lastRevisionBy: 'producer',
      });
    }

    const imageBlobHashes = new Map<string, string>();
    for (const imageArtifact of imageArtifacts) {
      const blob = await persistBlobToStorage(storage, movieId, {
        data: imageArtifact.payload,
        mimeType: 'image/png',
      });
      imageBlobHashes.set(imageArtifact.artifactId, blob.hash);
      await eventLog.appendArtifact(movieId, {
        artifactId: imageArtifact.artifactId,
        revision: 'rev-preview',
        inputsHash: 'inputs-preview',
        output: { blob },
        status: 'succeeded',
        producerJobId: 'Producer:ThenImageProducer',
        producerId: 'Producer:ThenImageProducer',
        createdAt: '2026-04-14T12:00:00Z',
        lastRevisionBy: 'producer',
      });
    }

    const response = await getProducerFieldPreview({
      blueprintPath,
      blueprintFolder,
      movieId,
      catalogRoot: CATALOG_ROOT,
      inputs: {
        'Input:CelebrityThenImages': [
          'file:./images/then-1.jpg',
          'file:./images/then-2.jpg',
        ],
        'Input:CelebrityNowImages': [
          'file:./images/now-1.jpg',
          'file:./images/now-2.jpg',
        ],
        'Input:SettingImage': 'file:./images/setting.jpg',
        'Input:Theme': 'Theme',
        'Input:EnvironmentDescription': 'Environment',
        'Input:VisualStyle': 'Visual style',
        'Input:MusicalStyle': 'Music style',
        'Input:NumOfSegments': 2,
        'Input:MeetingDuration': 10,
        'Input:TransitionDuration': 5,
        'Input:SegmentDuration': 15,
        'Input:Duration': 30,
        'Input:Resolution': { width: 1280, height: 720 },
      },
      models: [
        {
          producerId: 'Producer:CelebrityVideoProducer.TogetherImageProducer',
          provider: 'fal-ai',
          model: 'xai/grok-imagine-image/edit',
        },
      ],
    });

    expect(Object.keys(response.errorsByProducer ?? {})).toHaveLength(0);

    const promptField = response.producers[
      'Producer:CelebrityVideoProducer.TogetherImageProducer'
    ]?.fields.find((field) => field.field === 'prompt');

    expect(promptField).toBeDefined();
    expect(promptField?.status).toBe('ok');
    expect(promptField?.errors).toEqual([]);
    expect(promptField?.value).toBe(promptArtifacts[0].text);
    expect(promptField?.instances).toHaveLength(2);
    expect(promptField?.instances?.[0]?.value).toBe(promptArtifacts[0].text);
    expect(promptField?.instances?.[1]?.value).toBe(promptArtifacts[1].text);

    const imageUrlsField = response.producers[
      'Producer:CelebrityVideoProducer.TogetherImageProducer'
    ]?.fields.find((field) => field.field === 'image_urls');

    expect(imageUrlsField).toBeDefined();
    expect(imageUrlsField?.status).toBe('ok');
    expect(imageUrlsField?.value).toEqual([
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:ThenImageProducer.ComposedImage[0]')}`,
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:NowImageProducer.ComposedImage[0]')}`,
    ]);
    expect(imageUrlsField?.instances).toHaveLength(2);
    expect(imageUrlsField?.instances?.[0]?.value).toEqual([
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:ThenImageProducer.ComposedImage[0]')}`,
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:NowImageProducer.ComposedImage[0]')}`,
    ]);
    expect(imageUrlsField?.instances?.[1]?.value).toEqual([
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:ThenImageProducer.ComposedImage[1]')}`,
      `/viewer-api/blueprints/blob?folder=${encodeURIComponent(blueprintFolder)}&movieId=${movieId}&hash=${imageBlobHashes.get('Artifact:NowImageProducer.ComposedImage[1]')}`,
    ]);
  });
});
