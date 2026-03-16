import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

export const versionedPackages = [
  { dir: 'core', npmName: '@gorenku/core' },
  { dir: 'compositions', npmName: '@gorenku/compositions' },
  { dir: 'providers', npmName: '@gorenku/providers' },
  { dir: 'cli', npmName: '@gorenku/cli' },
  { dir: 'viewer', npmName: 'viewer' },
  { dir: 'desktop', npmName: 'renku-desktop' },
];

export const npmPublishPackages = [
  {
    dir: 'core',
    filter: '@gorenku/core',
    npmName: '@gorenku/core',
    tarballBase: 'gorenku-core',
  },
  {
    dir: 'compositions',
    filter: '@gorenku/compositions',
    npmName: '@gorenku/compositions',
    tarballBase: 'gorenku-compositions',
  },
  {
    dir: 'providers',
    filter: '@gorenku/providers',
    npmName: '@gorenku/providers',
    tarballBase: 'gorenku-providers',
  },
  {
    dir: 'cli',
    filter: '@gorenku/cli',
    npmName: '@gorenku/cli',
    tarballBase: 'gorenku-cli',
  },
];

export const desktopChannels = {
  production: {
    name: 'production',
    packageScript: 'package:desktop:prod',
    packageScriptUnsigned: 'package:desktop',
    deployFlag: '--production',
    metadataFile: 'latest-mac.yml',
  },
  internal: {
    name: 'internal',
    packageScript: 'package:desktop:dev',
    deployFlag: '--internal',
    metadataFile: 'dev-mac.yml',
  },
};

export function getTarballFileName(tarballBase, version) {
  return `${tarballBase}-${version}.tgz`;
}
