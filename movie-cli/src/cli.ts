#!/usr/bin/env node
import { getMovieCliInfo } from './commands/info.js';

export function runMovieCli(argv = process.argv.slice(2)): number {
  const [command] = argv;

  if (!command || command === 'help' || command === '--help') {
    console.log('renku-movie');
    console.log('');
    console.log('Commands:');
    console.log('  info    Show Movie Studio CLI scaffold information');
    return 0;
  }

  if (command === 'info') {
    console.log(JSON.stringify(getMovieCliInfo(), null, 2));
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  return 1;
}

const isEntrypoint = process.argv[1]?.endsWith('/cli.js') ?? false;

if (isEntrypoint) {
  process.exitCode = runMovieCli();
}
