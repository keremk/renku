import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleSettingsEndpoint } from './handler.js';

export async function handleSettingsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[],
  catalogPath?: string
): Promise<boolean> {
  const action = segments[0] ?? '';
  return handleSettingsEndpoint(req, res, action, catalogPath);
}
