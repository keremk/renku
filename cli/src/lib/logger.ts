/* eslint-disable no-unused-vars */
import { createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import {
  createLogger,
  type LogEvent,
  type Logger,
  type LogLevel,
  type LogWriter,
} from '@renku/core';

export interface CliLoggerOptions {
  level: LogLevel;
  prefix?: string;
  logFilePath?: string;
  onLogEvent?: (logEvent: LogEvent) => void;
}

export type CliLogger = Logger;

export function createCliLogger(options: CliLoggerOptions): CliLogger {
  const isTest =
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.NODE_ENV === 'test';
  const isDebugOutputEnabled = process.env.TEST_DEBUG_OUTPUT === 'true';
  const shouldSuppressOutput = isTest && !isDebugOutputEnabled;
  const writers: Partial<Record<keyof Logger, LogWriter>> =
    !shouldSuppressOutput
      ? {
          info: globalThis.console.log.bind(globalThis.console),
          warn: globalThis.console.warn.bind(globalThis.console),
          error: globalThis.console.error.bind(globalThis.console),
          debug: globalThis.console.debug.bind(globalThis.console),
        }
      : {
          // Suppress all stdout/stderr logging in tests unless debug output is enabled.
          info: () => {},
          warn: () => {},
          error: () => {},
          debug: () => {},
        };

  const fileWriter = options.logFilePath ? createJsonlWriter(options.logFilePath) : undefined;

  return createLogger({
    level: options.level,
    prefix: options.prefix,
    writers,
    onLog(logEvent) {
      options.onLogEvent?.(logEvent);
      fileWriter?.(logEvent);
    },
  });
}

export function createJsonlWriter(logFilePath: string): (event: LogEvent) => void {
  mkdirSync(dirname(logFilePath), { recursive: true });
  const stream: WriteStream = createWriteStream(logFilePath, { flags: 'a' });

  return (logEvent: LogEvent): void => {
    const payload = JSON.stringify(logEvent);
    stream.write(payload.endsWith('\n') ? payload : `${payload}\n`);
  };
}
