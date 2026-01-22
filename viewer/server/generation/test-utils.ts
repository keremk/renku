/**
 * Test utilities for the generation API tests.
 * Provides mock request/response helpers for testing HTTP handlers.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Creates a mock IncomingMessage for testing.
 */
export function createMockRequest(body: unknown, method = 'POST'): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = method;

  // Simulate body streaming async
  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
  });

  return req;
}

/**
 * Creates a mock request with no body (for empty body tests).
 */
export function createMockRequestEmpty(method = 'GET'): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = method;

  process.nextTick(() => {
    req.emit('end');
  });

  return req;
}

/**
 * Creates a mock request that emits an error.
 */
export function createMockRequestWithError(error: Error, method = 'POST'): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter;
  req.method = method;

  process.nextTick(() => {
    req.emit('error', error);
  });

  return req;
}

/**
 * Mock response object with captured data.
 */
export interface MockResponse extends ServerResponse {
  body: string;
  statusCode: number;
  headers: Record<string, string | string[]>;
  writableEnded: boolean;
}

/**
 * Creates a mock ServerResponse for testing.
 */
export function createMockResponse(): MockResponse {
  const res = new EventEmitter() as MockResponse & EventEmitter;

  res.body = '';
  res.statusCode = 200;
  res.headers = {};
  res.writableEnded = false;

  // Use arrow functions to capture res instead of this
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).setHeader = (key: string, value: string | string[]) => {
    res.headers[key.toLowerCase()] = value;
    return res;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).writeHead = (
    status: number,
    headersOrMessage?: string | Record<string, string | string[]>,
    maybeHeaders?: Record<string, string | string[]>
  ) => {
    res.statusCode = status;
    const headers = typeof headersOrMessage === 'object' ? headersOrMessage : maybeHeaders;
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        res.headers[key.toLowerCase()] = value;
      }
    }
    return res;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).write = (chunk: string | Buffer) => {
    res.body += chunk.toString();
    return true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = (dataOrCb?: string | Buffer | (() => void)) => {
    if (typeof dataOrCb === 'string' || Buffer.isBuffer(dataOrCb)) {
      res.body += dataOrCb.toString();
    }
    res.writableEnded = true;
    res.emit('finish');
    return res;
  };

  return res;
}

/**
 * Parses JSON response body from mock response.
 */
export function parseResponseJson<T>(res: MockResponse): T {
  return JSON.parse(res.body) as T;
}

/**
 * Parses SSE events from mock response body.
 */
export interface ParsedSSEEvent {
  event: string;
  data: unknown;
}

export function parseSSEEvents(body: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = [];
  const lines = body.split('\n');

  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7);
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6);
    } else if (line === '' && currentEvent && currentData) {
      events.push({
        event: currentEvent,
        data: JSON.parse(currentData),
      });
      currentEvent = '';
      currentData = '';
    }
  }

  return events;
}

/**
 * Parses SSE comments from mock response body.
 */
export function parseSSEComments(body: string): string[] {
  const comments: string[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    if (line.startsWith(': ')) {
      comments.push(line.slice(2));
    }
  }

  return comments;
}
