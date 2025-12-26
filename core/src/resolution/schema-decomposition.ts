/**
 * Schema Decomposition Utility
 *
 * Walks a JSON schema and generates artifact definitions for each leaf field.
 * This enables decomposing a single JSON output into multiple separate artifacts,
 * each tracked independently for dirty detection.
 */

import type {
  ArrayDimensionMapping,
  JsonSchemaDefinition,
  JsonSchemaProperty,
} from '../types.js';

/**
 * A decomposed artifact from a JSON schema.
 * Represents a single leaf field that will become a separate artifact.
 */
export interface DecomposedArtifact {
  /**
   * Full artifact path including the parent artifact name.
   * E.g., "VideoScript.Title" or "VideoScript.Segments[segment].Script"
   */
  path: string;

  /**
   * JSON path for extracting the value at runtime.
   * E.g., "Title" or "Segments[segment].Script"
   */
  jsonPath: string;

  /**
   * The type of the extracted value.
   */
  type: 'string' | 'number' | 'integer' | 'boolean';

  /**
   * Dimensions this artifact participates in.
   * E.g., ["segment"] or ["segment", "image"]
   */
  dimensions: string[];

  /**
   * Maps each dimension name to its countInput.
   * E.g., { "segment": "NumOfSegments", "image": "NumOfImagesPerSegment" }
   */
  dimensionCountInputs: Record<string, string>;
}

/**
 * Decomposes a JSON schema into individual artifact definitions.
 *
 * @param schema - The parsed JSON schema
 * @param artifactName - The parent artifact name (e.g., "VideoScript")
 * @param arrayMappings - Mappings from array paths to countInput names
 * @returns Array of decomposed artifacts
 */
export function decomposeJsonSchema(
  schema: JsonSchemaDefinition,
  artifactName: string,
  arrayMappings: ArrayDimensionMapping[],
): DecomposedArtifact[] {
  const artifacts: DecomposedArtifact[] = [];
  const arrayMap = new Map(arrayMappings.map((m) => [m.path, m.countInput]));

  function walk(
    pathSegments: string[],
    jsonPathSegments: string[],
    barePath: string[], // Path without dimension placeholders for arrayMap lookup
    prop: JsonSchemaProperty,
    dimensions: string[],
    dimCountInputs: Record<string, string>,
  ): void {
    if (prop.type === 'object' && prop.properties) {
      // Object type - descend into properties
      for (const [key, childProp] of Object.entries(prop.properties)) {
        walk(
          [...pathSegments, key],
          [...jsonPathSegments, key],
          [...barePath, key],
          childProp,
          dimensions,
          dimCountInputs,
        );
      }
    } else if (prop.type === 'array' && prop.items) {
      // Array type - check if it has dimension mapping
      const currentBarePath = barePath.join('.');
      const countInput = arrayMap.get(currentBarePath);

      if (!countInput) {
        // No dimension mapping - skip this array (not decomposed)
        return;
      }

      // Derive dimension name from countInput
      const dimName = deriveDimensionName(countInput);
      const newDimensions = [...dimensions, dimName];
      const newDimCountInputs = { ...dimCountInputs, [dimName]: countInput };

      // Add dimension placeholder to path
      const newPathSegments = pathSegments.length > 0
        ? [...pathSegments.slice(0, -1), `${pathSegments[pathSegments.length - 1]}[${dimName}]`]
        : [`[${dimName}]`];
      const newJsonPathSegments = jsonPathSegments.length > 0
        ? [...jsonPathSegments.slice(0, -1), `${jsonPathSegments[jsonPathSegments.length - 1]}[${dimName}]`]
        : [`[${dimName}]`];

      // Continue into array items
      if (prop.items.type === 'object' && prop.items.properties) {
        for (const [key, childProp] of Object.entries(prop.items.properties)) {
          walk(
            [...newPathSegments, key],
            [...newJsonPathSegments, key],
            [...barePath, key], // barePath continues without dimension placeholders
            childProp,
            newDimensions,
            newDimCountInputs,
          );
        }
      } else if (isLeafType(prop.items.type)) {
        // Array of primitives
        const path = `${artifactName}.${newPathSegments.join('.')}`;
        const jsonPath = newJsonPathSegments.join('.');
        artifacts.push({
          path,
          jsonPath,
          type: prop.items.type as DecomposedArtifact['type'],
          dimensions: newDimensions,
          dimensionCountInputs: newDimCountInputs,
        });
      }
    } else if (isLeafType(prop.type)) {
      // Leaf property (string, number, boolean)
      const path = pathSegments.length > 0
        ? `${artifactName}.${pathSegments.join('.')}`
        : artifactName;
      const jsonPath = jsonPathSegments.join('.');
      artifacts.push({
        path,
        jsonPath,
        type: prop.type as DecomposedArtifact['type'],
        dimensions: [...dimensions],
        dimensionCountInputs: { ...dimCountInputs },
      });
    }
  }

  // Start walking from the root schema
  if (schema.schema.type === 'object' && schema.schema.properties) {
    for (const [key, prop] of Object.entries(schema.schema.properties)) {
      walk([key], [key], [key], prop, [], {});
    }
  }

  return artifacts;
}

/**
 * Checks if a type is a leaf type (can be stored as a separate artifact).
 */
function isLeafType(type: string): type is 'string' | 'number' | 'integer' | 'boolean' {
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean';
}

/**
 * Derives a dimension name from a countInput name.
 *
 * Examples:
 * - "NumOfSegments" -> "segment"
 * - "SegmentCount" -> "segment"
 * - "NumOfImagesPerSegment" -> "image"
 */
export function deriveDimensionName(countInput: string): string {
  let name = countInput;

  // Remove common prefixes
  const prefixes = ['NumOf', 'NumberOf', 'CountOf', 'Num'];
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // Remove common suffixes
  const suffixes = ['Count', 'Number', 'Num'];
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }

  // Remove "Per<X>" suffix (e.g., "ImagesPerSegment" -> "Images")
  const perMatch = name.match(/^(.+)Per\w+$/);
  if (perMatch) {
    name = perMatch[1]!;
  }

  // Convert to lowercase and singularize if plural
  name = name.toLowerCase();
  if (name.endsWith('s') && name.length > 1) {
    name = name.slice(0, -1);
  }

  return name || 'item';
}
