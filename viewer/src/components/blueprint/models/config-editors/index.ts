/**
 * Config Property Editor Registry
 *
 * Maps complex object properties to specialized UI components.
 * This avoids hardcoding producer names and enables:
 * - Rendering specialized editors for any producer with a matching config property
 * - Hiding producers that only have complex properties with no registered editor
 */

import type { ComponentType } from 'react';
import { SubtitlesCard, type SubtitlesCardProps } from './subtitles-card';
import { TimelineCard, type TimelineCardProps } from './timeline-card';
import { TextCard, type TextCardProps } from './text-card';
import type { SchemaProperty } from '@/types/blueprint-graph';

/**
 * Props that all config editor components receive.
 */
export interface ConfigEditorProps<T = unknown> {
  /** Current value of the config property */
  value: T | undefined;
  /** JSON schema for this config property */
  schema?: SchemaProperty;
  /** Whether editing is enabled */
  isEditable?: boolean;
  /** Whether this card is selected/highlighted */
  isSelected?: boolean;
  /** Callback when value changes */
  onChange?: (value: T) => void;
}

/**
 * Registry of specialized editors for object-type config properties.
 * Keyed by property name (e.g., "subtitles", "timeline", etc.)
 */
export const CONFIG_EDITOR_REGISTRY: Record<
  string,
  ComponentType<ConfigEditorProps<unknown>>
> = {
  subtitles: SubtitlesCard as ComponentType<ConfigEditorProps<unknown>>,
  timeline: TimelineCard as ComponentType<ConfigEditorProps<unknown>>,
  text: TextCard as ComponentType<ConfigEditorProps<unknown>>,
};

/**
 * Check if a property has a registered editor.
 */
export function hasRegisteredEditor(propertyKey: string): boolean {
  return propertyKey in CONFIG_EDITOR_REGISTRY;
}

/**
 * Get editor component for a property.
 */
export function getEditorComponent(
  propertyKey: string
): ComponentType<ConfigEditorProps<unknown>> | null {
  return CONFIG_EDITOR_REGISTRY[propertyKey] ?? null;
}

// Re-export types for convenience
export type { SubtitlesCardProps, TimelineCardProps, TextCardProps };
