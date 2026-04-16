import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildStoryboardProjection,
  formatBlobFileName,
  expandBlueprintResolutionContext,
  isCanonicalArtifactId,
  loadBlueprintResolutionContext,
  parseInputsForDisplay,
  selectBlueprintResolutionInputs,
  type StoryboardArtifactState,
  type StoryboardProjection,
} from '@gorenku/core';
import { getBuildInputs, getBuildManifest } from '../builds/index.js';

export interface GetStoryboardProjectionArgs {
  blueprintPath: string;
  blueprintFolder?: string | null;
  movieId?: string | null;
  catalogRoot?: string;
}

export async function getStoryboardProjection(
  args: GetStoryboardProjectionArgs
): Promise<StoryboardProjection> {
  const blueprintFolder =
    args.blueprintFolder ?? path.dirname(args.blueprintPath);
  const context = await loadBlueprintResolutionContext({
    blueprintPath: args.blueprintPath,
    catalogRoot: args.catalogRoot,
    schemaSource: { kind: 'producer-metadata' },
  });

  const effectiveInputs = await resolveEffectiveInputs({
    blueprintFolder,
    blueprintPath: args.blueprintPath,
    movieId: args.movieId ?? null,
    catalogRoot: args.catalogRoot,
  });

  const { artifactStates, resolvedArtifactValues } =
    await resolveBuildArtifactContext({
      blueprintFolder,
      movieId: args.movieId ?? null,
    });
  const canonicalInputs = selectBlueprintResolutionInputs(
    context,
    effectiveInputs
  );
  const expanded = expandBlueprintResolutionContext(context, canonicalInputs);
  const normalizedArtifactContext = normalizeStoryboardArtifactContext({
    artifactStates,
    resolvedArtifactValues,
    outputSources: expanded.canonical.outputSources,
  });

  return buildStoryboardProjection({
    expanded,
    artifactStates: normalizedArtifactContext.artifactStates,
    resolvedArtifactValues: normalizedArtifactContext.resolvedArtifactValues,
  });
}

function normalizeStoryboardArtifactContext(args: {
  artifactStates: Record<string, StoryboardArtifactState>;
  resolvedArtifactValues: Record<string, unknown>;
  outputSources: Record<string, string>;
}): {
  artifactStates: Record<string, StoryboardArtifactState>;
  resolvedArtifactValues: Record<string, unknown>;
} {
  const artifactStates = { ...args.artifactStates };
  const resolvedArtifactValues = { ...args.resolvedArtifactValues };

  for (const [outputId, sourceId] of Object.entries(args.outputSources)) {
    if (!isCanonicalArtifactId(sourceId)) {
      continue;
    }
    const authoredArtifactId = `Artifact:${outputId.slice('Output:'.length)}`;

    const authoredState = artifactStates[authoredArtifactId] ?? artifactStates[outputId];
    if (authoredState && !artifactStates[sourceId]) {
      artifactStates[sourceId] = {
        ...authoredState,
        canonicalArtifactId: sourceId,
      };
    }

    if (
      resolvedArtifactValues[sourceId] === undefined &&
      resolvedArtifactValues[authoredArtifactId] !== undefined
    ) {
      resolvedArtifactValues[sourceId] =
        resolvedArtifactValues[authoredArtifactId];
    }
    if (
      resolvedArtifactValues[sourceId] === undefined &&
      resolvedArtifactValues[outputId] !== undefined
    ) {
      resolvedArtifactValues[sourceId] =
        resolvedArtifactValues[outputId];
    }
  }

  return {
    artifactStates,
    resolvedArtifactValues,
  };
}

async function resolveEffectiveInputs(args: {
  blueprintFolder: string;
  blueprintPath: string;
  movieId: string | null;
  catalogRoot?: string;
}): Promise<Record<string, unknown>> {
  if (args.movieId) {
    const buildInputs = await getBuildInputs(
      args.blueprintFolder,
      args.movieId,
      args.blueprintPath,
      args.catalogRoot
    );
    if (existsSync(buildInputs.inputsPath)) {
      return buildInputs.inputs;
    }

    const manifest = await getBuildManifest(
      args.blueprintFolder,
      args.movieId,
      args.blueprintPath,
      args.catalogRoot
    );
    if (Object.keys(manifest.inputs).length > 0) {
      return manifest.inputs;
    }
  }

  const inputTemplatePath = path.join(args.blueprintFolder, 'input-template.yaml');
  if (!existsSync(inputTemplatePath)) {
    throw new Error(
      `Storyboard projection requires "${inputTemplatePath}" when no build inputs are available.`
    );
  }

  const parsed = await parseInputsForDisplay(inputTemplatePath);
  return parsed.inputs;
}

async function resolveBuildArtifactContext(args: {
  blueprintFolder: string;
  movieId: string | null;
}): Promise<{
  artifactStates: Record<string, StoryboardArtifactState>;
  resolvedArtifactValues: Record<string, unknown>;
}> {
  if (!args.movieId) {
    return {
      artifactStates: {},
      resolvedArtifactValues: {},
    };
  }

  const manifest = await getBuildManifest(args.blueprintFolder, args.movieId);
  const artifactStates: Record<string, StoryboardArtifactState> = {};
  const resolvedArtifactValues: Record<string, unknown> = {};

  for (const artifact of manifest.artifacts) {
    artifactStates[artifact.id] = {
      canonicalArtifactId: artifact.id,
      status:
        artifact.status === 'failed' || artifact.status === 'skipped'
          ? artifact.status
          : 'succeeded',
      hash: artifact.hash,
      mimeType: artifact.mimeType,
      failureReason: artifact.failureReason,
      skipMessage: artifact.skipMessage,
    };

    const shouldReadValue =
      artifact.status === 'succeeded' &&
      artifact.hash &&
      (artifact.mimeType === 'application/json' ||
        artifact.mimeType.startsWith('text/'));
    if (!shouldReadValue) {
      continue;
    }

    const blobPath = path.join(
      args.blueprintFolder,
      'builds',
      args.movieId,
      'blobs',
      artifact.hash.slice(0, 2),
      formatBlobFileName(artifact.hash, artifact.mimeType)
    );
    if (!existsSync(blobPath)) {
      continue;
    }

    const buffer = await fs.readFile(blobPath);
    const text = buffer.toString('utf8');
    resolvedArtifactValues[artifact.id] =
      artifact.mimeType === 'application/json' ? JSON.parse(text) : text;
  }

  return {
    artifactStates,
    resolvedArtifactValues,
  };
}
