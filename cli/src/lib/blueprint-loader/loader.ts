import { resolve } from 'node:path';
import type { BlueprintTreeNode } from '@gorenku/core';
import { loadYamlBlueprintTree } from '@gorenku/core';

export interface BlueprintBundle {
  root: BlueprintTreeNode;
}

export async function loadBlueprintBundle(entryPath: string): Promise<BlueprintBundle> {
  const absolute = resolve(entryPath);
  return loadYamlBlueprintTree(absolute);
}
