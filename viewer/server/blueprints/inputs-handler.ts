/**
 * Blueprint inputs file parsing handler.
 */

import { existsSync } from "node:fs";
import { parseInputsForDisplay } from "@gorenku/core";

/**
 * Parses an inputs file and returns structured data.
 * Uses core's parseInputsForDisplay for proper YAML parsing.
 * File references like "file:./input-files/..." are preserved as strings.
 */
export async function parseInputsFile(
  inputsPath: string,
): Promise<{ inputs: Array<{ name: string; value: unknown }> }> {
  try {
    if (!existsSync(inputsPath)) {
      return { inputs: [] };
    }

    // Use core's display parser for proper YAML handling (arrays, nested objects, etc.)
    const { inputs: inputsRecord } = await parseInputsForDisplay(inputsPath);

    // Convert from Record<string, unknown> to Array<{ name, value }> for API response
    const inputs = Object.entries(inputsRecord).map(([name, value]) => ({
      name,
      value,
    }));

    return { inputs };
  } catch {
    return { inputs: [] };
  }
}
