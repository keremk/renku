/**
 * Unit tests for http-utils.ts - HTTP utility functions.
 */

import { describe, it, expect } from 'vitest';
import {
  parseJsonBody,
  sendJson,
  sendError,
  sendNotFound,
  sendMethodNotAllowed,
  setupSSE,
  sendSSEEvent,
  sendSSEComment,
} from './http-utils.js';
import {
  createMockRequest,
  createMockRequestEmpty,
  createMockRequestWithError,
  createMockResponse,
  parseResponseJson,
  parseSSEEvents,
  parseSSEComments,
} from './test-utils.js';

describe('parseJsonBody', () => {
  it('parses valid JSON body', async () => {
    const req = createMockRequest({ name: 'test', value: 123 });
    const result = await parseJsonBody<{ name: string; value: number }>(req);

    expect(result.name).toBe('test');
    expect(result.value).toBe(123);
  });

  it('returns empty object for empty body', async () => {
    const req = createMockRequestEmpty();
    const result = await parseJsonBody<Record<string, unknown>>(req);

    expect(result).toEqual({});
  });

  it('throws on invalid JSON', async () => {
    // Create request that sends invalid JSON directly
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter() as ReturnType<typeof createMockRequest>;
    req.method = 'POST';

    process.nextTick(() => {
      req.emit('data', Buffer.from('invalid json {{{'));
      req.emit('end');
    });

    await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON body');
  });

  it('rejects on request error', async () => {
    const error = new Error('Connection reset');
    const req = createMockRequestWithError(error);

    await expect(parseJsonBody(req)).rejects.toThrow('Connection reset');
  });

  it('parses nested objects', async () => {
    const nested = {
      user: { name: 'Alice', age: 30 },
      items: [1, 2, 3],
    };
    const req = createMockRequest(nested);
    const result = await parseJsonBody<typeof nested>(req);

    expect(result.user.name).toBe('Alice');
    expect(result.items).toEqual([1, 2, 3]);
  });
});

describe('sendJson', () => {
  it('sets Content-Type to application/json', () => {
    const res = createMockResponse();
    sendJson(res, { foo: 'bar' });

    expect(res.headers['content-type']).toBe('application/json');
  });

  it('serializes data as JSON', () => {
    const res = createMockResponse();
    sendJson(res, { name: 'test', count: 42 });

    const parsed = parseResponseJson<{ name: string; count: number }>(res);
    expect(parsed.name).toBe('test');
    expect(parsed.count).toBe(42);
  });

  it('uses default status code 200', () => {
    const res = createMockResponse();
    sendJson(res, {});

    expect(res.statusCode).toBe(200);
  });

  it('uses provided status code', () => {
    const res = createMockResponse();
    sendJson(res, {}, 201);

    expect(res.statusCode).toBe(201);
  });

  it('handles arrays', () => {
    const res = createMockResponse();
    sendJson(res, [1, 2, 3]);

    const parsed = parseResponseJson<number[]>(res);
    expect(parsed).toEqual([1, 2, 3]);
  });
});

describe('sendError', () => {
  it('sends error with message', () => {
    const res = createMockResponse();
    sendError(res, 400, 'Bad request');

    expect(res.statusCode).toBe(400);
    const parsed = parseResponseJson<{ error: string }>(res);
    expect(parsed.error).toBe('Bad request');
  });

  it('includes code when provided', () => {
    const res = createMockResponse();
    sendError(res, 500, 'Internal error', 'ERR001');

    const parsed = parseResponseJson<{ error: string; code: string }>(res);
    expect(parsed.error).toBe('Internal error');
    expect(parsed.code).toBe('ERR001');
  });

  it('sets Content-Type to application/json', () => {
    const res = createMockResponse();
    sendError(res, 400, 'Error');

    expect(res.headers['content-type']).toBe('application/json');
  });
});

describe('sendNotFound', () => {
  it('sends 404 with default message', () => {
    const res = createMockResponse();
    sendNotFound(res);

    expect(res.statusCode).toBe(404);
    const parsed = parseResponseJson<{ error: string }>(res);
    expect(parsed.error).toBe('Not Found');
  });

  it('sends 404 with custom message', () => {
    const res = createMockResponse();
    sendNotFound(res, 'Resource not found');

    expect(res.statusCode).toBe(404);
    const parsed = parseResponseJson<{ error: string }>(res);
    expect(parsed.error).toBe('Resource not found');
  });
});

describe('sendMethodNotAllowed', () => {
  it('sends 405 with Method Not Allowed message', () => {
    const res = createMockResponse();
    sendMethodNotAllowed(res);

    expect(res.statusCode).toBe(405);
    const parsed = parseResponseJson<{ error: string }>(res);
    expect(parsed.error).toBe('Method Not Allowed');
  });
});

describe('setupSSE', () => {
  it('sets text/event-stream content type', () => {
    const res = createMockResponse();
    setupSSE(res);

    expect(res.headers['content-type']).toBe('text/event-stream');
  });

  it('sets no-cache headers', () => {
    const res = createMockResponse();
    setupSSE(res);

    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sets keep-alive connection', () => {
    const res = createMockResponse();
    setupSSE(res);

    expect(res.headers['connection']).toBe('keep-alive');
  });

  it('sets status code to 200', () => {
    const res = createMockResponse();
    setupSSE(res);

    expect(res.statusCode).toBe(200);
  });
});

describe('sendSSEEvent', () => {
  it('formats event with correct SSE syntax', () => {
    const res = createMockResponse();
    sendSSEEvent(res, 'status', { progress: 50 });

    const events = parseSSEEvents(res.body);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('status');
  });

  it('JSON stringifies data', () => {
    const res = createMockResponse();
    sendSSEEvent(res, 'update', { name: 'test', values: [1, 2, 3] });

    const events = parseSSEEvents(res.body);
    expect(events[0].data).toEqual({ name: 'test', values: [1, 2, 3] });
  });

  it('sends multiple events correctly', () => {
    const res = createMockResponse();
    sendSSEEvent(res, 'event1', { id: 1 });
    sendSSEEvent(res, 'event2', { id: 2 });
    sendSSEEvent(res, 'event3', { id: 3 });

    const events = parseSSEEvents(res.body);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('event1');
    expect(events[1].event).toBe('event2');
    expect(events[2].event).toBe('event3');
  });
});

describe('sendSSEComment', () => {
  it('formats comment with colon prefix', () => {
    const res = createMockResponse();
    sendSSEComment(res, 'keep-alive');

    const comments = parseSSEComments(res.body);
    expect(comments).toContain('keep-alive');
  });

  it('sends multiple comments correctly', () => {
    const res = createMockResponse();
    sendSSEComment(res, 'ping 1');
    sendSSEComment(res, 'ping 2');

    const comments = parseSSEComments(res.body);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toBe('ping 1');
    expect(comments[1]).toBe('ping 2');
  });
});
