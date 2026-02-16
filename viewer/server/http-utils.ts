/**
 * HTTP utility functions for the viewer API.
 * Re-exports generation utilities and adds viewer-specific helpers.
 */

import type { ServerResponse } from "node:http";

// Re-export all utilities from generation module
export {
  parseJsonBody,
  sendJson,
  sendError,
  sendNotFound,
  sendMethodNotAllowed,
  setupSSE,
  sendSSEEvent,
  sendSSEComment,
} from "./generation/http-utils.js";

/**
 * Sends a 404 Not Found response (legacy format for backward compatibility).
 * Returns true to indicate the request was handled.
 */
export function respondNotFound(res: ServerResponse): true {
  res.statusCode = 404;
  res.end("Not Found");
  return true;
}

/**
 * Sends a 400 Bad Request response with a message.
 * Returns true to indicate the request was handled.
 */
export function respondBadRequest(res: ServerResponse, message: string): true {
  res.statusCode = 400;
  res.end(message);
  return true;
}

/**
 * Sends a 405 Method Not Allowed response.
 * Returns true to indicate the request was handled.
 */
export function respondMethodNotAllowed(res: ServerResponse): true {
  res.statusCode = 405;
  res.end("Method Not Allowed");
  return true;
}

/**
 * Sends a 500 Internal Server Error response.
 * Returns true to indicate the request was handled.
 */
export function respondServerError(res: ServerResponse, message: string): true {
  res.statusCode = 500;
  res.end(message);
  return true;
}
