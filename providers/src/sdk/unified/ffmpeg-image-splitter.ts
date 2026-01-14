import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProducedArtefact } from '@gorenku/core';
import type { ProviderMode } from '../../types.js';
import { generateMockPng } from './png-generator.js';

/**
 * Pattern to match PanelImages artifact names with indices.
 * Matches: "PanelImages[0]", "PanelImages[1]", etc.
 * Does not match prefixed names like "MyPanelImages[0]".
 */
const PANEL_IMAGES_PATTERN = /^PanelImages\[(\d+)\]$/;

export interface GridDimensions {
  /** Number of columns in the grid */
  cols: number;
  /** Number of rows in the grid */
  rows: number;
}

export interface PanelExtractionOptions {
  /** The downloaded image buffer */
  imageBuffer: Buffer;
  /** The artifact ID of the primary image artifact */
  primaryArtifactId: string;
  /** All artifact IDs this job produces */
  produces: string[];
  /** Grid style string (e.g., "3x3", "2x3") */
  gridStyle: string;
  /** Provider mode (live or simulated) */
  mode?: ProviderMode;
}

export interface RequiredPanelExtractions {
  /** Map of panel index to artifact ID */
  panels: Map<number, string>;
}

export interface PanelExtractionResult {
  /** Array of produced artifacts, one per panel */
  panels: ProducedArtefact[];
}

// Cache for ffmpeg/ffprobe availability check
let ffmpegAvailabilityCache: boolean | null = null;
let ffmpegWarningLogged = false;

/**
 * Parse grid style string into dimensions.
 * @example parseGridStyle("3x3") => { cols: 3, rows: 3 }
 * @example parseGridStyle("2x3") => { cols: 2, rows: 3 }
 */
export function parseGridStyle(gridStyle: string): GridDimensions {
  const match = gridStyle.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid GridStyle format: "${gridStyle}". Expected "ColsxRows" (e.g., "3x3", "2x3").`);
  }
  const cols = parseInt(match[1], 10);
  const rows = parseInt(match[2], 10);

  if (cols < 1 || rows < 1) {
    throw new Error(`Invalid GridStyle dimensions: cols=${cols}, rows=${rows}. Both must be >= 1.`);
  }

  return { cols, rows };
}

/**
 * Check if ffmpeg is available on the system.
 * Result is cached for the lifetime of the process.
 */
export async function checkFfmpegAvailability(): Promise<boolean> {
  if (ffmpegAvailabilityCache !== null) {
    return ffmpegAvailabilityCache;
  }

  try {
    await runFfmpegCommand(['-version']);
    ffmpegAvailabilityCache = true;
  } catch {
    ffmpegAvailabilityCache = false;
  }

  return ffmpegAvailabilityCache;
}

/**
 * Log a warning about missing ffmpeg (only once per process).
 */
function logFfmpegMissingWarning(): void {
  if (ffmpegWarningLogged) {
    return;
  }
  ffmpegWarningLogged = true;
  console.warn(
    'Warning: ffmpeg not found. Panel image extraction will be skipped. ' +
      'Install ffmpeg to enable image grid splitting. ' +
      'See: https://ffmpeg.org/download.html',
  );
}

/**
 * Detect which panel artifacts need to be extracted based on the produces array.
 * Returns a map of panel index to artifact ID.
 */
export function detectPanelExtractions(produces: string[]): RequiredPanelExtractions {
  const panels = new Map<number, string>();

  for (const artifactId of produces) {
    const baseName = extractArtifactBaseName(artifactId);
    const match = baseName.match(PANEL_IMAGES_PATTERN);
    if (match) {
      const panelIndex = parseInt(match[1], 10);
      panels.set(panelIndex, artifactId);
    }
  }

  return { panels };
}

/**
 * Extract the base artifact name from a canonical artifact ID.
 * Example: "Artifact:TextToImageProducer.PanelImages[0]" -> "PanelImages[0]"
 */
function extractArtifactBaseName(artifactId: string): string {
  // Remove "Artifact:" prefix if present
  const withoutPrefix = artifactId.startsWith('Artifact:') ? artifactId.slice('Artifact:'.length) : artifactId;

  // Get the last segment after dots (but keep brackets)
  const segments = withoutPrefix.split('.');
  return segments[segments.length - 1] || withoutPrefix;
}

/**
 * Check if any panel extractions are needed.
 */
export function needsPanelExtraction(extractions: RequiredPanelExtractions): boolean {
  return extractions.panels.size > 0;
}

/**
 * Extract panel images from a grid image buffer.
 * In simulated mode, generates mock data instead of calling ffmpeg.
 */
export async function extractPanelImages(options: PanelExtractionOptions): Promise<PanelExtractionResult> {
  const { imageBuffer, produces, gridStyle, mode } = options;
  const extractions = detectPanelExtractions(produces);

  // If no panels requested, return empty result
  if (!needsPanelExtraction(extractions)) {
    return { panels: [] };
  }

  // Parse grid dimensions
  let gridDimensions: GridDimensions;
  try {
    gridDimensions = parseGridStyle(gridStyle);
  } catch (error) {
    return generateFailedPanelResult(extractions, 'invalid_grid_style', error instanceof Error ? error.message : String(error));
  }

  // In simulated mode, generate mock panels
  if (mode === 'simulated') {
    return generateMockPanelResult(extractions, gridDimensions);
  }

  // Check ffmpeg availability
  const ffmpegAvailable = await checkFfmpegAvailability();
  if (!ffmpegAvailable) {
    logFfmpegMissingWarning();
    return generateSkippedPanelResult(extractions, 'ffmpeg_not_available');
  }

  // Create temp directory and write image to temp file
  const tempDir = join(tmpdir(), `renku-panel-${randomUUID()}`);
  const tempImagePath = join(tempDir, 'input.jpg');

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempImagePath, imageBuffer);

    // Get image dimensions using ffprobe
    const imageDimensions = await probeImageDimensions(tempImagePath);

    // Calculate panel dimensions
    const panelWidth = Math.floor(imageDimensions.width / gridDimensions.cols);
    const panelHeight = Math.floor(imageDimensions.height / gridDimensions.rows);

    // Extract each requested panel
    const panels: ProducedArtefact[] = [];
    for (const [panelIndex, artifactId] of extractions.panels) {
      // Validate panel index is within grid bounds
      const totalPanels = gridDimensions.cols * gridDimensions.rows;
      if (panelIndex < 0 || panelIndex >= totalPanels) {
        panels.push({
          artefactId: artifactId,
          status: 'failed',
          diagnostics: {
            extraction: 'panel',
            panelIndex,
            reason: 'panel_index_out_of_range',
            validRange: `0-${totalPanels - 1}`,
          },
        });
        continue;
      }

      const panel = await extractSinglePanel(
        tempImagePath,
        artifactId,
        panelIndex,
        gridDimensions,
        panelWidth,
        panelHeight,
      );
      panels.push(panel);
    }

    return { panels };
  } finally {
    // Clean up temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract a single panel from the image using ffmpeg crop filter.
 */
async function extractSinglePanel(
  imagePath: string,
  artifactId: string,
  panelIndex: number,
  gridDimensions: GridDimensions,
  panelWidth: number,
  panelHeight: number,
): Promise<ProducedArtefact> {
  // Calculate position (reading order: left-to-right, top-to-bottom)
  const col = panelIndex % gridDimensions.cols;
  const row = Math.floor(panelIndex / gridDimensions.cols);
  const x = col * panelWidth;
  const y = row * panelHeight;

  try {
    const buffer = await runFfmpegCommand([
      '-i',
      imagePath,
      '-vf',
      `crop=${panelWidth}:${panelHeight}:${x}:${y}`,
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      '-',
    ]);

    return {
      artefactId: artifactId,
      status: 'succeeded',
      blob: {
        data: buffer,
        mimeType: 'image/png',
      },
      diagnostics: {
        extraction: 'panel',
        panelIndex,
        gridPosition: { row, col },
        crop: { x, y, width: panelWidth, height: panelHeight },
        size: buffer.length,
      },
    };
  } catch (error) {
    return {
      artefactId: artifactId,
      status: 'failed',
      diagnostics: {
        extraction: 'panel',
        panelIndex,
        gridPosition: { row, col },
        reason: 'extraction_failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Get image dimensions using ffprobe.
 */
async function probeImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const output = await runFfprobeCommand([
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    imagePath,
  ]);

  const data = JSON.parse(output.toString('utf8'));
  const stream = data.streams?.[0];

  if (!stream?.width || !stream?.height) {
    throw new Error('Failed to read image dimensions from ffprobe output');
  }

  return {
    width: stream.width,
    height: stream.height,
  };
}

/**
 * Generate mock panel extraction results for simulated mode.
 */
function generateMockPanelResult(
  extractions: RequiredPanelExtractions,
  gridDimensions: GridDimensions,
): PanelExtractionResult {
  const panels: ProducedArtefact[] = [];

  for (const [panelIndex, artifactId] of extractions.panels) {
    const col = panelIndex % gridDimensions.cols;
    const row = Math.floor(panelIndex / gridDimensions.cols);

    // Generate a uniquely colored mock PNG for each panel
    const color = {
      r: (panelIndex * 30 + 100) % 256,
      g: (panelIndex * 50 + 80) % 256,
      b: (panelIndex * 70 + 60) % 256,
    };

    panels.push({
      artefactId: artifactId,
      status: 'succeeded',
      blob: {
        data: generateMockPng(100, 100, color),
        mimeType: 'image/png',
      },
      diagnostics: {
        source: 'simulated',
        extraction: 'panel',
        panelIndex,
        gridPosition: { row, col },
      },
    });
  }

  return { panels };
}

/**
 * Generate skipped panel extraction results when ffmpeg is not available.
 */
function generateSkippedPanelResult(extractions: RequiredPanelExtractions, reason: string): PanelExtractionResult {
  const panels: ProducedArtefact[] = [];

  for (const [panelIndex, artifactId] of extractions.panels) {
    panels.push({
      artefactId: artifactId,
      status: 'skipped',
      diagnostics: {
        reason,
        extraction: 'panel',
        panelIndex,
      },
    });
  }

  return { panels };
}

/**
 * Generate failed panel extraction results.
 */
function generateFailedPanelResult(
  extractions: RequiredPanelExtractions,
  reason: string,
  errorMessage: string,
): PanelExtractionResult {
  const panels: ProducedArtefact[] = [];

  for (const [panelIndex, artifactId] of extractions.panels) {
    panels.push({
      artefactId: artifactId,
      status: 'failed',
      diagnostics: {
        reason,
        extraction: 'panel',
        panelIndex,
        error: errorMessage,
      },
    });
  }

  return { panels };
}

/**
 * Run an ffmpeg command and return the stdout as a Buffer.
 */
function runFfmpegCommand(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = Buffer.concat(errorChunks).toString('utf8');
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
  });
}

/**
 * Run an ffprobe command and return the stdout as a Buffer.
 */
function runFfprobeCommand(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    const ffprobe = spawn('ffprobe', args);

    ffprobe.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffprobe.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = Buffer.concat(errorChunks).toString('utf8');
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });

    ffprobe.on('error', (error) => {
      reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
    });
  });
}

/**
 * Reset the ffmpeg availability cache.
 * Mainly useful for testing.
 */
export function resetFfmpegCache(): void {
  ffmpegAvailabilityCache = null;
  ffmpegWarningLogged = false;
}
