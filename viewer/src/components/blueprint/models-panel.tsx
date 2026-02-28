import { useState, useCallback, useMemo } from 'react';
import { EnableEditingBanner } from './shared';
import { ProducerSection } from './models/producer-section';
import { hasRegisteredEditor } from './models/config-editors';
import { isComplexProperty } from './models/config-utils';
import { formatProducerDisplayName } from '@/lib/panel-utils';
import { cn } from '@/lib/utils';
import type {
  ModelSelectionValue,
  ProducerModelInfo,
  ProducerConfigSchemas,
  PromptData,
  ConfigProperty,
} from '@/types/blueprint-graph';

interface ModelsPanelProps {
  /** Available models per producer from API */
  producerModels: Record<string, ProducerModelInfo>;
  /** Current model selections (from hook, includes edits) */
  modelSelections: ModelSelectionValue[];
  /** Currently selected node ID for highlighting */
  selectedNodeId: string | null;
  /** Whether models are editable (requires buildId) */
  isEditable?: boolean;
  /** Whether editing can be enabled for this build */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
  /** Callback when a model selection changes (auto-save handled by parent hook) */
  onSelectionChange?: (selection: ModelSelectionValue) => void;
  /** Whether to hide the header */
  hideHeader?: boolean;
  /** Prompt data per producer (for prompt producers) */
  promptDataByProducer?: Record<string, PromptData>;
  /** Callback when prompts change (immediate save) */
  onPromptChange?: (
    producerId: string,
    prompts: PromptData
  ) => void | Promise<void>;
  /** Config properties per producer */
  configPropertiesByProducer?: Record<string, ConfigProperty[]>;
  /** Config values per producer */
  configValuesByProducer?: Record<string, Record<string, unknown>>;
  /** Callback when config changes */
  onConfigChange?: (producerId: string, key: string, value: unknown) => void;
  /** Config schemas per producer (for nested model detection) */
  configSchemasByProducer?: Record<string, ProducerConfigSchemas>;
}

export function ModelsPanel({
  producerModels,
  modelSelections,
  selectedNodeId,
  isEditable = false,
  canEnableEditing = false,
  onEnableEditing,
  onSelectionChange,
  hideHeader: _hideHeader = false,
  promptDataByProducer = {},
  onPromptChange,
  configPropertiesByProducer = {},
  configValuesByProducer = {},
  onConfigChange,
  configSchemasByProducer = {},
}: ModelsPanelProps) {
  const [isEnabling, setIsEnabling] = useState(false);

  // Handle enable editing
  const handleEnableEditing = useCallback(async () => {
    if (!onEnableEditing) return;
    setIsEnabling(true);
    try {
      await onEnableEditing();
    } finally {
      setIsEnabling(false);
    }
  }, [onEnableEditing]);

  // Create a map of current selections by producerId
  const selectionMap = useMemo(() => {
    const map = new Map<string, ModelSelectionValue>();
    for (const selection of modelSelections) {
      map.set(selection.producerId, selection);
    }
    return map;
  }, [modelSelections]);

  // Get the current selection for a producer
  const getSelection = useCallback(
    (producerId: string): ModelSelectionValue | undefined => {
      return selectionMap.get(producerId);
    },
    [selectionMap]
  );

  // Handle selection change - delegate to parent (auto-save handled by parent hook)
  const handleSelectionChange = useCallback(
    (selection: ModelSelectionValue) => {
      onSelectionChange?.(selection);
    },
    [onSelectionChange]
  );

  // Determine which producer is selected based on node ID
  const selectedProducerId = selectedNodeId?.startsWith('Producer:')
    ? selectedNodeId.replace('Producer:', '')
    : null;

  // Get list of producer IDs, filtering out producers with only unhandled complex properties
  const producerIds = useMemo(() => {
    return Object.keys(producerModels).filter((producerId) => {
      const info = producerModels[producerId];
      const configProps = configPropertiesByProducer[producerId] ?? [];

      // Prompt producers always show (they have prompts)
      if (info.category === 'prompt') return true;

      // Asset producers always show (they need the model selector dropdown)
      if (info.category === 'asset') return true;

      // Check if producer has displayable config
      const hasDisplayableConfig = configProps.some((prop) => {
        // Primitive types are always displayable
        if (!isComplexProperty(prop)) {
          return true;
        }
        // Complex types are displayable if we have a registered editor
        return hasRegisteredEditor(prop.key);
      });

      // Check if producer has ONLY unhandled complex properties (no displayable content)
      const hasOnlyUnhandledComplex =
        configProps.length > 0 && !hasDisplayableConfig;

      // Hide producers that have ONLY unhandled complex properties
      if (hasOnlyUnhandledComplex) return false;

      // Composition producers: show only if they have displayable config
      // (no model selection needed, so nothing to show if no config)
      if (info.category === 'composition') {
        return hasDisplayableConfig;
      }

      // Default: show if has displayable config
      return hasDisplayableConfig;
    });
  }, [producerModels, configPropertiesByProducer]);

  const [manualActiveProducerId, setManualActiveProducerId] = useState<
    string | null
  >(null);

  const activeProducerId = useMemo(() => {
    if (
      manualActiveProducerId &&
      producerIds.includes(manualActiveProducerId)
    ) {
      return manualActiveProducerId;
    }

    if (selectedProducerId && producerIds.includes(selectedProducerId)) {
      return selectedProducerId;
    }

    return producerIds[0] ?? null;
  }, [producerIds, selectedProducerId, manualActiveProducerId]);

  const activeProducerInfo =
    activeProducerId !== null ? producerModels[activeProducerId] : undefined;

  if (producerIds.length === 0) {
    return (
      <div className='text-muted-foreground text-sm'>
        No producers with configurable models in this blueprint.
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      {canEnableEditing && !isEditable && (
        <EnableEditingBanner
          isEnabling={isEnabling}
          onEnableEditing={handleEnableEditing}
        />
      )}

      <div className='flex-1 min-h-0 flex gap-4'>
        <aside className='w-72 shrink-0 bg-muted/40 rounded-xl border border-border/40 overflow-hidden flex flex-col'>
          <div className='px-4 py-3 border-b border-border/40 bg-panel-header-bg'>
            <h3 className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
              Producers
            </h3>
          </div>

          <div className='flex-1 overflow-y-auto p-2'>
            <div className='space-y-1.5'>
              {producerIds.map((producerId) => {
                const isActive = activeProducerId === producerId;

                return (
                  <button
                    key={producerId}
                    type='button'
                    onClick={() => setManualActiveProducerId(producerId)}
                    aria-label={`Select producer ${producerId}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'group flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-colors',
                      isActive
                        ? 'bg-item-active-bg border-item-active-border'
                        : 'bg-background/30 border-transparent hover:bg-item-hover-bg hover:border-border/50'
                    )}
                  >
                    <span className='min-w-0 flex-1 text-sm font-medium text-foreground truncate'>
                      {formatProducerDisplayName(producerId)}
                    </span>

                    <span
                      className='flex items-center gap-1 opacity-0'
                      aria-hidden='true'
                    >
                      <span className='size-7 inline-flex rounded-md' />
                      <span className='size-7 inline-flex rounded-md' />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <section className='min-w-0 flex-1 bg-muted/40 rounded-xl border border-border/40 overflow-hidden flex flex-col'>
          {activeProducerId && activeProducerInfo ? (
            <>
              <div className='px-4 py-3 border-b border-border/40 bg-panel-header-bg'>
                <h3 className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                  {formatProducerDisplayName(activeProducerId)}
                </h3>
              </div>

              <div className='flex-1 overflow-y-auto p-4'>
                <ProducerSection
                  producerId={activeProducerId}
                  producerType={activeProducerInfo.producerType}
                  description={activeProducerInfo.description}
                  category={activeProducerInfo.category}
                  availableModels={activeProducerInfo.availableModels}
                  currentSelection={getSelection(activeProducerId)}
                  isSelected={selectedProducerId === activeProducerId}
                  isEditable={isEditable}
                  onModelChange={handleSelectionChange}
                  promptData={promptDataByProducer[activeProducerId]}
                  onPromptChange={
                    onPromptChange
                      ? (prompts) => onPromptChange(activeProducerId, prompts)
                      : undefined
                  }
                  configProperties={
                    configPropertiesByProducer[activeProducerId]
                  }
                  configValues={configValuesByProducer[activeProducerId]}
                  onConfigChange={
                    onConfigChange
                      ? (key, value) =>
                          onConfigChange(activeProducerId, key, value)
                      : undefined
                  }
                  nestedModelSchemas={
                    configSchemasByProducer[activeProducerId]?.nestedModels
                  }
                  hideSectionContainer
                />
              </div>
            </>
          ) : (
            <div className='h-full min-h-[220px] flex items-center justify-center text-sm text-muted-foreground'>
              Select a producer to view model settings.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
