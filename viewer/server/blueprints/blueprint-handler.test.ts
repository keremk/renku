import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createMockRequestEmpty,
  createMockResponse,
} from '../generation/test-utils.js';

const {
  listCatalogTemplatesMock,
  createBlueprintFromCatalogTemplateMock,
  getBuildStateMock,
} = vi.hoisted(() => ({
    listCatalogTemplatesMock: vi.fn(),
    createBlueprintFromCatalogTemplateMock: vi.fn(),
    getBuildStateMock: vi.fn(),
  }));

vi.mock('./templates-handler.js', () => ({
  listCatalogTemplates: listCatalogTemplatesMock,
  createBlueprintFromCatalogTemplate: createBlueprintFromCatalogTemplateMock,
}));

vi.mock('../builds/index.js', async () => {
  const actual = await vi.importActual<typeof import('../builds/index.js')>(
    '../builds/index.js'
  );
  return {
    ...actual,
    getBuildState: getBuildStateMock,
  };
});

import { handleBlueprintRequest } from './blueprint-handler.js';

function createInvalidJsonRequest(): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = 'POST';

  process.nextTick(() => {
    req.emit('data', Buffer.from('{"templateName":'));
    req.emit('end');
  });

  return req;
}

describe('handleBlueprintRequest', () => {
  it('returns 400 for malformed JSON in templates/create', async () => {
    const req = createInvalidJsonRequest();
    const res = createMockResponse();
    const url = new URL(
      'http://viewer.local/viewer-api/blueprints/templates/create'
    );

    const handled = await handleBlueprintRequest(req, res, url, [
      'templates',
      'create',
    ]);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('Invalid JSON body');
    expect(createBlueprintFromCatalogTemplateMock).not.toHaveBeenCalled();
  });

  it('returns numbered runtime errors for build-state failures', async () => {
    getBuildStateMock.mockRejectedValueOnce(
      createRuntimeError(
        RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
        'Failed to parse persisted build history.'
      )
    );

    const req = createMockRequestEmpty('GET');
    const res = createMockResponse();
    const url = new URL(
      'http://viewer.local/viewer-api/blueprints/build-state?folder=/tmp/blueprint&movieId=movie-test123&blueprintPath=/tmp/blueprint/test.yaml'
    );

    const handled = await handleBlueprintRequest(req, res, url, [
      'build-state',
    ]);

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: 'Failed to parse persisted build history.',
      code: RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
    });
  });
});
