#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const producersRoot = resolve(repoRoot, 'catalog', 'producers');

const SYSTEM_INPUT_NAMES = new Set([
  'Duration',
  'NumOfSegments',
  'Resolution',
  'SegmentDuration',
  'MovieId',
  'StorageRoot',
  'StorageBasePath',
]);

async function listYamlFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listYamlFiles(absolute)));
      continue;
    }
    if (entry.isFile() && ['.yaml', '.yml'].includes(extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function collectMappingSources(mappingAlias, mappingValue) {
  if (typeof mappingValue === 'string') {
    return [mappingAlias];
  }

  if (!mappingValue || typeof mappingValue !== 'object') {
    return [mappingAlias];
  }

  const mapping = mappingValue;
  const primarySource =
    typeof mapping.input === 'string' ? mapping.input : mappingAlias;
  const sources = [];

  if (!mapping.combine && !mapping.conditional) {
    sources.push(primarySource);
  }

  if (mapping.combine && Array.isArray(mapping.combine.inputs)) {
    for (const inputName of mapping.combine.inputs) {
      if (typeof inputName === 'string') {
        sources.push(inputName);
      }
    }
  }

  if (
    mapping.conditional &&
    typeof mapping.conditional === 'object' &&
    mapping.conditional.when &&
    typeof mapping.conditional.when === 'object' &&
    typeof mapping.conditional.when.input === 'string'
  ) {
    sources.push(mapping.conditional.when.input);
  }

  if (mapping.conditional && typeof mapping.conditional === 'object') {
    sources.push(
      ...collectMappingSources(primarySource, mapping.conditional.then)
    );
  }

  return [...new Set(sources)];
}

function isDeclaredSource(sourceName, declaredInputs) {
  return declaredInputs.has(sourceName) || SYSTEM_INPUT_NAMES.has(sourceName);
}

async function main() {
  const files = await listYamlFiles(producersRoot);
  const issues = [];

  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8');
    const document = parseYaml(content);
    if (!document || typeof document !== 'object') {
      continue;
    }

    const declaredInputs = new Set(
      Array.isArray(document.inputs)
        ? document.inputs
            .filter(
              (entry) =>
                entry &&
                typeof entry === 'object' &&
                typeof entry.name === 'string'
            )
            .map((entry) => entry.name)
        : []
    );

    const mappings = document.mappings;
    if (!mappings || typeof mappings !== 'object') {
      continue;
    }

    for (const [provider, providerMappings] of Object.entries(mappings)) {
      if (!providerMappings || typeof providerMappings !== 'object') {
        continue;
      }

      for (const [model, modelMappings] of Object.entries(providerMappings)) {
        if (!modelMappings || typeof modelMappings !== 'object') {
          continue;
        }

        for (const [mappingAlias, mappingValue] of Object.entries(
          modelMappings
        )) {
          const sources = collectMappingSources(mappingAlias, mappingValue);
          for (const sourceName of sources) {
            if (isDeclaredSource(sourceName, declaredInputs)) {
              continue;
            }
            issues.push({
              filePath,
              provider,
              model,
              mappingAlias,
              sourceName,
            });
          }
        }
      }
    }
  }

  if (issues.length === 0) {
    console.log('[mapping:audit] No undeclared mapping sources found.');
    return;
  }

  console.error(
    `[mapping:audit] Found ${issues.length} undeclared mapping source references:`
  );
  for (const issue of issues) {
    console.error(
      `- ${issue.filePath}\n  ${issue.provider}/${issue.model} :: ${issue.mappingAlias} uses "${issue.sourceName}"`
    );
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(
    '[mapping:audit] Failed:',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
