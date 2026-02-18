/**
 * Terminal-like execution progress panel.
 * Displays log entries from the execution process with auto-scroll.
 */

import { useEffect, useRef } from 'react';
import type { ExecutionLogEntry } from '@/types/generation';

interface ExecutionProgressPanelProps {
  logs: ExecutionLogEntry[];
  isExecuting: boolean;
}

/**
 * Get the CSS class for a log entry based on its type.
 */
function getLogEntryClass(entry: ExecutionLogEntry): string {
  switch (entry.type) {
    case 'layer-start':
    case 'layer-complete':
      return 'text-blue-400';
    case 'layer-skipped':
      return 'text-amber-400';
    case 'job-start':
      return 'text-muted-foreground';
    case 'job-complete':
      if (entry.status === 'succeeded') {
        return 'text-emerald-400';
      } else if (entry.status === 'failed') {
        return 'text-red-400';
      } else {
        return 'text-yellow-400';
      }
    case 'error':
      return 'text-red-400';
    case 'info':
      return 'text-foreground';
    default:
      return 'text-muted-foreground';
  }
}

/**
 * Format timestamp for display.
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ExecutionProgressPanel({
  logs,
  isExecuting,
}: ExecutionProgressPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (shouldAutoScrollRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Detect manual scrolling to pause auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } =
      scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    shouldAutoScrollRef.current = isAtBottom;
  };

  return (
    <div className='absolute inset-0 flex flex-col bg-card/30 font-mono text-xs'>
      {/* Log entries */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className='flex-1 overflow-y-auto p-3 space-y-0.5'
      >
        {logs.length === 0 ? (
          <div className='text-muted-foreground/50 italic'>
            {isExecuting
              ? 'Waiting for execution events...'
              : 'No execution logs yet'}
          </div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className='flex flex-col gap-0.5'>
              <div className='flex gap-2'>
                <span className='text-muted-foreground/50 shrink-0'>
                  [{formatTimestamp(entry.timestamp)}]
                </span>
                <span className={getLogEntryClass(entry)}>{entry.message}</span>
              </div>
              {entry.errorDetails && (
                <div className='ml-[88px]'>
                  <span className='text-red-400/80 text-[10px]'>
                    Error: {entry.errorDetails}
                  </span>
                </div>
              )}
            </div>
          ))
        )}

        {/* Executing indicator */}
        {isExecuting && logs.length > 0 && (
          <div className='flex gap-2 animate-pulse'>
            <span className='text-muted-foreground/50 shrink-0'>
              [{formatTimestamp(new Date().toISOString())}]
            </span>
            <span className='text-muted-foreground'>
              <span className='inline-block animate-bounce'>.</span>
              <span
                className='inline-block animate-bounce'
                style={{ animationDelay: '0.1s' }}
              >
                .
              </span>
              <span
                className='inline-block animate-bounce'
                style={{ animationDelay: '0.2s' }}
              >
                .
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
