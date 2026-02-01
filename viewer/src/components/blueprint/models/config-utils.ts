/**
 * Utility functions for config property handling.
 */

import type { ConfigProperty } from "@/types/blueprint-graph";

/** Types that we can't render with simple inputs */
const COMPLEX_TYPES = ["object", "array"];

/**
 * Checks if a property has a complex type that needs a specialized editor.
 * Properties are considered complex if they:
 * - Have type "object" or "array"
 * - Have a $ref (reference to another schema definition)
 */
export function isComplexProperty(property: ConfigProperty): boolean {
  const schema = property.schema;

  // Check for $ref - these reference other schema definitions (usually objects)
  if (schema.$ref) {
    return true;
  }

  // Check for explicit complex types
  const schemaType = schema.type;
  return schemaType !== undefined && COMPLEX_TYPES.includes(schemaType);
}
