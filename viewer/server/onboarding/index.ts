import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleOnboardingEndpoint,
  type OnboardingPickerOptions,
} from './handler.js';
import { respondNotFound } from '../http-utils.js';

export type { OnboardingPickerOptions };

export async function handleOnboardingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _url: URL,
  segments: string[],
  catalogPath?: string,
  pickerOptions: OnboardingPickerOptions = {}
): Promise<boolean> {
  const action = segments[0];
  if (!action) {
    return respondNotFound(res);
  }
  return handleOnboardingEndpoint(req, res, action, catalogPath, pickerOptions);
}
