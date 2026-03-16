#!/usr/bin/env node
import { desktopChannels } from './lib/context.mjs';
import { getPackageVersion, runCommand } from './lib/utils.mjs';

function parseArgs(argv) {
  const options = {
    bumpType: 'patch',
    desktopChannel: 'production',
    deployWeb: false,
    skipCheck: false,
  };

  let bumpTypeSet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--desktop-channel') {
      const channel = argv[index + 1];
      if (!channel) {
        throw new Error(
          '--desktop-channel requires a value: production|internal'
        );
      }
      options.desktopChannel = channel;
      index += 1;
      continue;
    }

    if (arg === '--deploy-web') {
      options.deployWeb = true;
      continue;
    }

    if (arg === '--skip-check') {
      options.skipCheck = true;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (bumpTypeSet) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    options.bumpType = arg;
    bumpTypeSet = true;
  }

  if (!['patch', 'minor', 'major'].includes(options.bumpType)) {
    throw new Error(
      `Invalid bump type: ${options.bumpType}. Use patch|minor|major.`
    );
  }

  if (!desktopChannels[options.desktopChannel]) {
    throw new Error(
      `Invalid desktop channel: ${options.desktopChannel}. Use production|internal.`
    );
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  const prepareArgs = [
    'scripts/release/prepare.mjs',
    options.bumpType,
    '--desktop-channel',
    options.desktopChannel,
  ];
  if (options.skipCheck) {
    prepareArgs.push('--skip-check');
  }

  runCommand('node', prepareArgs);

  const version = getPackageVersion('cli');
  const tag = `v${version}`;

  const publishArgs = [
    'scripts/release/publish.mjs',
    '--tag',
    tag,
    '--desktop-channel',
    options.desktopChannel,
  ];
  if (options.deployWeb) {
    publishArgs.push('--deploy-web');
  }

  runCommand('node', publishArgs);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `\n[release:ship] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
