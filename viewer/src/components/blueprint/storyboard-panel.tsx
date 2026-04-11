import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  Check,
  Clock3,
  Copy,
  CornerDownRight,
  Download,
  ExternalLink,
  Pin,
  Pencil,
  RefreshCw,
  RotateCcw,
  SkipForward,
} from 'lucide-react';
import {
  applyArtifactPreview,
  buildInputFileUrl,
  deleteArtifactPreview,
  editArtifactFile,
  editArtifactText,
  estimateArtifactPreview,
  generateArtifactPreview,
  parseFileRef,
  restoreArtifact,
} from '@/data/blueprint-client';
import { useExecution } from '@/contexts/execution-context';
import { useStoryboardProjection } from '@/hooks';
import { resolveAudioInputBindingSource } from '@/lib/audio-input-binding-resolver';
import {
  extractProducerFromArtifactId,
  getBlobUrl,
} from '@/lib/artifact-utils';
import { toMediaInputType, uploadAndValidate } from '@/lib/panel-utils';
import { cn } from '@/lib/utils';
import type {
  BlueprintGraphData,
  ModelSelectionValue,
  ProducerModelInfo,
} from '@/types/blueprint-graph';
import type { ArtifactInfo } from '@/types/builds';
import type {
  StoryboardColumn,
  StoryboardConnector,
  StoryboardItem,
  StoryboardProjection,
} from '@/types/storyboard';
import {
  AudioCard,
  AudioEditDialog,
  CardActionsFooter,
  type CardAction,
  ImageCard,
  ImageEditDialog,
  MediaCard,
  MusicEditDialog,
  TextCard,
  TextEditorDialog,
  VideoCard,
  VideoEditDialog,
} from './shared';
import { FileUploadDialog } from './inputs/file-upload-dialog';
import { EditedBadge } from './outputs/edited-badge';

interface StoryboardPanelProps {
  blueprintPath: string;
  blueprintFolder?: string | null;
  movieId?: string | null;
  catalogRoot?: string | null;
  artifacts?: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  buildInputs?: Record<string, unknown> | null;
  isInputsEditable?: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  producerModels?: Record<string, ProducerModelInfo>;
  modelSelections?: ModelSelectionValue[];
  onArtifactUpdated?: () => void;
}

interface ConnectorPath {
  id: string;
  d: string;
  kind: StoryboardConnector['kind'];
}

type StoryboardLaneType = 'video' | 'image' | 'audio';
type StoryboardAudioMediaType = 'audio' | 'music';

interface StoryboardLaneModel {
  type: StoryboardLaneType;
  title: string;
  entries: StoryboardLaneEntry[];
}

interface StoryboardLaneEntry {
  item: StoryboardItem;
  promptCards: StoryboardPromptCardModel[];
}

interface StoryboardMediaPromptDetails {
  title?: string;
  text?: string;
  url?: string;
  artifactId?: string;
}

type StoryboardPromptCardModel =
  | {
      key: string;
      kind: 'input';
      item: StoryboardItem;
    }
  | {
      key: string;
      kind: 'artifact-item';
      item: StoryboardItem;
      artifact: ArtifactInfo;
    };

const STORYBOARD_LANE_ORDER: StoryboardLaneType[] = ['video', 'image', 'audio'];

export function StoryboardPanel({
  blueprintPath,
  blueprintFolder = null,
  movieId = null,
  catalogRoot = null,
  artifacts = [],
  graphData,
  buildInputs = null,
  isInputsEditable = false,
  onSaveInputs,
  producerModels = {},
  modelSelections = [],
  onArtifactUpdated,
}: StoryboardPanelProps) {
  const refreshKey = useMemo(() => {
    const artifactKey = artifacts
      .map(
        (artifact) =>
          `${artifact.id}:${artifact.hash}:${artifact.status}:${artifact.editedBy ?? 'producer'}`
      )
      .join('|');
    const inputKey = buildInputs ? JSON.stringify(buildInputs) : 'no-build-inputs';
    return `${inputKey}::${artifactKey}`;
  }, [artifacts, buildInputs]);

  const { projection, isLoading, error } = useStoryboardProjection({
    blueprintPath,
    blueprintFolder,
    movieId,
    catalogRoot,
    refreshKey,
  });

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Loading storyboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className='flex h-full items-center justify-center'>
        <div className='max-w-md rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300'>
          {error.message}
        </div>
      </div>
    );
  }

  if (!projection) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Storyboard data is not available.
      </div>
    );
  }

  return (
    <StoryboardBoard
      projection={projection}
      blueprintFolder={blueprintFolder}
      movieId={movieId}
      artifacts={artifacts}
      graphData={graphData}
      buildInputs={buildInputs}
      isInputsEditable={isInputsEditable}
      onSaveInputs={onSaveInputs}
      producerModels={producerModels}
      modelSelections={modelSelections}
      onArtifactUpdated={onArtifactUpdated}
    />
  );
}

function StoryboardBoard({
  projection,
  blueprintFolder,
  movieId,
  artifacts,
  graphData,
  buildInputs,
  isInputsEditable,
  onSaveInputs,
  producerModels,
  modelSelections,
  onArtifactUpdated,
}: {
  projection: StoryboardProjection;
  blueprintFolder: string | null;
  movieId: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  buildInputs: Record<string, unknown> | null;
  isInputsEditable: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  producerModels: Record<string, ProducerModelInfo>;
  modelSelections: ModelSelectionValue[];
  onArtifactUpdated?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [connectorPaths, setConnectorPaths] = useState<ConnectorPath[]>([]);

  const itemById = useMemo(() => buildItemById(projection), [projection]);
  const promptSourcesByMediaId = useMemo(
    () => buildPromptSourcesByMediaId(projection, itemById),
    [projection, itemById]
  );
  const artifactById = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact.id, artifact])),
    [artifacts]
  );
  const laneTypes = useMemo(() => {
    const presentLaneTypes = new Set<StoryboardLaneType>();
    for (const column of projection.columns) {
      for (const group of column.groups) {
        for (const item of group.items) {
          if (
            item.mediaType === 'video' ||
            item.mediaType === 'image' ||
            item.mediaType === 'audio'
          ) {
            presentLaneTypes.add(item.mediaType);
          }
        }
      }
    }
    return STORYBOARD_LANE_ORDER.filter((laneType) => presentLaneTypes.has(laneType));
  }, [projection.columns]);

  const registerItemRef = useCallback(
    (itemId: string) => (element: HTMLDivElement | null) => {
      if (element) {
        itemRefs.current.set(itemId, element);
      } else {
        itemRefs.current.delete(itemId);
      }
    },
    []
  );

  const recomputeConnectors = useCallback(() => {
    if (!boardRef.current) {
      setConnectorPaths([]);
      return;
    }

    const boardRect = boardRef.current.getBoundingClientRect();
    const nextPaths = projection.connectors.flatMap((connector) => {
      const source = itemRefs.current.get(connector.fromItemId);
      const target = itemRefs.current.get(connector.toItemId);
      if (!source || !target) {
        return [];
      }

      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const startX = sourceRect.right - boardRect.left;
      const startY = sourceRect.top - boardRect.top + sourceRect.height / 2;
      const endX = targetRect.left - boardRect.left;
      const endY = targetRect.top - boardRect.top + targetRect.height / 2;
      const controlOffset = Math.max(40, Math.abs(endX - startX) * 0.35);

      return [
        {
          id: connector.id,
          kind: connector.kind,
          d: `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${
            endX - controlOffset
          } ${endY}, ${endX} ${endY}`,
        },
      ];
    });

    setConnectorPaths(nextPaths);
  }, [projection.connectors]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recomputeConnectors();
  }, [projection, recomputeConnectors]);

  useEffect(() => {
    const handleResize = () => recomputeConnectors();
    window.addEventListener('resize', handleResize);
    const scrollElement = scrollRef.current;
    scrollElement?.addEventListener('scroll', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      scrollElement?.removeEventListener('scroll', handleResize);
    };
  }, [recomputeConnectors]);

  return (
    <div ref={scrollRef} className='h-full overflow-auto'>
      <div
        ref={boardRef}
        className='relative flex min-h-full min-w-max items-start gap-4 pb-4 pr-4'
      >
        <StoryboardConnectorLayer paths={connectorPaths} />

        {projection.columns.map((column) => (
          <StoryboardColumnCard
            key={column.id}
            column={column}
            laneTypes={laneTypes}
            registerItemRef={registerItemRef}
            promptSourcesByMediaId={promptSourcesByMediaId}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
            artifacts={artifacts}
            graphData={graphData}
            buildInputs={buildInputs}
            isInputsEditable={isInputsEditable}
            onSaveInputs={onSaveInputs}
            producerModels={producerModels}
            modelSelections={modelSelections}
            onArtifactUpdated={onArtifactUpdated}
            artifactById={artifactById}
          />
        ))}
      </div>
    </div>
  );
}

function StoryboardColumnCard({
  column,
  laneTypes,
  registerItemRef,
  promptSourcesByMediaId,
  blueprintFolder,
  movieId,
  artifacts,
  graphData,
  buildInputs,
  isInputsEditable,
  onSaveInputs,
  producerModels,
  modelSelections,
  onArtifactUpdated,
  artifactById,
}: {
  column: StoryboardColumn;
  laneTypes: StoryboardLaneType[];
  registerItemRef: (itemId: string) => (element: HTMLDivElement | null) => void;
  promptSourcesByMediaId: Map<string, StoryboardItem[]>;
  blueprintFolder: string | null;
  movieId: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  buildInputs: Record<string, unknown> | null;
  isInputsEditable: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  producerModels: Record<string, ProducerModelInfo>;
  modelSelections: ModelSelectionValue[];
  onArtifactUpdated?: () => void;
  artifactById: Map<string, ArtifactInfo>;
}) {
  const laneModels = useMemo(
    () =>
      buildStoryboardLaneModels({
        column,
        laneTypes,
        promptSourcesByMediaId,
        artifactById,
      }),
    [
      artifactById,
      column,
      laneTypes,
      promptSourcesByMediaId,
    ]
  );

  return (
    <StoryboardSectionCard title={column.title}>
      <div className='space-y-4'>
        {laneModels.map((lane) => (
          <section key={`${column.id}:${lane.type}`} className='space-y-3'>
            <div className='text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
              {lane.title}
            </div>
            <div className='space-y-3'>
              {lane.entries.map((entry) => (
                <div key={entry.item.id} className='space-y-3'>
                  <div ref={registerItemRef(entry.item.id)}>
                    <StoryboardMediaItemCard
                      item={entry.item}
                      promptCards={entry.promptCards}
                      blueprintFolder={blueprintFolder}
                      movieId={movieId}
                      artifacts={artifacts}
                      graphData={graphData}
                      producerModels={producerModels}
                      modelSelections={modelSelections}
                      buildInputs={buildInputs}
                      isInputsEditable={isInputsEditable}
                      onSaveInputs={onSaveInputs}
                      onArtifactUpdated={onArtifactUpdated}
                    />
                  </div>

                  {entry.promptCards.map((promptCard) => (
                    <StoryboardPromptCard
                      key={promptCard.key}
                      promptCard={promptCard}
                      blueprintFolder={blueprintFolder}
                      movieId={movieId}
                      buildInputs={buildInputs}
                      isInputsEditable={isInputsEditable}
                      onSaveInputs={onSaveInputs}
                      onArtifactUpdated={onArtifactUpdated}
                    />
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </StoryboardSectionCard>
  );
}

function StoryboardSectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className='relative z-10 w-[22rem] shrink-0 overflow-hidden rounded-[var(--radius-panel)] border border-border/40 bg-panel-bg/80 shadow-lg backdrop-blur-sm'>
      <div className='flex h-[45px] items-center border-b border-border/40 bg-sidebar-header-bg px-4'>
        <span className='text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground'>
          {title}
        </span>
      </div>
      <div className='p-4'>{children}</div>
    </section>
  );
}

function StoryboardMediaItemCard({
  item,
  promptCards,
  blueprintFolder,
  movieId,
  artifacts,
  graphData,
  producerModels,
  modelSelections,
  buildInputs,
  isInputsEditable,
  onSaveInputs,
  onArtifactUpdated,
}: {
  item: StoryboardItem;
  promptCards: StoryboardPromptCardModel[];
  blueprintFolder: string | null;
  movieId: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  producerModels: Record<string, ProducerModelInfo>;
  modelSelections: ModelSelectionValue[];
  buildInputs: Record<string, unknown> | null;
  isInputsEditable: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  onArtifactUpdated?: () => void;
}) {
  const promptDetails = useMemo(
    () => resolveMediaPromptDetails(promptCards, blueprintFolder, movieId),
    [promptCards, blueprintFolder, movieId]
  );

  if (item.kind === 'placeholder') {
    return <StoryboardPlaceholderCard item={item} />;
  }

  if (item.kind.startsWith('input-')) {
    return (
      <StoryboardInputMediaCard
        item={item}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        buildInputs={buildInputs}
        onSaveInputs={isInputsEditable ? onSaveInputs : undefined}
        promptDetails={promptDetails}
      />
    );
  }

  const artifactId = item.identity.canonicalArtifactId;
  const artifact = artifactId
    ? artifacts.find((candidate) => candidate.id === artifactId)
    : undefined;
  if (artifact && blueprintFolder && movieId && artifact.status === 'succeeded') {
    return (
      <StoryboardArtifactMediaCard
        artifact={artifact}
        item={item}
        promptDetails={promptDetails}
        artifacts={artifacts}
        graphData={graphData}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        producerModels={producerModels}
        modelSelections={modelSelections}
        buildInputs={buildInputs}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }

  if (item.state === 'succeeded') {
    return (
      <StoryboardStaticMediaCard
        item={item}
        promptDetails={promptDetails}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
      />
    );
  }

  return <StoryboardPlaceholderCard item={item} />;
}

function StoryboardInputMediaCard({
  item,
  blueprintFolder,
  movieId,
  buildInputs,
  onSaveInputs,
  promptDetails,
}: {
  item: StoryboardItem;
  blueprintFolder: string | null;
  movieId: string | null;
  buildInputs: Record<string, unknown> | null;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  promptDetails: StoryboardMediaPromptDetails;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const mediaType = toStoryboardMediaInputType(item.mediaType);
  const mediaUrl = resolveMediaUrl(item, blueprintFolder, movieId);
  const isEditable =
    Boolean(onSaveInputs) && Boolean(buildInputs) && Boolean(blueprintFolder) && Boolean(movieId);

  const handleUpload = async (files: File[]) => {
    if (!onSaveInputs || !buildInputs) {
      throw new Error(`Cannot edit storyboard input "${item.id}" without loaded build inputs.`);
    }

    const result = await uploadAndValidate(
      { blueprintFolder, movieId },
      files,
      toMediaInputType(mediaType)
    );
    const nextInputPatch = createStoryboardInputPatch(
      buildInputs,
      item.identity.canonicalInputId,
      result.files[0]?.fileRef
    );
    await onSaveInputs(nextInputPatch);
    setDialogOpen(false);
  };

  const footer = (
    <CardActionsFooter
      label={item.label}
      description={item.description}
      badge={<StoryboardCarryOverBadge item={item} />}
      actions={
        isEditable
          ? [
              {
                id: 'edit',
                label: 'Edit',
                icon: Pencil,
                onClick: () => setDialogOpen(true),
              },
            ]
          : undefined
      }
    />
  );

  if (!mediaUrl) {
    return (
      <>
        <MediaCard footer={footer}>
          <button
            type='button'
            onClick={() => setDialogOpen(true)}
            className='flex min-h-[180px] w-full items-center justify-center bg-muted/30 p-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50'
            disabled={!isEditable}
          >
            Add {humanizeLaneType(mediaType)}
          </button>
        </MediaCard>
        <FileUploadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mediaType={mediaType}
          multiple={false}
          onConfirm={handleUpload}
        />
      </>
    );
  }

  return (
    <>
      {mediaType === 'video' && (
        <VideoCard
          url={mediaUrl}
          title={item.label}
          footer={footer}
          promptTitle={promptDetails.title}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url}
        />
      )}
      {mediaType === 'audio' && (
        <AudioCard
          url={mediaUrl}
          title={item.label}
          footer={footer}
          promptTitle={promptDetails.title}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url}
        />
      )}
      {mediaType === 'image' && (
        <ImageCard
          url={mediaUrl}
          title={item.label}
          footer={footer}
          promptTitle={promptDetails.title}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url}
        />
      )}

      <FileUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mediaType={mediaType}
        multiple={false}
        onConfirm={handleUpload}
      />
    </>
  );
}

function StoryboardStaticMediaCard({
  item,
  promptDetails,
  blueprintFolder,
  movieId,
}: {
  item: StoryboardItem;
  promptDetails: StoryboardMediaPromptDetails;
  blueprintFolder: string | null;
  movieId: string | null;
}) {
  const mediaUrl = resolveMediaUrl(item, blueprintFolder, movieId);
  if (!mediaUrl) {
    return <StoryboardPlaceholderCard item={item} />;
  }

  const footer = (
    <CardActionsFooter
      label={item.label}
      description={item.description}
      badge={<StoryboardCarryOverBadge item={item} />}
    />
  );

  if (item.mediaType === 'video') {
    return (
      <VideoCard
        url={mediaUrl}
        title={item.label}
        expandable
        promptTitle={promptDetails.title}
        promptText={promptDetails.text}
        promptUrl={promptDetails.url}
        footer={footer}
      />
    );
  }

  if (item.mediaType === 'audio') {
    return (
      <AudioCard
        url={mediaUrl}
        title={item.label}
        expandable
        promptTitle={promptDetails.title}
        promptText={promptDetails.text}
        promptUrl={promptDetails.url}
        footer={footer}
      />
    );
  }

  return (
    <ImageCard
      url={mediaUrl}
      title={item.label}
      promptTitle={promptDetails.title}
      promptText={promptDetails.text}
      promptUrl={promptDetails.url}
      footer={footer}
    />
  );
}

function StoryboardArtifactMediaCard({
  artifact,
  item,
  promptDetails,
  artifacts,
  graphData,
  blueprintFolder,
  movieId,
  producerModels,
  modelSelections,
  buildInputs,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  item: StoryboardItem;
  promptDetails: StoryboardMediaPromptDetails;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  blueprintFolder: string;
  movieId: string;
  producerModels: Record<string, ProducerModelInfo>;
  modelSelections: ModelSelectionValue[];
  buildInputs: Record<string, unknown> | null;
  onArtifactUpdated?: () => void;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const promptArtifact = promptDetails.artifactId
    ? artifacts.find((candidate) => candidate.id === promptDetails.artifactId)
    : undefined;
  const promptLabel = promptArtifact
    ? `Prompt (${shortenPromptArtifactLabel(promptArtifact.id)})`
    : 'Prompt';
  const promptUrl = promptArtifact
    ? getBlobUrl(blueprintFolder, movieId, promptArtifact.hash)
    : undefined;
  const displayName = item.label;
  const isEdited = artifact.editedBy === 'user';
  const artifactProducerAlias = extractProducerFromArtifactId(artifact.id);
  const availableRerunModels = artifactProducerAlias
    ? (producerModels[artifactProducerAlias]?.availableModels ?? [])
    : [];
  const currentModelSelection = artifactProducerAlias
    ? modelSelections.find((selection) => selection.producerId === artifactProducerAlias)
    : undefined;
  const initialModel = currentModelSelection
    ? {
        provider: currentModelSelection.provider,
        model: currentModelSelection.model,
      }
    : undefined;
  const mediaType = resolveStoryboardAudioMediaType({
    artifact,
    graphData,
    producerModels,
    defaultType: item.mediaType,
  });

  const voiceSource =
    mediaType === 'audio'
      ? resolveAudioInputBindingSource({
          audioArtifactId: artifact.id,
          inputName: 'VoiceId',
          graphData,
        })
      : null;
  const emotionSource =
    mediaType === 'audio'
      ? resolveAudioInputBindingSource({
          audioArtifactId: artifact.id,
          inputName: 'Emotion',
          graphData,
        })
      : null;

  const [emotionFromArtifact, setEmotionFromArtifact] = useState<
    string | undefined
  >(undefined);

  const emotionSourceArtifact =
    mediaType === 'audio' && emotionSource?.kind === 'artifact'
      ? artifacts.find((candidate) => candidate.id === emotionSource.artifactId)
      : undefined;
  const emotionSourceArtifactHash = emotionSourceArtifact?.hash;

  useEffect(() => {
    if (mediaType !== 'audio' || !emotionSourceArtifactHash) {
      setEmotionFromArtifact(undefined);
      return;
    }

    let cancelled = false;
    const emotionUrl = getBlobUrl(
      blueprintFolder,
      movieId,
      emotionSourceArtifactHash
    );

    const loadEmotion = async () => {
      try {
        const response = await fetch(emotionUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to load emotion source (${response.status} ${response.statusText})`
          );
        }
        const text = await response.text();
        if (!cancelled) {
          setEmotionFromArtifact(text.trim());
        }
      } catch {
        if (!cancelled) {
          setEmotionFromArtifact(undefined);
        }
      }
    };

    void loadEmotion();

    return () => {
      cancelled = true;
    };
  }, [blueprintFolder, emotionSourceArtifactHash, mediaType, movieId]);

  const initialVoiceId =
    mediaType === 'audio' && voiceSource?.kind === 'input'
      ? readStringInputValue(buildInputs, voiceSource.inputName)
      : undefined;
  const emotionFromInput =
    mediaType === 'audio' && emotionSource?.kind === 'input'
      ? readStringInputValue(buildInputs, emotionSource.inputName)
      : undefined;
  const initialEmotion =
    mediaType === 'audio' ? (emotionFromArtifact ?? emotionFromInput) : undefined;

  const footer = (
    <StoryboardArtifactCardFooter
      artifactId={artifact.id}
      displayName={displayName}
      downloadName={artifact.name}
      url={url}
      isEdited={isEdited}
      onEdit={() => setIsEditDialogOpen(true)}
      onRestore={
        isEdited
          ? async () => {
              await restoreArtifact(blueprintFolder, movieId, artifact.id);
              onArtifactUpdated?.();
            }
          : undefined
      }
      badge={<StoryboardCarryOverBadge item={item} />}
    />
  );

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    await editArtifactFile(blueprintFolder, movieId, artifact.id, files[0]!);
    onArtifactUpdated?.();
  };

  const handlePreviewApply = async (tempId: string) => {
    await applyArtifactPreview(blueprintFolder, movieId, artifact.id, tempId);
    onArtifactUpdated?.();
  };

  const handlePreviewCleanup = async (tempId: string) => {
    await deleteArtifactPreview(blueprintFolder, movieId, tempId);
  };

  const handleImagePreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof ImageEditDialog>['onRegenerate']>
    >[0]
  ) =>
    generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      cameraParams: params.cameraParams,
    });

  const handleImagePreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof ImageEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        cameraParams: params.cameraParams,
      }
    );
    return response.estimatedCost;
  };

  const handleVideoPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof VideoEditDialog>['onRegenerate']>
    >[0]
  ) =>
    generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      clipParams: params.clipParams,
      sourceTempId: params.sourceTempId,
    });

  const handleVideoPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof VideoEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        clipParams: params.clipParams,
      }
    );
    return response.estimatedCost;
  };

  const handleAudioPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof AudioEditDialog>['onRegenerate']>
    >[0]
  ) =>
    generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId: promptArtifact?.id,
      model: params.model,
      inputOverrides: params.inputOverrides,
    });

  const handleAudioPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof AudioEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId: promptArtifact?.id,
        model: params.model,
        inputOverrides: params.inputOverrides,
      }
    );
    return response.estimatedCost;
  };

  const handleMusicPreviewRegenerate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof MusicEditDialog>['onRegenerate']>
    >[0]
  ) =>
    generateArtifactPreview(blueprintFolder, movieId, artifact.id, {
      mode: params.mode,
      prompt: params.prompt,
      promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
      model: params.model,
      clipParams: params.clipParams,
      sourceTempId: params.sourceTempId,
    });

  const handleMusicPreviewEstimate = async (
    params: Parameters<
      NonNullable<ComponentProps<typeof MusicEditDialog>['onEstimateCost']>
    >[0]
  ) => {
    const response = await estimateArtifactPreview(
      blueprintFolder,
      movieId,
      artifact.id,
      {
        mode: params.mode,
        prompt: params.prompt,
        promptArtifactId: params.mode === 'rerun' ? promptArtifact?.id : undefined,
        model: params.model,
        clipParams: params.clipParams,
      }
    );
    return response.estimatedCost;
  };

  return (
    <>
      {mediaType === 'video' && (
        <VideoCard
          url={url}
          title={displayName}
          expandable
          promptTitle={promptDetails.title ?? promptLabel}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url ?? promptUrl}
          footer={footer}
        />
      )}
      {mediaType === 'image' && (
        <ImageCard
          url={url}
          title={displayName}
          promptTitle={promptDetails.title ?? promptLabel}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url ?? promptUrl}
          footer={footer}
        />
      )}
      {(mediaType === 'audio' || mediaType === 'music') && (
        <AudioCard
          url={url}
          title={displayName}
          expandable
          promptTitle={promptDetails.title ?? promptLabel}
          promptText={promptDetails.text}
          promptUrl={promptDetails.url ?? promptUrl}
          footer={footer}
        />
      )}

      {mediaType === 'image' ? (
        <ImageEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          imageUrl={url}
          title={`Edit Image — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleImagePreviewEstimate}
          onRegenerate={handleImagePreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : mediaType === 'video' ? (
        <VideoEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          videoUrl={url}
          title={`Edit Video — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleVideoPreviewEstimate}
          onRegenerate={handleVideoPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : mediaType === 'music' ? (
        <MusicEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          musicUrl={url}
          title={`Edit Music — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleMusicPreviewEstimate}
          onRegenerate={handleMusicPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      ) : (
        <AudioEditDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          audioUrl={url}
          title={`Edit Audio — ${displayName}`}
          availableModels={availableRerunModels}
          initialModel={initialModel}
          promptUrl={promptUrl}
          initialVoiceId={initialVoiceId}
          initialEmotion={initialEmotion}
          onFileUpload={handleFileUpload}
          onEstimateCost={handleAudioPreviewEstimate}
          onRegenerate={handleAudioPreviewRegenerate}
          onApplyGenerated={handlePreviewApply}
          onCleanupGenerated={handlePreviewCleanup}
        />
      )}
    </>
  );
}

function StoryboardPromptCard({
  promptCard,
  blueprintFolder,
  movieId,
  buildInputs,
  isInputsEditable,
  onSaveInputs,
  onArtifactUpdated,
}: {
  promptCard: StoryboardPromptCardModel;
  blueprintFolder: string | null;
  movieId: string | null;
  buildInputs: Record<string, unknown> | null;
  isInputsEditable: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
  onArtifactUpdated?: () => void;
}) {
  if (promptCard.kind === 'input') {
    return (
      <StoryboardInputTextCard
        item={promptCard.item}
        buildInputs={buildInputs}
        isEditable={isInputsEditable}
        onSaveInputs={onSaveInputs}
      />
    );
  }

  if (promptCard.kind === 'artifact-item') {
    return (
      <StoryboardArtifactTextCard
        artifact={promptCard.artifact}
        item={promptCard.item}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }

  const unexpectedPromptCard: never = promptCard;
  throw new Error(`Unsupported storyboard prompt card kind "${String(unexpectedPromptCard)}".`);
}

function StoryboardInputTextCard({
  item,
  buildInputs,
  isEditable,
  onSaveInputs,
}: {
  item: StoryboardItem;
  buildInputs: Record<string, unknown> | null;
  isEditable: boolean;
  onSaveInputs?: (values: Record<string, unknown>) => Promise<void>;
}) {
  const handleSave = useCallback(
    async (value: string) => {
      if (!onSaveInputs || !buildInputs) {
        throw new Error(`Cannot edit storyboard input "${item.id}" without loaded build inputs.`);
      }

      const nextInputPatch = createStoryboardInputPatch(
        buildInputs,
        item.identity.canonicalInputId,
        value
      );
      await onSaveInputs(nextInputPatch);
    },
    [buildInputs, item.id, item.identity.canonicalInputId, onSaveInputs]
  );

  return (
    <TextCard
      label={item.label}
      description={item.description}
      value={item.text?.value ?? ''}
      language={item.text?.language ?? 'markdown'}
      isEditable={isEditable && Boolean(onSaveInputs) && Boolean(buildInputs)}
      onChange={handleSave}
      sizing='aspect'
      dialogPreset='input-edit'
    />
  );
}

function StoryboardArtifactTextCard({
  artifact,
  item,
  fallbackTitle,
  blueprintFolder,
  movieId,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  item?: StoryboardItem;
  fallbackTitle?: string;
  blueprintFolder: string | null;
  movieId: string | null;
  onArtifactUpdated?: () => void;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const url =
    blueprintFolder && movieId
      ? getBlobUrl(blueprintFolder, movieId, artifact.hash)
      : null;
  const displayName =
    item?.label ?? fallbackTitle ?? humanizePromptArtifactLabel(artifact.id);
  const isEdited = artifact.editedBy === 'user';

  useEffect(() => {
    if (!url) {
      setContent(null);
      return;
    }

    let cancelled = false;

    const loadContent = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load prompt text (${response.status}).`);
        }
        const text = await response.text();
        if (!cancelled) {
          setContent(text);
        }
      } catch (error) {
        if (!cancelled) {
          setContent(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void loadContent();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || !blueprintFolder || !movieId) {
    return (
      <TextCard
        label={displayName}
        value=''
        language='markdown'
      />
    );
  }

  const handleSave = async (nextValue: string) => {
    setIsSaving(true);
    try {
      await editArtifactText(
        blueprintFolder,
        movieId,
        artifact.id,
        nextValue,
        artifact.mimeType
      );
      setIsEditDialogOpen(false);
      onArtifactUpdated?.();
    } finally {
      setIsSaving(false);
    }
  };

  const footer = (
    <StoryboardArtifactCardFooter
      artifactId={artifact.id}
      displayName={displayName}
      downloadName={artifact.name}
      url={url}
      isEdited={isEdited}
      onEdit={() => setIsEditDialogOpen(true)}
      onRestore={
        isEdited
          ? async () => {
              await restoreArtifact(blueprintFolder, movieId, artifact.id);
              onArtifactUpdated?.();
            }
          : undefined
      }
      badge={item ? <StoryboardCarryOverBadge item={item} /> : undefined}
    />
  );

  return (
    <>
      <MediaCard footer={footer}>
        <button
          type='button'
          onClick={() => setIsEditDialogOpen(true)}
          className='aspect-video w-full overflow-hidden bg-muted/30 p-4 text-left'
        >
          <pre className='h-full overflow-hidden whitespace-pre-wrap text-xs font-mono text-muted-foreground'>
            {content ?? 'Loading prompt...'}
          </pre>
        </button>
      </MediaCard>

      <TextEditorDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={displayName}
        content={content ?? ''}
        language='markdown'
        onSave={handleSave}
        isSaving={isSaving}
        preset='output-edit'
      />
    </>
  );
}

function StoryboardPlaceholderCard({ item }: { item: StoryboardItem }) {
  const toneClasses = getPlaceholderToneClasses(item.placeholderReason);
  const reasonLabel = getPlaceholderLabel(item.placeholderReason);
  const message =
    item.placeholderMessage ?? getPlaceholderMessage(item.placeholderReason);

  return (
    <MediaCard
      footer={
        <CardActionsFooter
          label={item.label}
          description={item.description}
          badge={<StoryboardCarryOverBadge item={item} />}
        />
      }
    >
      <div
        className={cn(
          'flex min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center',
          toneClasses.surface
        )}
      >
        <div className={cn('rounded-full border p-3', toneClasses.icon)}>
          {item.placeholderReason === 'error' ? (
            <AlertCircle className='size-5' />
          ) : item.placeholderReason === 'conditional-skip' ? (
            <SkipForward className='size-5' />
          ) : (
            <Clock3 className='size-5' />
          )}
        </div>
        <div className='space-y-1'>
          <div className='text-sm font-medium text-foreground'>{reasonLabel}</div>
          <div className='text-xs text-muted-foreground'>{message}</div>
        </div>
      </div>
    </MediaCard>
  );
}

function StoryboardCarryOverBadge({ item }: { item: StoryboardItem }) {
  if (item.dependencyClass !== 'carry-over') {
    return null;
  }

  return (
    <span className='inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300'>
      <CornerDownRight className='size-3' />
      Carry Over
    </span>
  );
}

function StoryboardArtifactCardFooter({
  artifactId,
  displayName,
  downloadName,
  url,
  isEdited,
  onEdit,
  onRestore,
  badge,
}: {
  artifactId: string;
  displayName: string;
  downloadName: string;
  url: string;
  isEdited: boolean;
  onEdit?: () => void;
  onRestore?: () => Promise<void>;
  badge?: ReactNode;
}) {
  const {
    isArtifactSelected,
    toggleArtifactSelection,
    isArtifactPinned,
    toggleArtifactPin,
  } = useExecution();
  const isSelected = isArtifactSelected(artifactId);
  const isPinned = isArtifactPinned(artifactId);

  const handleDownload = useCallback(() => {
    const element = document.createElement('a');
    element.href = url;
    element.download = downloadName;
    element.click();
  }, [downloadName, url]);

  const handleCopyUrl = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.origin + url);
  }, [url]);

  const handleOpenInNewTab = useCallback(() => {
    window.open(url, '_blank');
  }, [url]);

  const actions = useMemo((): CardAction[] => {
    const nextActions: CardAction[] = [];

    if (onEdit) {
      nextActions.push({
        id: 'edit',
        label: 'Edit',
        icon: Pencil,
        onClick: onEdit,
      });
    }

    if (isEdited && onRestore) {
      nextActions.push({
        id: 'restore',
        label: 'Restore Original',
        icon: RotateCcw,
        onClick: () => {
          void onRestore();
        },
      });
    }

    nextActions.push({
      id: 'regenerate',
      label: 'Generate Again',
      icon: RefreshCw,
      onClick: () => toggleArtifactSelection(artifactId),
      suffix: (
        <Check
          className={`size-4 ${isSelected ? 'text-primary' : 'invisible'}`}
        />
      ),
    });

    nextActions.push({
      id: 'pin',
      label: 'Keep (Pin)',
      icon: Pin,
      onClick: () => toggleArtifactPin(artifactId),
      suffix: (
        <Pin
          className={`size-4 ${isPinned ? 'text-amber-500' : 'invisible'}`}
        />
      ),
    });

    nextActions.push({
      id: 'download',
      label: 'Download',
      icon: Download,
      onClick: handleDownload,
      separator: true,
    });

    nextActions.push({
      id: 'open-new-tab',
      label: 'Open in new tab',
      icon: ExternalLink,
      onClick: handleOpenInNewTab,
    });

    nextActions.push({
      id: 'copy-url',
      label: 'Copy URL',
      icon: Copy,
      onClick: () => {
        void handleCopyUrl();
      },
    });

    return nextActions;
  }, [
    artifactId,
    handleCopyUrl,
    handleDownload,
    handleOpenInNewTab,
    isEdited,
    isPinned,
    isSelected,
    onEdit,
    onRestore,
    toggleArtifactPin,
    toggleArtifactSelection,
  ]);

  return (
    <CardActionsFooter
      label={displayName}
      actions={actions}
      badge={
        <>
          {badge}
          {isEdited ? <EditedBadge /> : null}
        </>
      }
    />
  );
}

function StoryboardConnectorLayer({ paths }: { paths: ConnectorPath[] }) {
  if (paths.length === 0) {
    return null;
  }

  return (
    <svg className='pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible'>
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill='none'
          strokeWidth={2}
          className={cn(
            'transition-colors',
            path.kind === 'carry-over'
              ? 'stroke-amber-500/45'
              : 'stroke-border/55'
          )}
        />
      ))}
    </svg>
  );
}

function buildItemById(projection: StoryboardProjection): Map<string, StoryboardItem> {
  const itemById = new Map<string, StoryboardItem>();
  for (const column of projection.columns) {
    for (const group of column.groups) {
      for (const item of group.items) {
        itemById.set(item.id, item);
      }
    }
  }
  return itemById;
}

function buildPromptSourcesByMediaId(
  projection: StoryboardProjection,
  itemById: Map<string, StoryboardItem>
): Map<string, StoryboardItem[]> {
  const promptSourcesByMediaId = new Map<string, StoryboardItem[]>();

  for (const connector of projection.connectors) {
    const sourceItem = itemById.get(connector.fromItemId);
    const targetItem = itemById.get(connector.toItemId);
    if (!sourceItem || !targetItem) {
      continue;
    }
    if (sourceItem.mediaType !== 'text' || targetItem.mediaType === 'text') {
      continue;
    }

    const existing = promptSourcesByMediaId.get(targetItem.id) ?? [];
    existing.push(sourceItem);
    promptSourcesByMediaId.set(targetItem.id, dedupePromptSources(existing));
  }

  return promptSourcesByMediaId;
}

function buildStoryboardLaneModels(args: {
  column: StoryboardColumn;
  laneTypes: StoryboardLaneType[];
  promptSourcesByMediaId: Map<string, StoryboardItem[]>;
  artifactById: Map<string, ArtifactInfo>;
}): StoryboardLaneModel[] {
  const items = args.column.groups.flatMap((group) => group.items);
  const mediaItems = items.filter((item) => item.mediaType !== 'text');

  return args.laneTypes
    .map((laneType) => {
      const laneItems = mediaItems
        .filter((item) => item.mediaType === laneType)
        .sort(sortStoryboardLaneItems)
        .map((item) => ({
          item,
          promptCards: buildPromptCardsForMedia({
            mediaItem: item,
            promptSourcesByMediaId: args.promptSourcesByMediaId,
            artifactById: args.artifactById,
          }),
        }));

      return {
        type: laneType,
        title: humanizeLaneType(laneType),
        entries: laneItems,
      } satisfies StoryboardLaneModel;
    })
    .filter((lane) => lane.entries.length > 0);
}

function buildPromptCardsForMedia(args: {
  mediaItem: StoryboardItem;
  promptSourcesByMediaId: Map<string, StoryboardItem[]>;
  artifactById: Map<string, ArtifactInfo>;
}): StoryboardPromptCardModel[] {
  const promptSources = args.promptSourcesByMediaId.get(args.mediaItem.id) ?? [];
  const promptCards: StoryboardPromptCardModel[] = [];

  for (const promptSource of promptSources) {
    if (promptSource.kind === 'input-text') {
      promptCards.push({
        key: `${args.mediaItem.id}:input:${promptSource.id}`,
        kind: 'input',
        item: promptSource,
      });
      continue;
    }

    if (promptSource.kind === 'artifact-text') {
      const promptArtifactId = promptSource.identity.canonicalArtifactId;
      if (!promptArtifactId) {
        continue;
      }
      const promptArtifact = args.artifactById.get(promptArtifactId);
      if (!promptArtifact) {
        continue;
      }

      promptCards.push({
        key: `${args.mediaItem.id}:artifact-item:${promptSource.id}`,
        kind: 'artifact-item',
        item: promptSource,
        artifact: promptArtifact,
      });
    }
  }

  return promptCards;
}

function sortStoryboardLaneItems(left: StoryboardItem, right: StoryboardItem): number {
  const leftPriority = getStoryboardLaneItemPriority(left);
  const rightPriority = getStoryboardLaneItemPriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.label.localeCompare(right.label);
}

function getStoryboardLaneItemPriority(item: StoryboardItem): number {
  if (item.kind === 'placeholder' || item.kind.startsWith('artifact-')) {
    return 0;
  }
  if (item.dependencyClass === 'carry-over') {
    return 1;
  }
  return 2;
}

function dedupePromptSources(promptSources: StoryboardItem[]): StoryboardItem[] {
  const deduped = new Map<string, StoryboardItem>();
  for (const item of promptSources) {
    deduped.set(item.id, item);
  }
  return Array.from(deduped.values());
}

function resolveMediaPromptDetails(
  promptCards: StoryboardPromptCardModel[],
  blueprintFolder: string | null,
  movieId: string | null
): StoryboardMediaPromptDetails {
  if (promptCards.length === 0) {
    return {};
  }

  const promptTexts = promptCards
    .map((promptCard) => promptCard.item.text?.value?.trim() ?? '')
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const title =
    promptCards.length === 1
      ? promptCards[0]!.item.label
      : 'Prompts';
  const artifactPromptCard =
    promptCards.length === 1 && promptCards[0]!.kind === 'artifact-item'
      ? promptCards[0]!
      : null;

  if (promptTexts.length > 0) {
    return {
      title,
      text: promptTexts.join('\n\n'),
      artifactId: artifactPromptCard?.artifact.id,
    };
  }

  if (artifactPromptCard && blueprintFolder && movieId) {
    return {
      title,
      url: getBlobUrl(blueprintFolder, movieId, artifactPromptCard.artifact.hash),
      artifactId: artifactPromptCard.artifact.id,
    };
  }

  return {
    title,
    artifactId: artifactPromptCard?.artifact.id,
  };
}

function resolveMediaUrl(
  item: StoryboardItem,
  blueprintFolder: string | null,
  movieId: string | null
): string | null {
  if (!item.media) {
    return null;
  }

  if (item.media.hash && blueprintFolder && movieId) {
    return getBlobUrl(blueprintFolder, movieId, item.media.hash);
  }

  const fileRef = parseFileRef(item.media.value);
  if (fileRef && blueprintFolder && movieId) {
    return buildInputFileUrl(blueprintFolder, movieId, fileRef);
  }

  if (
    typeof item.media.value === 'string' &&
    /^(https?:)?\/\//.test(item.media.value)
  ) {
    return item.media.value;
  }

  return null;
}

function getPlaceholderToneClasses(
  placeholderReason: StoryboardItem['placeholderReason']
): {
  surface: string;
  icon: string;
} {
  switch (placeholderReason) {
    case 'error':
      return {
        surface: 'bg-red-500/8',
        icon: 'border-red-500/35 bg-red-500/12 text-red-700 dark:text-red-300',
      };
    case 'conditional-skip':
      return {
        surface: 'bg-amber-500/10',
        icon: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      };
    default:
      return {
        surface: 'bg-emerald-500/8',
        icon:
          'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
  }
}

function getPlaceholderLabel(
  placeholderReason: StoryboardItem['placeholderReason']
): string {
  switch (placeholderReason) {
    case 'error':
      return 'Error';
    case 'conditional-skip':
      return 'Skipped';
    default:
      return 'Not Run Yet';
  }
}

function getPlaceholderMessage(
  placeholderReason: StoryboardItem['placeholderReason']
): string {
  switch (placeholderReason) {
    case 'error':
      return 'This step could not be generated because the run hit an error.';
    case 'conditional-skip':
      return 'This step was skipped because its condition evaluated to false.';
    default:
      return 'This step has not been generated yet.';
  }
}

function humanizeLaneType(laneType: StoryboardLaneType): string {
  return laneType === 'video'
    ? 'Video'
    : laneType === 'image'
      ? 'Image'
      : 'Audio';
}

function toStoryboardMediaInputType(mediaType: StoryboardItem['mediaType']): StoryboardLaneType {
  if (mediaType === 'video' || mediaType === 'image' || mediaType === 'audio') {
    return mediaType;
  }
  throw new Error(`Storyboard media item requires image, video, or audio media type. Received "${mediaType}".`);
}

function resolveStoryboardAudioMediaType(args: {
  artifact: ArtifactInfo;
  graphData?: BlueprintGraphData;
  producerModels: Record<string, ProducerModelInfo>;
  defaultType: StoryboardItem['mediaType'];
}): StoryboardLaneType | StoryboardAudioMediaType {
  if (args.defaultType !== 'audio') {
    return toStoryboardMediaInputType(args.defaultType);
  }

  const artifactProducerAlias = extractProducerFromArtifactId(args.artifact.id);
  if (!artifactProducerAlias) {
    return 'audio';
  }

  const producerTypeFromModels =
    args.producerModels[artifactProducerAlias]?.producerType;
  if (producerTypeFromModels === 'audio/text-to-music') {
    return 'music';
  }

  const producerTypeFromGraph = args.graphData?.nodes.find(
    (node) =>
      node.type === 'producer' &&
      (node.id === `Producer:${artifactProducerAlias}` ||
        node.label === artifactProducerAlias)
  )?.producerType;

  if (producerTypeFromGraph === 'audio/text-to-music') {
    return 'music';
  }

  return 'audio';
}

function readStringInputValue(
  buildInputs: Record<string, unknown> | null | undefined,
  key: string | undefined
): string | undefined {
  if (!buildInputs || !key) {
    return undefined;
  }
  const value = buildInputs[key];
  return typeof value === 'string' ? value : undefined;
}

function createStoryboardInputPatch(
  buildInputs: Record<string, unknown>,
  canonicalInputId: string | undefined,
  nextValue: unknown
): Record<string, unknown> {
  if (!canonicalInputId) {
    throw new Error('Storyboard input card is missing a canonical input id.');
  }

  const address = parseStoryboardInputAddress(canonicalInputId);
  if (address.index === null) {
    return {
      [address.canonicalInputId]: nextValue,
    };
  }

  const currentValue = buildInputs[address.canonicalInputId];
  if (!Array.isArray(currentValue)) {
    throw new Error(
      `Storyboard input "${address.canonicalInputId}" must be an array to update index ${address.index}.`
    );
  }

  const nextArray = [...currentValue];
  nextArray[address.index] = nextValue;
  return {
    [address.canonicalInputId]: nextArray,
  };
}

function parseStoryboardInputAddress(canonicalInputId: string): {
  canonicalInputId: string;
  index: number | null;
} {
  if (!canonicalInputId.startsWith('Input:')) {
    throw new Error(`Expected canonical storyboard input id, received "${canonicalInputId}".`);
  }

  const match = canonicalInputId.match(/^(Input:.+?)(?:\[(\d+)\])?$/);
  if (!match || !match[1]) {
    throw new Error(`Could not parse storyboard input id "${canonicalInputId}".`);
  }

  return {
    canonicalInputId: match[1],
    index: match[2] ? Number(match[2]) : null,
  };
}

function shortenPromptArtifactLabel(artifactId: string): string {
  const withoutPrefix = artifactId.replace(/^Artifact:/, '');
  const firstDotIndex = withoutPrefix.indexOf('.');
  return firstDotIndex === -1
    ? withoutPrefix
    : withoutPrefix.slice(firstDotIndex + 1);
}

function humanizePromptArtifactLabel(artifactId: string): string {
  return shortenPromptArtifactLabel(artifactId)
    .replace(/\[\d+\]/g, '')
    .split('.')
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
    )
    .join(' ');
}
