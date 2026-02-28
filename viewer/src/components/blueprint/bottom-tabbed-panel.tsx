/**
 * Bottom tabbed panel containing Blueprint flow, Execution progress, and Timeline views.
 * Handles tab switching and renders the appropriate content.
 */

import { ReactFlowProvider } from '@xyflow/react';
import { BlueprintViewer } from './blueprint-viewer';
import { ExecutionProgressPanel } from './execution-progress-panel';
import { BlueprintLegend } from './blueprint-legend';
import { TimelinePanel } from './timeline-panel';
import type { BottomPanelTab } from '@/hooks';
import type { BlueprintGraphData } from '@/types/blueprint-graph';
import type { ExecutionLogEntry, ProducerStatusMap } from '@/types/generation';
import type { TimelineDocument } from '@/types/timeline';

type TimelineStatus = 'idle' | 'loading' | 'success' | 'error';

interface BottomTabbedPanelProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  isExecuting: boolean;
  hasLogs: boolean;
  // Blueprint panel props
  graphData: BlueprintGraphData;
  onNodeSelect: (nodeId: string | null) => void;
  producerStatuses: ProducerStatusMap;
  // Execution panel props
  executionLogs: ExecutionLogEntry[];
  // Timeline panel props
  timeline: TimelineDocument | null;
  timelineStatus: TimelineStatus;
  timelineError: Error | null;
  blueprintFolder: string | null;
  currentTime: number;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  hasTimeline: boolean;
  movieId: string | null;
}

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  indicator?: 'executing' | 'has-logs';
}

function TabButton({ label, isActive, onClick, indicator }: TabButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`
        relative flex items-center gap-2 px-4 h-full text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors
        ${
          isActive
            ? 'text-foreground bg-item-active-bg'
            : 'text-muted-foreground hover:text-foreground hover:bg-item-hover-bg'
        }
      `}
    >
      {label}
      {indicator === 'executing' && (
        <span className='flex h-2 w-2'>
          <span className='animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75' />
          <span className='relative inline-flex rounded-full h-2 w-2 bg-blue-500' />
        </span>
      )}
      {indicator === 'has-logs' && (
        <span className='w-2 h-2 rounded-full bg-muted-foreground/50' />
      )}
      {isActive && (
        <div className='absolute bottom-0 left-0 right-0 h-[2px] bg-primary' />
      )}
    </button>
  );
}

interface TabHeaderProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  isExecuting: boolean;
  hasLogs: boolean;
  hasTimeline: boolean;
}

function TabHeader({
  activeTab,
  onTabChange,
  isExecuting,
  hasLogs,
  hasTimeline,
}: TabHeaderProps) {
  return (
    <div className='flex items-center h-[45px] border-b border-border/40 bg-sidebar-header-bg shrink-0'>
      <TabButton
        label='Blueprint'
        isActive={activeTab === 'blueprint'}
        onClick={() => onTabChange('blueprint')}
      />
      <TabButton
        label='Execution'
        isActive={activeTab === 'execution'}
        onClick={() => onTabChange('execution')}
        indicator={isExecuting ? 'executing' : hasLogs ? 'has-logs' : undefined}
      />
      <TabButton
        label='Timeline'
        isActive={activeTab === 'timeline'}
        onClick={() => onTabChange('timeline')}
        indicator={hasTimeline ? 'has-logs' : undefined}
      />
    </div>
  );
}

export function BottomTabbedPanel({
  activeTab,
  onTabChange,
  isExecuting,
  hasLogs,
  graphData,
  onNodeSelect,
  producerStatuses,
  executionLogs,
  timeline,
  timelineStatus,
  timelineError,
  blueprintFolder,
  currentTime,
  isPlaying,
  onPlay,
  onPause,
  onSeek,
  hasTimeline,
  movieId,
}: BottomTabbedPanelProps) {
  return (
    <div className='flex-1 min-h-0 flex flex-col'>
      {/* Tab Header */}
      <TabHeader
        activeTab={activeTab}
        onTabChange={onTabChange}
        isExecuting={isExecuting}
        hasLogs={hasLogs}
        hasTimeline={hasTimeline}
      />

      {/* Tab Content */}
      <div className='flex-1 min-h-0 relative'>
        {activeTab === 'blueprint' && (
          <ReactFlowProvider>
            <BlueprintViewer
              graphData={graphData}
              onNodeSelect={onNodeSelect}
              producerStatuses={producerStatuses}
            />
          </ReactFlowProvider>
        )}
        {activeTab === 'execution' && (
          <ExecutionProgressPanel
            logs={executionLogs}
            isExecuting={isExecuting}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelinePanel
            timeline={timeline}
            status={timelineStatus}
            error={timelineError}
            blueprintFolder={blueprintFolder}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onPlay={onPlay}
            onPause={onPause}
            onSeek={onSeek}
            hasTimeline={hasTimeline}
            movieId={movieId}
          />
        )}
      </div>

      {/* Legend (only for blueprint tab) */}
      {activeTab === 'blueprint' && <BlueprintLegend />}
    </div>
  );
}
