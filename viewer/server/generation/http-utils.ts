/**
 * HTTP utility functions for the generation API.
 * Handles JSON body parsing and response sending for raw Node.js HTTP.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Parses JSON body from an incoming request.
 */
export async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        if (!body) {
          resolve({} as T);
          return;
        }
        const parsed = JSON.parse(body) as T;
        resolve(parsed);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Sends a JSON response.
 */
export function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Sends an error response.
 */
export function sendError(res: ServerResponse, statusCode: number, message: string, code?: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: message, code }));
}

/**
 * Sends a not found response.
 */
export function sendNotFound(res: ServerResponse, message = 'Not Found'): void {
  sendError(res, 404, message);
}

/**
 * Sends a method not allowed response.
 */
export function sendMethodNotAllowed(res: ServerResponse): void {
  sendError(res, 405, 'Method Not Allowed');
}

/**
 * Sets up SSE headers on the response.
 */
export function setupSSE(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
}

/**
 * Sends an SSE event.
 */
export function sendSSEEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Sends an SSE comment (for keep-alive).
 */
export function sendSSEComment(res: ServerResponse, comment: string): void {
  res.write(`: ${comment}\n\n`);
}
