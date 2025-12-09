import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Conditionally save test artifacts to disk based on SAVE_TEST_ARTIFACTS environment variable.
 * When enabled, files are saved to providers/tmp/ directory (which is git-ignored).
 *
 * @param filename - Name of the file to save (e.g., 'test-video.mp4')
 * @param data - File data as Uint8Array or string
 */
export function saveTestArtifact(filename: string, data: Uint8Array | string): void {
  if (process.env.SAVE_TEST_ARTIFACTS === '1') {
    // Save to providers/tmp instead of directly in tests/integration
    const tmpDir = join(__dirname, '..', '..', 'tmp');
    const outputPath = join(tmpDir, filename);
    writeFileSync(outputPath, data);
    console.log(`Test artifact saved to: ${outputPath}`);
  }
}
