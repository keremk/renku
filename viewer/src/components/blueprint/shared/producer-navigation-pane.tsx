import { useMemo, type ReactNode } from 'react';
import { getProducerDisplayParts } from '@/lib/panel-utils';
import { cn } from '@/lib/utils';
import type { BlueprintGraphData, BlueprintGraphNode } from '@/types/blueprint-graph';

interface ProducerNavigationPaneProps {
  producerIds: string[];
  graphData?: BlueprintGraphData;
  activeProducerId: string | null;
  onSelectProducer: (producerId: string) => void;
  renderProducerActions?: (producerId: string) => ReactNode;
  className?: string;
  title?: string;
}

type ProducerListItem =
  | {
      type: 'producer';
      key: string;
      producerId: string;
      leafLabel: string;
    }
  | {
      type: 'group';
      key: string;
      groupKey: string;
      groupLabel: string;
      producers: Array<{
        producerId: string;
        leafLabel: string;
      }>;
    };

interface ProducerNavigationEntry {
  producerId: string;
  groupKey: string | null;
  groupLabel: string | null;
  leafLabel: string;
}

function formatLabel(label: string): string {
  return getProducerDisplayParts(label).leafLabel;
}

function buildProducerNavigationEntry(
  producerId: string,
  producerNode: BlueprintGraphNode | undefined
): ProducerNavigationEntry {
  if (!producerNode) {
    const displayParts = getProducerDisplayParts(producerId);
    return {
      producerId,
      groupKey: displayParts.groupKey,
      groupLabel: displayParts.groupLabel,
      leafLabel: displayParts.leafLabel,
    };
  }

  const groupPath =
    producerNode.compositePath ??
    (producerNode.namespacePath && producerNode.namespacePath.length > 1
      ? producerNode.namespacePath.slice(0, -1)
      : undefined);
  const groupName =
    producerNode.compositeName ??
    (groupPath && groupPath.length > 0
      ? groupPath[groupPath.length - 1]
      : undefined);

  return {
    producerId,
    groupKey: groupPath && groupPath.length > 0 ? groupPath.join('\u0000') : null,
    groupLabel: groupName ? formatLabel(groupName) : null,
    leafLabel: formatLabel(producerNode.label),
  };
}

function buildProducerListItems(
  producerIds: string[],
  graphData?: BlueprintGraphData
): ProducerListItem[] {
  const producerNodeById = new Map(
    (graphData?.nodes ?? [])
      .filter((node) => node.type === 'producer')
      .map((node) => [node.id, node])
  );
  const producerEntries = producerIds.map((producerId) =>
    buildProducerNavigationEntry(producerId, producerNodeById.get(producerId))
  );
  const items: ProducerListItem[] = [];
  const emittedGroupKeys = new Set<string>();

  for (const entry of producerEntries) {
    if (!entry.groupKey || !entry.groupLabel) {
      items.push({
        type: 'producer',
        key: entry.producerId,
        producerId: entry.producerId,
        leafLabel: entry.leafLabel,
      });
      continue;
    }

    if (emittedGroupKeys.has(entry.groupKey)) {
      continue;
    }

    emittedGroupKeys.add(entry.groupKey);

    items.push({
      type: 'group',
      key: entry.groupKey,
      groupKey: entry.groupKey,
      groupLabel: entry.groupLabel,
      producers: producerEntries
        .filter((candidate) => candidate.groupKey === entry.groupKey)
        .map((candidate) => ({
          producerId: candidate.producerId,
          leafLabel: candidate.leafLabel,
        })),
    });
  }

  return items;
}

export function ProducerNavigationPane({
  producerIds,
  graphData,
  activeProducerId,
  onSelectProducer,
  renderProducerActions,
  className,
  title = 'Producers',
}: ProducerNavigationPaneProps) {
  const items = useMemo(
    () => buildProducerListItems(producerIds, graphData),
    [producerIds, graphData]
  );

  return (
    <aside
      className={cn(
        'w-76 shrink-0 rounded-xl border border-border/40 bg-muted/40 overflow-hidden flex flex-col',
        className
      )}
    >
      <div className='px-4 py-3 border-b border-border/40 bg-panel-header-bg'>
        <h3 className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
          {title}
        </h3>
      </div>

      <div className='flex-1 overflow-y-auto p-2'>
        <div className='space-y-1.5'>
          {items.map((item) => {
            if (item.type === 'producer') {
              return (
                <ProducerNavigationRow
                  key={item.producerId}
                  producerId={item.producerId}
                  label={item.leafLabel}
                  isActive={activeProducerId === item.producerId}
                  onSelect={onSelectProducer}
                  actions={renderProducerActions?.(item.producerId)}
                />
              );
            }

            return (
              <div
                key={item.key}
                className='rounded-xl border border-border/50 bg-background/40 p-2'
              >
                <div className='px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
                  {item.groupLabel}
                </div>
                <div className='space-y-1'>
                  {item.producers.map((producer) => (
                    <ProducerNavigationRow
                      key={producer.producerId}
                      producerId={producer.producerId}
                      label={producer.leafLabel}
                      isActive={activeProducerId === producer.producerId}
                      onSelect={onSelectProducer}
                      actions={renderProducerActions?.(producer.producerId)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function ProducerNavigationRow({
  producerId,
  label,
  isActive,
  onSelect,
  actions,
}: {
  producerId: string;
  label: string;
  isActive: boolean;
  onSelect: (producerId: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'group flex h-12 items-center gap-2 rounded-lg border px-2.5 py-0 transition-colors',
        isActive
          ? 'bg-item-active-bg border-item-active-border'
          : 'bg-background/30 border-transparent hover:bg-item-hover-bg hover:border-border/50'
      )}
    >
      <button
        type='button'
        onClick={() => onSelect(producerId)}
        aria-label={`Select producer ${producerId}`}
        aria-current={isActive ? 'true' : undefined}
        className='min-w-0 flex-1 self-stretch text-left'
      >
        <span className='flex h-full items-center truncate text-sm font-medium text-foreground'>
          {label}
        </span>
      </button>

      {actions && (
        <div className='flex w-23 shrink-0 items-center justify-end gap-1'>
          {actions}
        </div>
      )}
    </div>
  );
}
