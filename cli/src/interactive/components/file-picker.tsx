import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, resolve } from 'node:path';
import type { FormFieldConfig } from '../utils/schema-to-fields.js';

/**
 * Represents an entry in the file list (file or directory).
 */
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Props for the FilePicker component.
 */
export interface FilePickerProps {
  /** Field configuration */
  field: FormFieldConfig;
  /** Current value (file path or array of file paths) */
  value: string | string[] | undefined;
  /** Callback when value changes */
  onChange: (value: string | string[]) => void;
  /** Whether this field is focused */
  isFocused: boolean;
  /** Base path for navigation (defaults to cwd) */
  basePath?: string;
}

/**
 * Maximum number of items to display at once.
 */
const MAX_VISIBLE_ITEMS = 8;

/**
 * Load directory entries, filtered by allowed extensions.
 */
function loadDirectory(
  dirPath: string,
  extensions?: string[]
): FileEntry[] {
  try {
    const entries = readdirSync(dirPath)
      .filter((name) => !name.startsWith('.')) // Hide hidden files
      .map((name) => {
        const fullPath = join(dirPath, name);
        try {
          const stats = statSync(fullPath);
          return {
            name,
            path: fullPath,
            isDirectory: stats.isDirectory(),
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is FileEntry => entry !== null);

    // Sort: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    // Add parent directory entry if not at root
    const parentDir = dirname(dirPath);
    if (parentDir !== dirPath) {
      entries.unshift({
        name: '..',
        path: parentDir,
        isDirectory: true,
      });
    }

    // Filter files by extension (keep directories)
    if (extensions && extensions.length > 0) {
      return entries.filter((entry) => {
        if (entry.isDirectory) {
          return true;
        }
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
        return extensions.includes(ext);
      });
    }

    return entries;
  } catch {
    // Return empty list if directory can't be read
    return [];
  }
}

/**
 * FilePicker component for single or multiple file selection.
 * Supports directory navigation with keyboard controls.
 */
export const FilePicker: React.FC<FilePickerProps> = ({
  field,
  value,
  onChange,
  isFocused,
  basePath = process.cwd(),
}) => {
  const isMultiple = field.type === 'file-collection';

  // Current directory being browsed
  const [currentDir, setCurrentDir] = useState(() => resolve(basePath));

  // Highlighted index in the file list
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Scroll offset for displaying items
  const [scrollOffset, setScrollOffset] = useState(0);

  // Selected files (for multiple selection mode)
  const selectedFiles = useMemo<Set<string>>(() => {
    if (!value) {
      return new Set();
    }
    if (Array.isArray(value)) {
      return new Set(value);
    }
    return new Set([value]);
  }, [value]);

  // Load directory contents
  const entries = useMemo(
    () => loadDirectory(currentDir, field.fileExtensions),
    [currentDir, field.fileExtensions]
  );

  // Reset highlight when directory changes
  useEffect(() => {
    setHighlightIndex(0);
    setScrollOffset(0);
  }, [currentDir]);

  // Calculate visible window
  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE_ITEMS, entries.length);
  const visibleEntries = entries.slice(visibleStart, visibleEnd);

  // Update scroll when highlight moves out of view
  const updateScroll = useCallback((newIndex: number) => {
    if (newIndex < scrollOffset) {
      setScrollOffset(newIndex);
    } else if (newIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
      setScrollOffset(newIndex - MAX_VISIBLE_ITEMS + 1);
    }
  }, [scrollOffset]);

  // Handle keyboard input
  useInput(
    (input, key) => {
      if (!isFocused) {
        return;
      }

      if (key.upArrow) {
        const newIndex = Math.max(0, highlightIndex - 1);
        setHighlightIndex(newIndex);
        updateScroll(newIndex);
      } else if (key.downArrow) {
        const newIndex = Math.min(entries.length - 1, highlightIndex + 1);
        setHighlightIndex(newIndex);
        updateScroll(newIndex);
      } else if (key.return) {
        const entry = entries[highlightIndex];
        if (!entry) {
          return;
        }

        if (entry.isDirectory) {
          // Navigate into directory
          setCurrentDir(entry.path);
        } else if (!isMultiple) {
          // Single file selection - select and done
          const relativePath = relative(basePath, entry.path);
          onChange(relativePath);
        }
      } else if (input === ' ' && isMultiple) {
        // Toggle selection in multiple mode
        const entry = entries[highlightIndex];
        if (!entry || entry.isDirectory) {
          return;
        }

        const relativePath = relative(basePath, entry.path);
        const newSelection = new Set(selectedFiles);
        if (newSelection.has(relativePath)) {
          newSelection.delete(relativePath);
        } else {
          newSelection.add(relativePath);
        }
        onChange(Array.from(newSelection));
      } else if (key.escape) {
        // Go to parent directory
        const parentDir = dirname(currentDir);
        if (parentDir !== currentDir) {
          setCurrentDir(parentDir);
        }
      }
    },
    { isActive: isFocused }
  );

  // Format the relative path for display
  const displayPath = relative(basePath, currentDir) || '.';

  // Collapsed view when not focused
  if (!isFocused) {
    const displayValue = formatDisplayValue(value, field);
    return (
      <Box>
        <Text bold>
          {field.label}
          {field.required && <Text color="red">*</Text>}:{' '}
        </Text>
        <Text color="gray">{displayValue || '(not selected)'}</Text>
      </Box>
    );
  }

  // Expanded view when focused
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text bold color="cyan">
        {field.label}
        {field.required && <Text color="red">*</Text>}
        <Text dimColor> ({field.blobType} file{isMultiple ? 's' : ''})</Text>
      </Text>
      {field.description && <Text dimColor>  {field.description}</Text>}

      {/* Current path */}
      <Box marginTop={1}>
        <Text dimColor>Location: </Text>
        <Text color="blue">{displayPath}/</Text>
      </Box>

      {/* File list */}
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {entries.length === 0 ? (
          <Text dimColor>  (no matching files)</Text>
        ) : (
          <>
            {/* Scroll indicator at top */}
            {scrollOffset > 0 && (
              <Text dimColor>  ↑ more files above...</Text>
            )}

            {/* Visible entries */}
            {visibleEntries.map((entry, visibleIdx) => {
              const actualIndex = visibleStart + visibleIdx;
              const isHighlighted = actualIndex === highlightIndex;
              const relativePath = entry.isDirectory ? '' : relative(basePath, entry.path);
              const isSelected = selectedFiles.has(relativePath);

              return (
                <FileEntryRow
                  key={entry.path}
                  entry={entry}
                  isHighlighted={isHighlighted}
                  isSelected={isSelected}
                  isMultiple={isMultiple}
                />
              );
            })}

            {/* Scroll indicator at bottom */}
            {visibleEnd < entries.length && (
              <Text dimColor>  ↓ more files below...</Text>
            )}
          </>
        )}
      </Box>

      {/* Selected files summary (for multiple selection) */}
      {isMultiple && selectedFiles.size > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Selected: </Text>
          <Text color="green">{selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''}</Text>
        </Box>
      )}

      {/* Navigation hints */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓: Navigate  Enter: {isMultiple ? 'Enter folder' : 'Select'}
          {isMultiple && '  Space: Toggle'}  Esc: Parent
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Props for a single file entry row.
 */
interface FileEntryRowProps {
  entry: FileEntry;
  isHighlighted: boolean;
  isSelected: boolean;
  isMultiple: boolean;
}

/**
 * Render a single file/directory entry.
 */
const FileEntryRow: React.FC<FileEntryRowProps> = ({
  entry,
  isHighlighted,
  isSelected,
  isMultiple,
}) => {
  const icon = entry.isDirectory ? '📁' : '📄';
  const prefix = isHighlighted ? '❯' : ' ';

  return (
    <Box>
      <Text color={isHighlighted ? 'cyan' : undefined}>
        {prefix} {icon}{' '}
        {isMultiple && !entry.isDirectory && (
          <Text color={isSelected ? 'green' : 'gray'}>
            [{isSelected ? 'x' : ' '}]{' '}
          </Text>
        )}
        <Text bold={isHighlighted} color={isSelected ? 'green' : undefined}>
          {entry.name}
        </Text>
      </Text>
    </Box>
  );
};

/**
 * Format the display value for collapsed view.
 */
function formatDisplayValue(
  value: string | string[] | undefined,
  _field: FormFieldConfig
): string {
  if (!value) {
    return '';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }
    if (value.length === 1) {
      return basename(value[0] ?? '');
    }
    return `${value.length} files selected`;
  }

  return basename(value);
}
