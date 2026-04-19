import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  ViewportPortal,
  // MiniMap,
  useNodesState,
  useEdgesState,
  type OnNodesChange,
  type NodeMouseHandler,
  type Node,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Eye, EyeOff } from 'lucide-react';

import { ProducerNode } from './nodes/producer-node';
import { ConditionalEdge } from './edges/conditional-edge';
import {
  ProducerDetailsDialog,
  type ProducerDetails,
} from './producer-details-dialog';
import {
  defaultBlueprintLayoutConfig,
  layoutBlueprintGraph,
} from '@/lib/blueprint-layout';
import { useExecution } from '@/contexts/execution-context';
import type {
  BlueprintGraphData,
  ProducerBinding,
} from '@/types/blueprint-graph';
import type {
  ProducerStatusMap,
  ProducerStatus,
  ProducerSchedulingSummary,
} from '@/types/generation';
import { useDarkMode } from '@/hooks/use-dark-mode';

const nodeTypes: NodeTypes = {
  producerNode: ProducerNode,
  fitBoundsAnchor: FitBoundsAnchor,
};

const edgeTypes: EdgeTypes = {
  conditionalEdge: ConditionalEdge,
};

function FitBoundsAnchor() {
  return <div className='size-px pointer-events-none opacity-0' />;
}

interface BlueprintViewerProps {
  graphData: BlueprintGraphData;
  blueprintName: string;
  movieId?: string | null;
  selectedUpToLayer?: number | null;
  onLayerSelect?: (layerIndex: number) => void;
  onNodeSelect?: (nodeId: string | null) => void;
  producerStatuses?: ProducerStatusMap;
}

interface ProducerNodeData {
  label: string;
  namespacePath?: string[];
  compositePath?: string[];
  compositeName?: string;
  loop?: string;
  runnable?: boolean;
  producerType?: string;
  description?: string;
  status: ProducerStatus;
  inputBindings: ProducerBinding[];
  outputBindings: ProducerBinding[];
}

function deriveProducerLayerIndexFromGraph(
  graphData: BlueprintGraphData,
  producerId: string
): number {
  if (!graphData.layerAssignments) {
    throw new Error(
      'Missing layer assignments in blueprint graph; cannot resolve producer scheduling layer.'
    );
  }

  const resolvedLayer = graphData.layerAssignments[producerId];
  if (resolvedLayer === undefined) {
    throw new Error(
      `Could not resolve layer for canonical producer ${producerId} from blueprint graph assignments.`
    );
  }

  return resolvedLayer;
}

const validProducerStatuses: ProducerStatus[] = [
  'success',
  'error',
  'not-run-yet',
  'skipped',
  'running',
  'pending',
];

interface LayerGuide {
  key: string;
  layerIndex: number;
  label: string;
  bandX: number;
  bandTop: number;
  bandWidth: number;
  bandHeight: number;
  headerX: number;
  headerY: number;
  included: boolean;
}

interface CompositeGuide {
  key: string;
  compositeKey: string;
  compositeName: string;
  layerIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  included: boolean;
}

const layerGuideConfig = {
  horizontalPadding: 26,
  minHorizontalPadding: 8,
  interLayerGap: 10,
  verticalPadding: 16,
  headerWidth: 120,
  headerHeight: 24,
  headerOffset: 10,
  nodeWidthAllowance: 24,
  nodeHeightAllowance: 30,
} as const;

const fitBoundsAnchorIds = {
  left: '__fit-bounds-anchor-left',
  right: '__fit-bounds-anchor-right',
} as const;

function buildLayerGuides(
  graphData: BlueprintGraphData,
  layoutNodes: Node[],
  selectedUpToLayer: number | null
): LayerGuide[] {
  const layerCount = graphData.layerCount ?? 0;
  if (layerCount <= 1) {
    return [];
  }

  const layerNodeBounds = new Map<
    number,
    {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  >();

  const fallbackNodeWidth =
    defaultBlueprintLayoutConfig.nodeWidth +
    layerGuideConfig.nodeWidthAllowance;
  const fallbackNodeHeight =
    defaultBlueprintLayoutConfig.nodeMinHeight +
    layerGuideConfig.nodeHeightAllowance;

  for (const node of layoutNodes) {
    if (node.type !== 'producerNode') {
      continue;
    }
    const layer = graphData.layerAssignments?.[node.id] ?? 0;
    const bounds = layerNodeBounds.get(layer);
    const measuredWidth =
      typeof node.measured?.width === 'number' ? node.measured.width : null;
    const measuredHeight =
      typeof node.measured?.height === 'number' ? node.measured.height : null;
    const width = measuredWidth ?? fallbackNodeWidth;
    const height = measuredHeight ?? fallbackNodeHeight;
    const x = node.position.x;
    const y = node.position.y;
    const right = x + width;
    const bottom = y + height;

    if (!bounds) {
      layerNodeBounds.set(layer, {
        minX: x,
        maxX: right,
        minY: y,
        maxY: bottom,
      });
      continue;
    }

    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, right);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, bottom);
  }

  const layerBounds = Array.from({ length: layerCount }, (_, layerIndex) => {
    const bounds = layerNodeBounds.get(layerIndex);
    const fallbackX = layerIndex * defaultBlueprintLayoutConfig.horizontalSpacing;

    return {
      minX: bounds?.minX ?? fallbackX,
      maxX: bounds?.maxX ?? fallbackX + fallbackNodeWidth,
      minY: bounds?.minY ?? 0,
      maxY: bounds?.maxY ?? fallbackNodeHeight,
    };
  });

  const horizontalBands = layerBounds.map((bounds) => ({
    left: bounds.minX - layerGuideConfig.horizontalPadding,
    right: bounds.maxX + layerGuideConfig.horizontalPadding,
    maxLeft: bounds.minX - layerGuideConfig.minHorizontalPadding,
    minRight: bounds.maxX + layerGuideConfig.minHorizontalPadding,
  }));

  for (let i = 0; i < horizontalBands.length - 1; i += 1) {
    const current = horizontalBands[i];
    const next = horizontalBands[i + 1];
    const existingGap = next.left - current.right;

    if (existingGap >= layerGuideConfig.interLayerGap) {
      continue;
    }

    let gapDeficit = layerGuideConfig.interLayerGap - existingGap;

    const currentShrinkCapacity = current.right - current.minRight;
    const nextShrinkCapacity = next.maxLeft - next.left;
    const totalCapacity = currentShrinkCapacity + nextShrinkCapacity;

    if (totalCapacity <= 0) {
      continue;
    }

    const currentShare = (currentShrinkCapacity / totalCapacity) * gapDeficit;
    const currentApplied = Math.min(currentShare, currentShrinkCapacity);
    current.right -= currentApplied;
    gapDeficit -= currentApplied;

    const nextApplied = Math.min(gapDeficit, nextShrinkCapacity);
    next.left += nextApplied;
    gapDeficit -= nextApplied;

    if (gapDeficit > 0) {
      const extraCurrent = current.right - current.minRight;
      const extraCurrentApplied = Math.min(gapDeficit, extraCurrent);
      current.right -= extraCurrentApplied;
      gapDeficit -= extraCurrentApplied;

      if (gapDeficit > 0) {
        const extraNext = next.maxLeft - next.left;
        const extraNextApplied = Math.min(gapDeficit, extraNext);
        next.left += extraNextApplied;
      }
    }
  }

  return Array.from({ length: layerCount }, (_, layerIndex) => {
    const bounds = layerBounds[layerIndex];
    const horizontalBand = horizontalBands[layerIndex];
    const minY = bounds.minY;
    const maxY = bounds.maxY;

    const bandX = horizontalBand.left;
    const bandTop = minY - layerGuideConfig.verticalPadding;
    const bandWidth = horizontalBand.right - horizontalBand.left;
    const bandHeight = maxY - minY + layerGuideConfig.verticalPadding * 2;
    const headerCenterX = (horizontalBand.left + horizontalBand.right) / 2;
    const headerX = headerCenterX - layerGuideConfig.headerWidth / 2;
    const headerY =
      bandTop - layerGuideConfig.headerHeight - layerGuideConfig.headerOffset;

    return {
      key: `layer-${layerIndex}`,
      layerIndex,
      label: `Layer ${layerIndex + 1}`,
      bandX,
      bandTop,
      bandWidth,
      bandHeight,
      headerX,
      headerY,
      included: selectedUpToLayer === null || layerIndex <= selectedUpToLayer,
    };
  });
}

function parseProducerNodeData(node: Node): ProducerDetails {
  if (node.type !== 'producerNode') {
    throw new Error(
      `Expected producer node type, received: ${String(node.type)}`
    );
  }

  const data = node.data as Partial<ProducerNodeData>;

  if (typeof data.label !== 'string' || data.label.length === 0) {
    throw new Error(`Producer node ${node.id} is missing a label`);
  }
  if (!Array.isArray(data.inputBindings)) {
    throw new Error(`Producer node ${node.id} is missing input bindings`);
  }
  if (!Array.isArray(data.outputBindings)) {
    throw new Error(`Producer node ${node.id} is missing output bindings`);
  }
  if (
    typeof data.status !== 'string' ||
    !validProducerStatuses.includes(data.status as ProducerStatus)
  ) {
    throw new Error(`Producer node ${node.id} has an invalid status`);
  }
  return {
    nodeId: node.id,
    label: data.label,
    runnable: data.runnable,
    loop: data.loop,
    producerType: data.producerType,
    description: data.description,
    status: data.status,
    inputBindings: data.inputBindings,
    outputBindings: data.outputBindings,
  };
}

function buildCompositeGuides(
  graphData: BlueprintGraphData,
  layoutNodes: Node[],
  selectedUpToLayer: number | null
): CompositeGuide[] {
  const groups = new Map<
    string,
    {
      compositeKey: string;
      compositeName: string;
      layerIndex: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
    }
  >();

  const fallbackNodeWidth = defaultBlueprintLayoutConfig.nodeWidth;
  const fallbackNodeHeight = defaultBlueprintLayoutConfig.nodeMinHeight;

  for (const node of layoutNodes) {
    if (node.type !== 'producerNode') {
      continue;
    }

    const data = node.data as Partial<ProducerNodeData>;
    const compositePath = Array.isArray(data.compositePath)
      ? data.compositePath
      : [];
    const compositeName =
      typeof data.compositeName === 'string' ? data.compositeName : null;
    if (compositePath.length === 0 || !compositeName) {
      continue;
    }

    const layerIndex = graphData.layerAssignments?.[node.id];
    if (layerIndex === undefined) {
      throw new Error(
        `Missing layer assignment for producer node ${node.id} while building composite guides.`
      );
    }

    const compositeKey = compositePath.join('.');
    const groupKey = `${compositeKey}::${layerIndex}`;
    const width =
      typeof node.measured?.width === 'number'
        ? node.measured.width
        : fallbackNodeWidth;
    const height =
      typeof node.measured?.height === 'number'
        ? node.measured.height
        : fallbackNodeHeight;
    const next = {
      compositeKey,
      compositeName,
      layerIndex,
      minX: node.position.x,
      maxX: node.position.x + width,
      minY: node.position.y,
      maxY: node.position.y + height,
    };
    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, next);
      continue;
    }

    existing.minX = Math.min(existing.minX, next.minX);
    existing.maxX = Math.max(existing.maxX, next.maxX);
    existing.minY = Math.min(existing.minY, next.minY);
    existing.maxY = Math.max(existing.maxY, next.maxY);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => ({
      key,
      compositeKey: group.compositeKey,
      compositeName: group.compositeName,
      layerIndex: group.layerIndex,
      left: group.minX - defaultBlueprintLayoutConfig.compositePadding,
      top: group.minY - defaultBlueprintLayoutConfig.compositePadding,
      width:
        group.maxX -
        group.minX +
        defaultBlueprintLayoutConfig.compositePadding * 2,
      height:
        group.maxY -
        group.minY +
        defaultBlueprintLayoutConfig.compositePadding * 2,
      included:
        selectedUpToLayer === null || group.layerIndex <= selectedUpToLayer,
    }))
    .sort((left, right) => {
      if (left.layerIndex !== right.layerIndex) {
        return left.layerIndex - right.layerIndex;
      }
      if (left.compositeKey !== right.compositeKey) {
        return left.compositeKey.localeCompare(right.compositeKey);
      }
      return left.top - right.top;
    });
}

export function BlueprintViewer({
  graphData,
  blueprintName,
  movieId,
  selectedUpToLayer,
  onLayerSelect,
  onNodeSelect,
  producerStatuses,
}: BlueprintViewerProps) {
  const {
    getProducerOverride,
    getProducerSchedulingSummary,
    requestProducerScheduling,
    setProducerOverrideEnabled,
    setProducerOverrideCount,
    resetProducerOverride,
  } = useExecution();
  const isDark = useDarkMode();
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutBlueprintGraph(graphData, undefined, producerStatuses),
    [graphData, producerStatuses]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [dialogProducer, setDialogProducer] = useState<ProducerDetails | null>(
    null
  );
  const [refreshedSchedulingByProducerId, setRefreshedSchedulingByProducerId] =
    useState<Record<string, ProducerSchedulingSummary>>({});
  const [schedulingUiByProducerId, setSchedulingUiByProducerId] = useState<
    Record<string, { loading: boolean; error: string | null }>
  >({});
  const [showConnectionArrows, setShowConnectionArrows] = useState(false);
  const schedulingRequestKeysRef = useRef<Set<string>>(new Set());
  const dialogProducerId = dialogProducer ? dialogProducer.nodeId : null;
  const dialogScheduling = dialogProducerId
    ? refreshedSchedulingByProducerId[dialogProducerId] ??
      getProducerSchedulingSummary(dialogProducerId)
    : undefined;
  const dialogSchedulingUi = dialogProducerId
    ? schedulingUiByProducerId[dialogProducerId]
    : undefined;
  const dialogSchedulingLoading = dialogProducerId
    ? dialogSchedulingUi?.loading ?? dialogScheduling === undefined
    : false;
  const dialogSchedulingError = dialogSchedulingUi?.error ?? null;

  const layerGuides = useMemo(
    () => buildLayerGuides(graphData, nodes, selectedUpToLayer ?? null),
    [graphData, nodes, selectedUpToLayer]
  );
  const compositeGuides = useMemo(
    () => buildCompositeGuides(graphData, nodes, selectedUpToLayer ?? null),
    [graphData, nodes, selectedUpToLayer]
  );

  const nodesForRender = useMemo(() => {
    if (layerGuides.length === 0) {
      return nodes;
    }

    const minHeaderX = Math.min(...layerGuides.map((guide) => guide.headerX));
    const minHeaderY = Math.min(...layerGuides.map((guide) => guide.headerY));
    const maxHeaderX = Math.max(
      ...layerGuides.map(
        (guide) => guide.headerX + layerGuideConfig.headerWidth
      )
    );

    return [
      ...nodes,
      {
        id: fitBoundsAnchorIds.left,
        type: 'fitBoundsAnchor',
        position: {
          x: minHeaderX,
          y: minHeaderY,
        },
        data: {},
        draggable: false,
        selectable: false,
        focusable: false,
      },
      {
        id: fitBoundsAnchorIds.right,
        type: 'fitBoundsAnchor',
        position: {
          x: maxHeaderX,
          y: minHeaderY,
        },
        data: {},
        draggable: false,
        selectable: false,
        focusable: false,
      },
    ];
  }, [layerGuides, nodes]);

  // Synchronize nodes and edges when layout changes (new build selected, graph changes, etc.)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  useEffect(() => {
    schedulingRequestKeysRef.current.clear();
    setRefreshedSchedulingByProducerId({});
    setSchedulingUiByProducerId({});
  }, [blueprintName, movieId, selectedUpToLayer]);

  useEffect(() => {
    if (!dialogProducer || !dialogProducerId) {
      return;
    }

    if (dialogProducer.runnable === false) {
      setSchedulingUiByProducerId((prev) => ({
        ...prev,
        [dialogProducerId]: { loading: false, error: null },
      }));
      return;
    }

    let dialogProducerLayer: number;
    try {
      dialogProducerLayer = deriveProducerLayerIndexFromGraph(
        graphData,
        dialogProducerId
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to resolve producer layer for scheduling.';
      setSchedulingUiByProducerId((prev) => ({
        ...prev,
        [dialogProducerId]: { loading: false, error: message },
      }));
      return;
    }

    const requestKey = [
      dialogProducerId,
      dialogProducerLayer,
      blueprintName,
      movieId ?? '',
      selectedUpToLayer ?? '',
    ].join('|');
    if (schedulingRequestKeysRef.current.has(requestKey)) {
      return;
    }
    schedulingRequestKeysRef.current.add(requestKey);
    setSchedulingUiByProducerId((prev) => ({
      ...prev,
      [dialogProducerId]: { loading: true, error: null },
    }));
    void (async () => {
      let refreshError: string | null = null;
      try {
        const schedulingResponse = await requestProducerScheduling(
          blueprintName,
          dialogProducerId,
          dialogProducerLayer,
          movieId ?? undefined,
          selectedUpToLayer ?? undefined
        );
        setRefreshedSchedulingByProducerId((prev) => ({
          ...prev,
          [dialogProducerId]: schedulingResponse.producerScheduling,
        }));
        if (!schedulingResponse.compatibility.ok) {
          const compatibilityError = schedulingResponse.compatibility.error;
          if (compatibilityError) {
            refreshError = compatibilityError.code
              ? `${compatibilityError.code}: ${compatibilityError.message}`
              : compatibilityError.message;
          } else {
            refreshError = 'Producer override is not compatible with this run scope.';
          }
        }
      } catch (error) {
        refreshError =
          error instanceof Error
            ? error.message
            : 'Failed to refresh producer scheduling.';
      } finally {
        schedulingRequestKeysRef.current.delete(requestKey);
        setSchedulingUiByProducerId((prev) => ({
          ...prev,
          [dialogProducerId]: { loading: false, error: refreshError },
        }));
      }
    })();
  }, [
    blueprintName,
    graphData,
    dialogProducer,
    dialogProducerId,
    movieId,
    requestProducerScheduling,
    selectedUpToLayer,
  ]);

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);

      // Find selection changes
      for (const change of changes) {
        if (change.type === 'select') {
          if (change.selected) {
            onNodeSelect?.(change.id);
          }
        }
      }
    },
    [onNodesChange, onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect?.(null);
    setDialogProducer(null);
  }, [onNodeSelect]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeSelect?.(node.id);

      if (node.type === 'producerNode') {
        setDialogProducer(parseProducerNodeData(node));
        return;
      }

      setDialogProducer(null);
    },
    [onNodeSelect]
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogProducer(null);
    }
  }, []);

  return (
    <div className='absolute inset-0'>
      <ReactFlow
        nodes={nodesForRender}
        edges={showConnectionArrows ? edges : []}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{
          padding: 0.2,
          maxZoom: 1.5,
        }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className='bg-background'
      >
        <Background color={isDark ? '#666' : '#ccc'} gap={20} />
        {layerGuides.length > 0 && (
          <ViewportPortal>
            <>
              {compositeGuides.map((guide) => (
                <div
                  key={`${guide.key}-composite`}
                  className={`
                    pointer-events-none absolute rounded-[28px] border transition-colors duration-200
                    ${
                      guide.included
                        ? 'border-amber-500/40 bg-amber-500/6'
                        : 'border-border/25 bg-transparent'
                    }
                  `}
                  style={{
                    left: guide.left,
                    top: guide.top,
                    width: guide.width,
                    height: guide.height,
                  }}
                />
              ))}
              {layerGuides.map((guide) => (
                <div
                  key={`${guide.key}-band`}
                  className={`
                    pointer-events-none absolute rounded-xl border transition-colors duration-200
                    ${
                      guide.included
                        ? 'border-item-active-border/60 bg-item-active-bg/45'
                        : 'border-border/35 bg-muted/20'
                    }
                  `}
                  style={{
                    left: guide.bandX,
                    top: guide.bandTop,
                    width: guide.bandWidth,
                    height: guide.bandHeight,
                  }}
                />
              ))}
              {layerGuides.map((guide) => (
                <button
                  key={`${guide.key}-header`}
                  type='button'
                  onClick={() => onLayerSelect?.(guide.layerIndex)}
                  disabled={onLayerSelect === undefined}
                  className={`
                    absolute flex items-center justify-center rounded-md border
                    px-2 text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors duration-200
                    ${onLayerSelect ? 'cursor-pointer pointer-events-auto' : 'pointer-events-none'}
                    ${
                      guide.included
                        ? 'border-item-active-border/70 bg-item-active-bg/85 text-foreground shadow-xs'
                        : 'border-border/40 bg-sidebar-header-bg/90 text-muted-foreground'
                    }
                  `}
                  title={`Set scope through ${guide.label}`}
                  style={{
                    left: guide.headerX,
                    top: guide.headerY,
                    width: layerGuideConfig.headerWidth,
                    height: layerGuideConfig.headerHeight,
                  }}
                >
                  {guide.label}
                </button>
              ))}
            </>
          </ViewportPortal>
        )}
        <Controls
          className='bg-card! border-border/60! shadow-lg!'
          showInteractive={false}
        >
          <ControlButton
            onClick={() => setShowConnectionArrows((value) => !value)}
            aria-label={
              showConnectionArrows
                ? 'Hide producer connection arrows'
                : 'Show producer connection arrows'
            }
            title={
              showConnectionArrows
                ? 'Hide producer connection arrows'
                : 'Show producer connection arrows'
            }
          >
            {showConnectionArrows ? (
              <Eye className='size-4' />
            ) : (
              <EyeOff className='size-4' />
            )}
          </ControlButton>
        </Controls>
        {/* <MiniMap
          className="!bg-card !border-border/60"
          nodeColor={(node: Node) => {
            switch (node.type) {
              case "inputNode":
                return "#3b82f6";
              case "producerNode":
                return "#6b7280";
              case "outputNode":
                return "#a855f7";
              default:
                return "#666";
            }
          }}
          maskColor="rgba(0,0,0,0.8)"
        /> */}
      </ReactFlow>
      <ProducerDetailsDialog
        open={dialogProducer !== null}
        producer={dialogProducer}
        producerId={dialogProducerId ?? undefined}
        override={
          dialogProducerId
            ? getProducerOverride(dialogProducerId)
            : undefined
        }
        scheduling={dialogScheduling}
        schedulingLoading={dialogSchedulingLoading}
        schedulingError={dialogSchedulingError}
        onSetOverrideEnabled={setProducerOverrideEnabled}
        onSetOverrideCount={setProducerOverrideCount}
        onResetOverride={resetProducerOverride}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  );
}
