import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleOnboardingEndpoint } from './handler.js';
import { respondNotFound } from '../http-utils.js';

export async function handleOnboardingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  segments: string[],
  catalogPath?: string,
): Promise<boolean> {
  const action = segments[0];
  if (!action) {
    return respondNotFound(res);
  }
  return handleOnboardingEndpoint(req, res, action, catalogPath);
}
