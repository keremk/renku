/**
 * Converts a kebab-case blueprint name to title case.
 * Example: "my-first-blueprint" -> "My First Blueprint"
 */
export function prettifyBlueprintName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
