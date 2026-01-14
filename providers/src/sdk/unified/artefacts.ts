import { Buffer } from 'node:buffer';
import { isCanonicalArtifactId, readJsonPath, type ProducedArtefact } from '@gorenku/core';
import type { ProviderMode } from '../../types.js';
import {
  detectRequiredExtractions,
  extractDerivedArtefacts,
  needsExtraction,
  type RequiredExtractions,
} from './ffmpeg-extractor.js';
import {
  detectPanelExtractions,
  extractPanelImages,
  needsPanelExtraction,
  type RequiredPanelExtractions,
} from './ffmpeg-image-splitter.js';
import { generateMockPng } from './png-generator.js';
import { generateWavWithDuration } from './wav-generator.js';

type JsonObject = Record<string, unknown>;

export interface BuildArtefactsOptions {
  produces: string[];
  urls: string[];
  mimeType: string;
  mode?: ProviderMode;
  resolvedInputs?: Record<string, unknown>;
}

export interface BuildArtefactFromJsonOptions {
  producerId?: string;
  namespaceOrdinalDepth?: number;
}

export interface BuildJsonArtefactsOptions {
  produces: string[];
  jsonOutput: unknown;
  mimeType: string;
}

/**
 * Creates ProducedArtefact objects from a JSON response.
 * Used for models that return structured data (like STT) rather than media URLs.
 *
 * The entire JSON response becomes the artifact blob data.
 */
export function buildArtefactsFromJson(options: BuildJsonArtefactsOptions): ProducedArtefact[] {
  const { produces, jsonOutput, mimeType } = options;

  // Serialize the JSON output
  const jsonData = JSON.stringify(jsonOutput, null, 2);
  const buffer = Buffer.from(jsonData, 'utf-8');

  // For JSON outputs, all produces share the same data
  // (typically there's only one artifact for JSON responses)
  return produces.map((providedId, index) => {
    const artefactId = providedId && providedId.length > 0 ? providedId : `Artifact:Output#${index}`;

    return {
      artefactId,
      status: 'succeeded' as const,
      blob: {
        data: buffer,
        mimeType,
      },
      diagnostics: {
        outputType: 'json',
      },
    };
  });
}

export interface ParsedArtefactIdentifier {
  /** Full artifact kind path (e.g., "Producer.Image") */
  kind: string;
  /** Base name without namespace path (e.g., "Image") */
  baseName: string;
  /** JSON path for decomposed artifacts (e.g., "Segments[0].Script") */
  jsonPath?: string;
  index?: Record<string, number>;
  ordinal?: number[];
}

interface ArtefactExtractionContext {
  skipNamespaceOrdinals: number;
  parentArtifactName?: string;
}

/**
 * Resolves duration for mock audio/video assets from resolved inputs.
 * Looks for common duration field names in the resolved inputs.
 */
function resolveDurationForMock(resolvedInputs: Record<string, unknown> | undefined): number {
  if (!resolvedInputs) {
    return 5; // Default 5 seconds
  }

  const durationKeys = ['Duration', 'ClipDuration', 'SegmentDuration'];
  for (const key of durationKeys) {
    const value = resolvedInputs[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 5; // Default 5 seconds
}

/**
 * Downloads binary data from URLs and creates ProducedArtefact objects.
 * Handles missing URLs and download failures gracefully.
 *
 * In simulated mode, generates valid WAV files with the expected duration
 * instead of downloading. This ensures mediabunny can extract duration
 * using the same code path as live mode.
 *
 * For video artifacts, this function also extracts derived artifacts
 * (FirstFrame, LastFrame, AudioTrack) using ffmpeg when they are
 * included in the produces array.
 *
 * For image artifacts, this function can extract panel images from a grid
 * when PanelImages[N] artifacts are included in the produces array.
 */
export async function buildArtefactsFromUrls(options: BuildArtefactsOptions): Promise<ProducedArtefact[]> {
  const { produces, urls, mimeType, mode, resolvedInputs } = options;
  const artefacts: ProducedArtefact[] = [];
  const useMockDownloads = mode === 'simulated';

  // Detect which extractions are needed from video
  const requiredExtractions = detectRequiredExtractions(produces);
  const extractionNeeded = needsExtraction(requiredExtractions);
  const isVideo = isVideoMimeType(mimeType);

  // Detect which panel extractions are needed from image
  const panelExtractions = detectPanelExtractions(produces);
  const panelExtractionNeeded = needsPanelExtraction(panelExtractions);
  const isImage = isImageMimeType(mimeType);
  const gridStyle = resolveGridStyle(resolvedInputs);

  // Filter out derived artifact IDs from primary processing
  // (they will be handled by extraction, not URL download)
  let primaryProduces = produces;
  if (extractionNeeded) {
    primaryProduces = filterPrimaryArtifacts(primaryProduces, requiredExtractions);
  }
  if (panelExtractionNeeded) {
    primaryProduces = filterPanelArtifacts(primaryProduces, panelExtractions);
  }

  // Track video buffer for extraction
  let videoBuffer: Buffer | null = null;
  let primaryVideoArtifactId: string | null = null;

  // Track image buffer for panel extraction
  let imageBuffer: Buffer | null = null;
  let primaryImageArtifactId: string | null = null;

  for (let index = 0; index < primaryProduces.length; index += 1) {
    const providedId = primaryProduces[index];
    const artefactId = providedId && providedId.length > 0 ? providedId : `Artifact:Output#${index}`;
    const url = urls[index];

    if (!url) {
      artefacts.push({
        artefactId,
        status: 'failed',
        diagnostics: {
          reason: 'missing_output',
          index,
        },
      });
      continue;
    }

    try {
      const buffer = useMockDownloads
        ? generateMockDataForMimeType(mimeType, resolveDurationForMock(resolvedInputs))
        : await downloadBinary(url);

      artefacts.push({
        artefactId,
        status: 'succeeded',
        blob: {
          data: buffer,
          mimeType,
        },
        diagnostics: {
          sourceUrl: url,
        },
      });

      // Store video buffer for extraction
      if (isVideo && extractionNeeded && !videoBuffer) {
        videoBuffer = buffer;
        primaryVideoArtifactId = artefactId;
      }

      // Store image buffer for panel extraction
      if (isImage && panelExtractionNeeded && !imageBuffer) {
        imageBuffer = buffer;
        primaryImageArtifactId = artefactId;
      }
    } catch (error) {
      artefacts.push({
        artefactId,
        status: 'failed',
        diagnostics: {
          reason: 'download_failed',
          url,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // Extract derived artifacts from video if needed
  if (isVideo && extractionNeeded && videoBuffer && primaryVideoArtifactId) {
    const mockDuration = resolveDurationForMock(resolvedInputs);
    const extracted = await extractDerivedArtefacts({
      videoBuffer,
      primaryArtifactId: primaryVideoArtifactId,
      produces,
      mode,
      mockDurationSeconds: mockDuration,
    });

    // Add extracted artifacts to results
    if (extracted.firstFrame) {
      artefacts.push(extracted.firstFrame);
    }
    if (extracted.lastFrame) {
      artefacts.push(extracted.lastFrame);
    }
    if (extracted.audioTrack) {
      artefacts.push(extracted.audioTrack);
    }
  }

  // Extract panel images from image grid if needed
  if (isImage && panelExtractionNeeded && imageBuffer && primaryImageArtifactId && gridStyle) {
    const extracted = await extractPanelImages({
      imageBuffer,
      primaryArtifactId: primaryImageArtifactId,
      produces,
      gridStyle,
      mode,
    });

    // Add extracted panel artifacts to results
    artefacts.push(...extracted.panels);
  }

  return artefacts;
}

/**
 * Check if a MIME type represents a video format.
 */
function isVideoMimeType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * Check if a MIME type represents an image format.
 */
function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Generate mock data appropriate for the given MIME type.
 * - Images: generate a small PNG
 * - Audio/Video: generate a WAV with the specified duration
 */
function generateMockDataForMimeType(mimeType: string, durationSeconds: number): Buffer {
  if (mimeType.startsWith('image/')) {
    // Generate a 100x100 mock PNG for images
    return generateMockPng(100, 100);
  }
  // Default to WAV for audio/video
  return generateWavWithDuration(durationSeconds);
}

/**
 * Resolve the GridStyle from resolved inputs.
 * Returns the grid style string (e.g., "3x3", "2x3") or undefined if not present.
 * Searches for canonical input IDs ending with "GridStyle" (e.g., "Input:GridStyle",
 * "Input:StoryboardImageProducer.GridStyle").
 */
function resolveGridStyle(resolvedInputs: Record<string, unknown> | undefined): string | undefined {
  if (!resolvedInputs) {
    return undefined;
  }
  // Look for any key ending with "GridStyle" (canonical input IDs like Input:GridStyle
  // or Input:Producer.GridStyle)
  for (const [key, value] of Object.entries(resolvedInputs)) {
    if (key.endsWith('GridStyle') && typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

/**
 * Filter out derived artifact IDs from the produces array.
 * Returns only the primary artifacts that have URLs from the provider.
 */
function filterPrimaryArtifacts(produces: string[], extractions: RequiredExtractions): string[] {
  const derivedIds = new Set<string>();
  if (extractions.firstFrameId) {
    derivedIds.add(extractions.firstFrameId);
  }
  if (extractions.lastFrameId) {
    derivedIds.add(extractions.lastFrameId);
  }
  if (extractions.audioTrackId) {
    derivedIds.add(extractions.audioTrackId);
  }

  return produces.filter((id) => !derivedIds.has(id));
}

/**
 * Filter out panel artifact IDs from the produces array.
 * Returns only the primary artifacts that have URLs from the provider.
 */
function filterPanelArtifacts(produces: string[], extractions: RequiredPanelExtractions): string[] {
  const panelIds = new Set(extractions.panels.values());
  return produces.filter((id) => !panelIds.has(id));
}

/**
 * Downloads binary data from a URL and returns it as a Buffer.
 */
export async function downloadBinary(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Builds artifacts from JSON response using canonical mapping.
 * Supports both simple field extraction and decomposed JSON artifacts.
 *
 * Convention: JSON field names **must** match the canonical artefact kind
 * (PascalCase, without namespace). No heuristics or fallbacks.
 *
 * @example
 * JSON response: { MovieTitle: "...", NarrationScript: ["seg1", "seg2", "seg3"] }
 * Produces:
 *   - "Artifact:MovieTitle" → MovieTitle
 *   - "Artifact:NarrationScript[0]" → NarrationScript[0]
 *   - "Artifact:NarrationScript[1]" → NarrationScript[1]
 *   - "Artifact:NarrationScript[2]" → NarrationScript[2]
 */
export function buildArtefactsFromJsonResponse(
  response: JsonObject | string,
  produces: string[],
  options: BuildArtefactFromJsonOptions = {},
): ProducedArtefact[] {
  const artefacts: ProducedArtefact[] = [];
  const jsonResponse = typeof response === 'string' ? response : response;
  const context: ArtefactExtractionContext = {
    skipNamespaceOrdinals: resolveNamespaceOrdinalDepth(options),
    parentArtifactName: detectParentArtifactName(produces),
  };

  for (const artefactId of produces) {
    const artefact = buildSingleArtefact(jsonResponse, artefactId, context);
    artefacts.push(artefact);
  }

  return artefacts;
}

/**
 * Detects if artifacts are decomposed from a parent JSON artifact.
 * Returns the parent artifact name if all artifacts share a common parent pattern.
 *
 * For example, given:
 * - "Artifact:DocProducer.VideoScript.Title"
 * - "Artifact:DocProducer.VideoScript.Segments[0].Script"
 *
 * Returns "VideoScript" as the parent artifact name.
 */
function detectParentArtifactName(produces: string[]): string | undefined {
  if (produces.length === 0) {
    return undefined;
  }

  // Extract paths without "Artifact:" prefix and without bracket segments
  const paths = produces.map((id) => {
    if (!id.startsWith('Artifact:')) {
      return '';
    }
    // Remove brackets and their contents, then split by dots
    return id.slice('Artifact:'.length).replace(/\[[^\]]+\]/g, '');
  });

  // Find segments that are common to all paths
  const firstPathSegments = paths[0]?.split('.') ?? [];
  if (firstPathSegments.length < 2) {
    // Need at least namespace.artifact for decomposition
    return undefined;
  }

  // Check if all paths share the same first two segments (namespace.artifactName)
  // and have additional segments (indicating decomposition)
  const namespace = firstPathSegments[0];
  const potentialParent = firstPathSegments[1];

  if (!namespace || !potentialParent) {
    return undefined;
  }

  const prefix = `${namespace}.${potentialParent}`;

  // Check if all artifacts:
  // 1. Share this prefix
  // 2. Have additional path segments (indicating they're decomposed fields)
  let allSharePrefix = true;
  let anyHasAdditionalPath = false;

  for (const path of paths) {
    if (!path.startsWith(prefix)) {
      allSharePrefix = false;
      break;
    }
    // Check if there's more after the prefix
    if (path.length > prefix.length && path[prefix.length] === '.') {
      anyHasAdditionalPath = true;
    }
  }

  // Only return parent name if all share the prefix AND at least one has additional path
  if (allSharePrefix && anyHasAdditionalPath) {
    return potentialParent;
  }

  return undefined;
}

function buildSingleArtefact(
  response: JsonObject | string,
  artefactId: string,
  context: ArtefactExtractionContext,
): ProducedArtefact {
  const diagnostics: Record<string, unknown> = {};

  // For text responses, return the whole text
  if (typeof response === 'string') {
    return {
      artefactId,
      status: 'succeeded',
      blob: {
        data: response,
        mimeType: 'text/plain',
      },
      diagnostics: { responseType: 'text' },
    };
  }

  // For JSON responses, use implicit mapping
  const parsed = parseArtefactIdentifier(artefactId, context.parentArtifactName);
  if (!parsed) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { reason: 'invalid_artefact_id', artefactId },
    };
  }

  diagnostics.kind = parsed.kind;

  // For decomposed artifacts with JSON path, use readJsonPath
  if (parsed.jsonPath) {
    diagnostics.jsonPath = parsed.jsonPath;
    const result = readJsonPath(response, parsed.jsonPath);
    if (!result.exists) {
      return {
        artefactId,
        status: 'failed',
        diagnostics: { ...diagnostics, reason: 'json_path_not_found', jsonPath: parsed.jsonPath },
      };
    }

    const materialized = materializeValue(result.value);
    if (!materialized.success) {
      return {
        artefactId,
        status: 'failed',
        diagnostics: { ...diagnostics, reason: 'materialization_failed', error: materialized.error },
      };
    }

    return {
      artefactId,
      status: 'succeeded',
      blob: {
        data: materialized.text ?? '',
        mimeType: 'text/plain',
      },
      diagnostics,
    };
  }

  // For simple artifacts, use field name lookup
  const fieldName = parsed.baseName;
  diagnostics.field = fieldName;

  // Extract field value from JSON
  const fieldValue = response[fieldName];
  if (fieldValue === undefined) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { ...diagnostics, reason: 'missing_field', field: fieldName },
    };
  }

  let value: unknown = fieldValue;

  const effectiveOrdinal = trimNamespaceOrdinals(parsed.ordinal, context);

  if (effectiveOrdinal && effectiveOrdinal.length > 0) {
    value = selectByOrdinal(fieldValue, effectiveOrdinal, diagnostics);
    if (value === undefined) {
      return {
        artefactId,
        status: 'failed',
        diagnostics,
      };
    }
  } else if (parsed.index?.segment !== undefined) {
    value = selectArrayElement(fieldValue, parsed.index.segment, diagnostics);
    if (value === undefined) {
      return {
        artefactId,
        status: 'failed',
        diagnostics,
      };
    }
  }

  // Materialize value to string
  const materialized = materializeValue(value);
  if (!materialized.success) {
    return {
      artefactId,
      status: 'failed',
      diagnostics: { ...diagnostics, reason: 'materialization_failed', error: materialized.error },
    };
  }

  return {
    artefactId,
    status: 'succeeded',
    blob: {
      data: materialized.text ?? '',
      mimeType: 'text/plain',
    },
    diagnostics,
  };
}

/**
 * Parses artifact identifier into kind and index components.
 *
 * @example
 * "Artifact:MovieTitle" → { kind: "MovieTitle", baseName: "MovieTitle" }
 * "Artifact:NarrationScript[segment=2]" → { kind: "NarrationScript", baseName: "NarrationScript", index: { segment: 2 } }
 * "Artifact:DocProducer.VideoScript.Segments[0].Script" → { kind: "...", baseName: "Script", jsonPath: "Segments[0].Script" }
 *
 * @param identifier - The artifact identifier
 * @param parentArtifactName - Optional parent artifact name for decomposed artifacts.
 *                             When provided, the JSON path is extracted after this name.
 */
export function parseArtefactIdentifier(
  identifier: string,
  parentArtifactName?: string,
): ParsedArtefactIdentifier | null {
  if (!isCanonicalArtifactId(identifier)) {
    return null;
  }

  const remainder = identifier.slice('Artifact:'.length);

  // For decomposed artifacts, extract the JSON path after the parent artifact name
  let jsonPath: string | undefined;
  if (parentArtifactName) {
    // Find the parent artifact name in the path and extract everything after it
    const parentPattern = new RegExp(`\\.${escapeRegex(parentArtifactName)}\\.(.+)$`);
    const match = remainder.match(parentPattern);
    if (match?.[1]) {
      jsonPath = match[1];
    }
  }

  // Parse dimension indices from brackets in the full identifier
  const index: Record<string, number> = {};
  const ordinal: number[] = [];

  // Extract all bracket segments for dimension parsing
  const bracketMatches = remainder.match(/\[[^\]]+\]/g) ?? [];
  for (const bracket of bracketMatches) {
    const content = bracket.slice(1, -1);
    const pairs = content.split('&');

    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        const parsedValue = Number(value.trim());
        if (!Number.isNaN(parsedValue) && Number.isInteger(parsedValue)) {
          index[key.trim()] = parsedValue;
        }
      } else if (key) {
        const parsedValue = Number(key.trim());
        if (!Number.isNaN(parsedValue) && Number.isInteger(parsedValue)) {
          ordinal.push(parsedValue);
        }
      }
    }
  }

  // Extract kind (path without brackets) and baseName (last segment)
  const kindWithoutBrackets = remainder.replace(/\[[^\]]+\]/g, '');
  const kind = kindWithoutBrackets;
  const dotIndex = kindWithoutBrackets.lastIndexOf('.');
  const baseName = dotIndex >= 0 ? kindWithoutBrackets.slice(dotIndex + 1) : kindWithoutBrackets;

  return {
    kind,
    baseName,
    jsonPath,
    index: Object.keys(index).length > 0 ? index : undefined,
    ordinal: ordinal.length > 0 ? ordinal : undefined,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimNamespaceOrdinals(
  ordinal: number[] | undefined,
  context: ArtefactExtractionContext,
): number[] | undefined {
  if (!ordinal || ordinal.length === 0) {
    return ordinal;
  }
  const skip = context.skipNamespaceOrdinals;
  if (skip <= 0) {
    return ordinal;
  }
  if (skip >= ordinal.length) {
    return [];
  }
  return ordinal.slice(skip);
}

function resolveNamespaceOrdinalDepth(options: BuildArtefactFromJsonOptions): number {
  if (typeof options.namespaceOrdinalDepth === 'number' && options.namespaceOrdinalDepth >= 0) {
    return options.namespaceOrdinalDepth;
  }
  if (options.producerId) {
    return countBracketSegments(options.producerId);
  }
  return 0;
}

function countBracketSegments(identifier: string): number {
  const matches = identifier.match(/\[[^\]]+\]/g);
  return matches ? matches.length : 0;
}

function selectArrayElement(
  fieldValue: unknown,
  elementIndex: number,
  diagnostics: Record<string, unknown>,
): unknown {
  if (!Array.isArray(fieldValue)) {
    diagnostics.reason = 'expected_array';
    diagnostics.actualType = typeof fieldValue;
    return undefined;
  }
  const value = fieldValue[elementIndex];
  if (value === undefined) {
    diagnostics.reason = 'segment_out_of_bounds';
    diagnostics.segmentIndex = elementIndex;
    diagnostics.arrayLength = fieldValue.length;
    return undefined;
  }
  diagnostics.segmentIndex = elementIndex;
  return value;
}

function selectByOrdinal(
  fieldValue: unknown,
  ordinal: number[],
  diagnostics: Record<string, unknown>,
): unknown {
  let current: unknown = fieldValue;
  for (const [depth, index] of ordinal.entries()) {
    if (!Array.isArray(current)) {
      diagnostics.reason = 'expected_array';
      diagnostics.depth = depth;
      diagnostics.actualType = typeof current;
      return undefined;
    }
    const arr = current as unknown[];
    current = arr[index];
    if (current === undefined) {
      diagnostics.reason = 'segment_out_of_bounds';
      diagnostics.depth = depth;
      diagnostics.segmentIndex = index;
      diagnostics.arrayLength = arr.length;
      return undefined;
    }
  }
  diagnostics.ordinal = ordinal;
  return current;
}

/**
 * Materializes a value to string format.
 */
function materializeValue(value: unknown): {
  success: boolean;
  text?: string;
  error?: string;
} {
  if (value === null || value === undefined) {
    return { success: false, error: 'Value is undefined or null.' };
  }

  // String value
  if (typeof value === 'string') {
    return { success: true, text: value };
  }

  // Binary data
  if (value instanceof Uint8Array) {
    return { success: true, text: Buffer.from(value).toString('utf8') };
  }

  // Number or boolean
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { success: true, text: String(value) };
  }

  // Array - join items with newlines
  if (Array.isArray(value)) {
    const text = value.map((item) => (item === null || item === undefined ? '' : String(item))).join('\n');
    return { success: true, text };
  }

  // Object or other - serialize to JSON
  try {
    const text = JSON.stringify(value, null, 2);
    return { success: true, text };
  } catch {
    return { success: false, error: 'Unable to serialize value to JSON.' };
  }
}
