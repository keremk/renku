/**
 * Utility functions for config property handling.
 */

import type { ConfigProperty } from "@/types/blueprint-graph";

/** Types that we can't render with simple inputs */
const COMPLEX_TYPES = ["object", "array"];

/**
 * Checks if a property has a complex type that needs a specialized editor.
 */
export function isComplexProperty(property: ConfigProperty): boolean {
  const schemaType = property.schema.type;
  return schemaType !== undefined && COMPLEX_TYPES.includes(schemaType);
}
