#!/usr/bin/env node
import process from 'node:process';
import { startMovieStudioServer } from './runtime.js';

interface CliOptions {
  dist: string;
  host?: string;
  port?: number;
}

function parseArguments(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  for (const arg of argv) {
    if (arg.startsWith('--dist=')) {
      options.dist = arg.slice('--dist='.length);
      continue;
    }
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }
    if (arg.startsWith('--port=')) {
      const value = Number.parseInt(arg.slice('--port='.length), 10);
      if (!Number.isNaN(value)) {
        options.port = value;
      }
      continue;
    }
  }

  if (!options.dist) {
    throw new Error('Missing required --dist option');
  }

  return options as CliOptions;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const server = await startMovieStudioServer({
      distPath: options.dist,
      host: options.host,
      port: options.port,
      log: (message) => {
        console.log(message);
      },
    });

    process.on('SIGTERM', () => {
      void server.stop().finally(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      void server.stop().finally(() => process.exit(0));
    });
  } catch (error) {
    console.error(
      '[movie-studio-server]',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

void main();
