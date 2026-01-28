/**
 * Blueprint inputs file parsing handler.
 */

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";

/**
 * Parses an inputs file and returns structured data.
 * Uses simple YAML key-value extraction.
 */
export async function parseInputsFile(
  inputsPath: string,
): Promise<{ inputs: Array<{ name: string; value: unknown }> }> {
  try {
    if (!existsSync(inputsPath)) {
      return { inputs: [] };
    }
    const content = await fs.readFile(inputsPath, "utf8");
    // Parse YAML - simple key-value extraction
    const lines = content.split("\n");
    const inputs: Array<{ name: string; value: unknown }> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0) {
        const name = trimmed.slice(0, colonIndex).trim();
        let value: unknown = trimmed.slice(colonIndex + 1).trim();

        // Strip YAML quotes and handle escapes
        if (typeof value === "string") {
          if (value.startsWith('"') && value.endsWith('"')) {
            // Double-quoted: handle escape sequences
            const inner = value.slice(1, -1);
            value = inner.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          } else if (value.startsWith("'") && value.endsWith("'")) {
            // Single-quoted: no escape handling in YAML
            value = value.slice(1, -1);
          } else if (value === "true") {
            value = true;
          } else if (value === "false") {
            value = false;
          } else if (value !== "" && !isNaN(Number(value))) {
            value = Number(value);
          }
        }

        inputs.push({ name, value });
      }
    }

    return { inputs };
  } catch {
    return { inputs: [] };
  }
}
