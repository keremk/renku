import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createMockResponse } from '../generation/test-utils.js';

const { listCatalogTemplatesMock, createBlueprintFromCatalogTemplateMock } =
  vi.hoisted(() => ({
    listCatalogTemplatesMock: vi.fn(),
    createBlueprintFromCatalogTemplateMock: vi.fn(),
  }));

vi.mock('./templates-handler.js', () => ({
  listCatalogTemplates: listCatalogTemplatesMock,
  createBlueprintFromCatalogTemplate: createBlueprintFromCatalogTemplateMock,
}));

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
});
