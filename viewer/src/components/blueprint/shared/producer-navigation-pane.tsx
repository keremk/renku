import { useMemo, type ReactNode } from 'react';
import { getProducerDisplayParts } from '@/lib/panel-utils';
import { cn } from '@/lib/utils';

interface ProducerNavigationPaneProps {
  producerIds: string[];
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

function buildProducerListItems(producerIds: string[]): ProducerListItem[] {
  const producerEntries = producerIds.map((producerId) => ({
    producerId,
    ...getProducerDisplayParts(producerId),
  }));
  const items: ProducerListItem[] = [];
  let index = 0;

  while (index < producerEntries.length) {
    const entry = producerEntries[index];
    if (!entry.groupKey || !entry.groupLabel) {
      items.push({
        type: 'producer',
        key: entry.producerId,
        producerId: entry.producerId,
        leafLabel: entry.leafLabel,
      });
      index += 1;
      continue;
    }

    const groupProducers = [];
    let runLength = 0;

    while (index + runLength < producerEntries.length) {
      const candidate = producerEntries[index + runLength];
      if (candidate.groupKey !== entry.groupKey) {
        break;
      }

      groupProducers.push({
        producerId: candidate.producerId,
        leafLabel: candidate.leafLabel,
      });
      runLength += 1;
    }

    items.push({
      type: 'group',
      key: `${entry.groupKey}:${index}`,
      groupKey: entry.groupKey,
      groupLabel: entry.groupLabel,
      producers: groupProducers,
    });

    index += runLength;
  }

  return items;
}

export function ProducerNavigationPane({
  producerIds,
  activeProducerId,
  onSelectProducer,
  renderProducerActions,
  className,
  title = 'Producers',
}: ProducerNavigationPaneProps) {
  const items = useMemo(() => buildProducerListItems(producerIds), [producerIds]);

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

      <div className='flex w-23 shrink-0 items-center justify-end gap-1'>
        {actions}
      </div>
    </div>
  );
}
