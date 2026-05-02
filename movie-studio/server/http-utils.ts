import type { ServerResponse } from 'node:http';

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown
): boolean {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
  return true;
}

export function respondNotFound(res: ServerResponse): boolean {
  return sendJson(res, 404, {
    error: {
      code: 'M000',
      message: 'Route not found.',
    },
  });
}

export function respondMethodNotAllowed(res: ServerResponse): boolean {
  res.setHeader('Allow', 'GET, POST');
  return sendJson(res, 405, {
    error: {
      code: 'M000',
      message: 'Method not allowed.',
    },
  });
}

export async function readJsonBody<T>(
  req: NodeJS.ReadableStream
): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    throw new Error('Request body is required.');
  }
  return JSON.parse(raw) as T;
}
