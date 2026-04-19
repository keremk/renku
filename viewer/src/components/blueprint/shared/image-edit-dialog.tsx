import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  RotateCcw,
  Pencil,
  Video,
  Upload,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { FileRejection } from 'react-dropzone';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropzoneArea, formatRejectionErrors } from '../inputs/dropzone-area';
import { SelectedFilePreview } from '../inputs/file-preview';
import { useMediaPrompt } from './use-media-prompt';
import { CameraControl } from './camera-control';
import { generateShotDescription, type CameraParams } from './camera-utils';
import type { AvailableModelOption } from '@/types/blueprint-graph';

export interface RegenerateParams {
  mode: 'rerun' | 'edit' | 'camera';
  prompt: string;
  model?: AvailableModelOption;
  cameraParams?: CameraParams;
}

export interface RegenerateResult {
  previewUrl: string;
  tempId: string;
  estimatedCost: {
    cost: number;
    minCost: number;
    maxCost: number;
    isPlaceholder: boolean;
    note?: string;
  };
}

export interface ImageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  title: string;
  availableModels: AvailableModelOption[];
  availableEditModels?: AvailableModelOption[];
  initialModel?: AvailableModelOption;
  promptUrl?: string;
  promptArtifactId?: string;
  onFileUpload: (files: File[]) => Promise<void>;
  onEstimateCost?: (
    params: RegenerateParams
  ) => Promise<RegenerateResult['estimatedCost']>;
  onRegenerate?: (params: RegenerateParams) => Promise<RegenerateResult>;
  onApplyGenerated?: (tempId: string) => Promise<void>;
  onCleanupGenerated?: (tempId: string) => Promise<void>;
}

type TabId = 'rerun' | 'edit' | 'camera' | 'upload';

const TABS: { id: TabId; label: string; icon: typeof RotateCcw }[] = [
  { id: 'rerun', label: 'Re-run', icon: RotateCcw },
  { id: 'edit', label: 'Edit', icon: Pencil },
  { id: 'camera', label: 'Reframe', icon: Video },
  { id: 'upload', label: 'Upload', icon: Upload },
];

const DEFAULT_CAMERA_PARAMS: CameraParams = {
  azimuth: 0,
  elevation: 0,
  distance: 1,
  shotDescription: generateShotDescription(0, 0, 1),
};

function formatCurrency(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatEstimatedCost(
  estimatedCost: RegenerateResult['estimatedCost']
): string {
  const min = estimatedCost.minCost;
  const max = estimatedCost.maxCost;
  if (min !== max) {
    return `${formatCurrency(min)}-${formatCurrency(max)}`;
  }
  return formatCurrency(estimatedCost.cost);
}

function findModelIndex(
  models: AvailableModelOption[],
  initialModel?: AvailableModelOption
): number {
  if (!initialModel) {
    return -1;
  }

  return models.findIndex(
    (model) =>
      model.provider === initialModel.provider &&
      model.model === initialModel.model
  );
}

function RegenerateButton({
  onClick,
  isRegenerating,
  disabled,
  className,
}: {
  onClick: () => void;
  isRegenerating: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={isRegenerating || disabled}
      className={cn(
        'bg-primary/15 text-primary border border-primary/50',
        'font-semibold text-[10px] uppercase tracking-widest',
        'hover:bg-primary/25 transition-colors',
        'px-3.5 h-[34px] rounded-lg flex items-center gap-1.5 justify-center',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
    >
      {isRegenerating ? (
        <>
          <Loader2 className='size-3.5 animate-spin' />
          REGENERATING...
        </>
      ) : (
        <>
          <RefreshCw className='size-3.5' />
          REGENERATE
        </>
      )}
    </button>
  );
}

function ImagePreview({ url, title }: { url: string; title: string }) {
  return (
    <div className='flex-1 rounded-xl bg-muted/30 dark:bg-black/50 overflow-hidden flex items-center justify-center min-h-[120px]'>
      <img
        src={url}
        alt={title}
        className='w-full h-full object-contain'
        loading='lazy'
      />
    </div>
  );
}

function UploadTab({
  selectedFiles,
  onFilesSelected,
  onFilesRejected,
  onRemoveFile,
  error,
}: {
  selectedFiles: File[];
  onFilesSelected: (files: File[]) => void;
  onFilesRejected: (rejections: FileRejection[]) => void;
  onRemoveFile: (index: number) => void;
  error: string | null;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <DropzoneArea
        mediaType='image'
        multiple={false}
        onFilesSelected={onFilesSelected}
        onFilesRejected={onFilesRejected}
        className='w-full'
      />

      {error && (
        <div className='bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive'>
          {error}
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className='space-y-2'>
          <p className='text-sm text-muted-foreground'>
            Selected files ({selectedFiles.length}):
          </p>
          <div className='grid grid-cols-4 gap-3'>
            {selectedFiles.map((file, index) => (
              <SelectedFilePreview
                key={`${file.name}-${index}`}
                file={file}
                onRemove={() => onRemoveFile(index)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useSelectedFilePreview(file: File | null): string | null {
  const previewUrl = useMemo(() => {
    if (!file) {
      return null;
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    if (!previewUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return previewUrl;
}

function useRegenerationCostEstimate({
  open,
  activeTab,
  availableRerunModels,
  selectedRerunModelIndex,
  availableEditModels,
  selectedEditModelIndex,
  onEstimateCost,
  setEstimatedCost,
  setIsEstimatingCost,
}: {
  open: boolean;
  activeTab: TabId;
  availableRerunModels: AvailableModelOption[];
  selectedRerunModelIndex: number;
  availableEditModels: AvailableModelOption[];
  selectedEditModelIndex: number;
  onEstimateCost?: (
    params: RegenerateParams
  ) => Promise<RegenerateResult['estimatedCost']>;
  setEstimatedCost: Dispatch<
    SetStateAction<RegenerateResult['estimatedCost'] | null>
  >;
  setIsEstimatingCost: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    if (!open || activeTab === 'upload' || !onEstimateCost) {
      setIsEstimatingCost(false);
      return;
    }

    let params: RegenerateParams | null = null;

    if (activeTab === 'rerun') {
      const selectedModel = availableRerunModels[selectedRerunModelIndex];
      params = {
        mode: 'rerun',
        prompt: '',
        ...(selectedModel ? { model: selectedModel } : {}),
      };
    } else if (activeTab === 'edit') {
      const selectedModel = availableEditModels[selectedEditModelIndex];
      if (!selectedModel) {
        setEstimatedCost(null);
        setIsEstimatingCost(false);
        return;
      }

      params = {
        mode: 'edit',
        prompt: '',
        model: selectedModel,
      };
    } else {
      params = {
        mode: 'camera',
        prompt: '',
        cameraParams: DEFAULT_CAMERA_PARAMS,
      };
    }

    let cancelled = false;
    setIsEstimatingCost(true);

    const estimateCost = async () => {
      try {
        const nextEstimatedCost = await onEstimateCost(params);
        if (cancelled) {
          return;
        }
        setEstimatedCost(nextEstimatedCost);
      } catch {
        if (!cancelled) {
          setEstimatedCost(null);
        }
      } finally {
        if (!cancelled) {
          setIsEstimatingCost(false);
        }
      }
    };

    void estimateCost();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    availableEditModels,
    availableRerunModels,
    onEstimateCost,
    open,
    selectedEditModelIndex,
    selectedRerunModelIndex,
    setEstimatedCost,
    setIsEstimatingCost,
  ]);
}

export function ImageEditDialog({
  open,
  onOpenChange,
  imageUrl,
  title,
  availableModels,
  availableEditModels,
  initialModel,
  promptUrl,
  promptArtifactId,
  onFileUpload,
  onEstimateCost,
  onRegenerate,
  onApplyGenerated,
  onCleanupGenerated,
}: ImageEditDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('rerun');

  const [rerunPrompt, setRerunPrompt] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [selectedRerunModelIndex, setSelectedRerunModelIndex] = useState(0);
  const [selectedEditModelIndex, setSelectedEditModelIndex] = useState(0);
  const [cameraParams, setCameraParams] = useState<CameraParams>(
    DEFAULT_CAMERA_PARAMS
  );

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(
    null
  );
  const [generatedTempId, setGeneratedTempId] = useState<string | null>(null);
  const [estimatedCost, setEstimatedCost] = useState<
    RegenerateResult['estimatedCost'] | null
  >(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isApplyingGenerated, setIsApplyingGenerated] = useState(false);

  const { promptText } = useMediaPrompt(promptUrl, open);
  const rerunModels = availableModels;
  const editModels = availableEditModels ?? availableModels;
  const rerunModelsRef = useRef(rerunModels);
  const editModelsRef = useRef(editModels);
  const initialModelRef = useRef(initialModel);

  useEffect(() => {
    rerunModelsRef.current = rerunModels;
  }, [rerunModels]);

  useEffect(() => {
    editModelsRef.current = editModels;
  }, [editModels]);

  useEffect(() => {
    initialModelRef.current = initialModel;
  }, [initialModel]);

  useEffect(() => {
    if (!open || !promptArtifactId || !promptText) {
      return;
    }

    setRerunPrompt((prev) => (prev === '' ? promptText : prev));
  }, [open, promptArtifactId, promptText]);

  useEffect(() => {
    if (!open || promptArtifactId) {
      return;
    }

    setRerunPrompt('');
  }, [open, promptArtifactId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab('rerun');
    setRerunPrompt('');
    setEditPrompt('');
    const matchingRerunModelIndex = findModelIndex(
      rerunModelsRef.current,
      initialModelRef.current
    );
    const matchingEditModelIndex = findModelIndex(
      editModelsRef.current,
      initialModelRef.current
    );
    setSelectedRerunModelIndex(
      matchingRerunModelIndex >= 0 ? matchingRerunModelIndex : 0
    );
    setSelectedEditModelIndex(
      matchingEditModelIndex >= 0 ? matchingEditModelIndex : 0
    );
    setCameraParams(DEFAULT_CAMERA_PARAMS);
    setSelectedFiles([]);
    setUploadError(null);
    setGeneratedPreviewUrl(null);
    setGeneratedTempId(null);
    setEstimatedCost(null);
    setGenerationError(null);
    setIsEstimatingCost(false);
    setIsRegenerating(false);
    setIsUploading(false);
    setIsApplyingGenerated(false);
  }, [imageUrl, open, initialModel?.model, initialModel?.provider]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedRerunModelIndex((prev) => {
      if (rerunModels[prev]) {
        return prev;
      }

      const matchingIndex = findModelIndex(rerunModels, initialModel);
      return matchingIndex >= 0 ? matchingIndex : 0;
    });

    setSelectedEditModelIndex((prev) => {
      if (editModels[prev]) {
        return prev;
      }

      const matchingIndex = findModelIndex(editModels, initialModel);
      return matchingIndex >= 0 ? matchingIndex : 0;
    });
  }, [open, rerunModels, editModels, initialModel]);

  const selectedUploadPreviewUrl = useSelectedFilePreview(
    selectedFiles[0] ?? null
  );
  const canOverrideRerunPrompt = Boolean(promptArtifactId);

  useRegenerationCostEstimate({
    open,
    activeTab,
    availableRerunModels: rerunModels,
    selectedRerunModelIndex,
    availableEditModels: editModels,
    selectedEditModelIndex,
    onEstimateCost,
    setEstimatedCost,
    setIsEstimatingCost,
  });

  const getParamsForTab = useCallback(
    (tab: Exclude<TabId, 'upload'>): RegenerateParams | null => {
      if (tab === 'rerun') {
        const selectedModel = rerunModels[selectedRerunModelIndex];
        return {
          mode: 'rerun',
          prompt: canOverrideRerunPrompt ? rerunPrompt : '',
          ...(selectedModel ? { model: selectedModel } : {}),
        };
      }

      if (tab === 'edit') {
        const selectedModel = editModels[selectedEditModelIndex];
        if (!selectedModel) {
          return null;
        }
        return {
          mode: 'edit',
          prompt: editPrompt,
          model: selectedModel,
        };
      }

      return {
        mode: 'camera',
        prompt: '',
        cameraParams,
      };
    },
    [
      cameraParams,
      editModels,
      editPrompt,
      canOverrideRerunPrompt,
      rerunModels,
      rerunPrompt,
      selectedEditModelIndex,
      selectedRerunModelIndex,
    ]
  );

  const currentPrompt = activeTab === 'rerun' ? rerunPrompt : editPrompt;

  const setCurrentPrompt = useCallback(
    (value: string) => {
      if (activeTab === 'rerun') {
        setRerunPrompt(value);
        return;
      }
      setEditPrompt(value);
    },
    [activeTab]
  );

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate || activeTab === 'upload') {
      return;
    }

    if (activeTab === 'edit' && editModels.length === 0) {
      setGenerationError('No models are available for edit preview.');
      return;
    }

    const params = getParamsForTab(activeTab);
    if (!params) {
      setGenerationError('Could not resolve preview parameters.');
      return;
    }

    setIsRegenerating(true);
    setGenerationError(null);

    try {
      if (generatedTempId) {
        if (!onCleanupGenerated) {
          throw new Error(
            'Cannot regenerate because preview cleanup is not configured.'
          );
        }
        await onCleanupGenerated(generatedTempId);
        setGeneratedTempId(null);
        setGeneratedPreviewUrl(null);
      }

      const result = await onRegenerate(params);
      setGeneratedPreviewUrl(result.previewUrl);
      setGeneratedTempId(result.tempId);
      setEstimatedCost(result.estimatedCost);
    } catch (error) {
      setGeneratedPreviewUrl(null);
      setGeneratedTempId(null);
      setGenerationError(
        error instanceof Error ? error.message : 'Regeneration failed'
      );
    } finally {
      setIsRegenerating(false);
    }
  }, [
    activeTab,
    editModels.length,
    generatedTempId,
    getParamsForTab,
    onCleanupGenerated,
    onRegenerate,
  ]);

  const handleFilesSelected = useCallback((files: File[]) => {
    setUploadError(null);
    setSelectedFiles(files.slice(0, 1));
  }, []);

  const handleFilesRejected = useCallback((rejections: FileRejection[]) => {
    setUploadError(formatRejectionErrors(rejections));
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdate = useCallback(async () => {
    if (activeTab === 'upload' && selectedFiles.length > 0) {
      setIsUploading(true);
      setUploadError(null);
      try {
        if (generatedTempId) {
          if (!onCleanupGenerated) {
            throw new Error(
              'Cannot upload while generated preview cleanup is unavailable.'
            );
          }
          await onCleanupGenerated(generatedTempId);
          setGeneratedTempId(null);
          setGeneratedPreviewUrl(null);
        }
        await onFileUpload(selectedFiles);
        setSelectedFiles([]);
        onOpenChange(false);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if (activeTab !== 'upload' && generatedTempId) {
      setIsApplyingGenerated(true);
      setGenerationError(null);
      try {
        if (!onApplyGenerated) {
          throw new Error('Generated preview apply handler is not configured.');
        }
        await onApplyGenerated(generatedTempId);
        if (onCleanupGenerated) {
          await onCleanupGenerated(generatedTempId);
        }
        setGeneratedTempId(null);
        setGeneratedPreviewUrl(null);
        onOpenChange(false);
      } catch (error) {
        setGenerationError(
          error instanceof Error ? error.message : 'Failed to apply preview'
        );
      } finally {
        setIsApplyingGenerated(false);
      }
    }
  }, [
    activeTab,
    generatedTempId,
    onApplyGenerated,
    onCleanupGenerated,
    onFileUpload,
    onOpenChange,
    selectedFiles,
  ]);

  const handleClose = useCallback(() => {
    if (isUploading || isApplyingGenerated) {
      return;
    }

    const closeWithCleanup = async () => {
      try {
        if (generatedTempId) {
          if (!onCleanupGenerated) {
            throw new Error(
              'Cannot close with pending preview because cleanup is not configured.'
            );
          }
          await onCleanupGenerated(generatedTempId);
          setGeneratedTempId(null);
          setGeneratedPreviewUrl(null);
        }
        onOpenChange(false);
      } catch (error) {
        setGenerationError(
          error instanceof Error ? error.message : 'Failed to clean up preview'
        );
      }
    };

    void closeWithCleanup();
  }, [
    generatedTempId,
    isApplyingGenerated,
    isUploading,
    onCleanupGenerated,
    onOpenChange,
  ]);

  const canRegenerate =
    Boolean(onRegenerate) &&
    !isApplyingGenerated &&
    !isUploading &&
    (activeTab !== 'edit' || editModels.length > 0);

  const isUpdateDisabled =
    activeTab === 'upload'
      ? selectedFiles.length === 0 || isUploading || isApplyingGenerated
      : generatedTempId === null ||
        isRegenerating ||
        isApplyingGenerated ||
        isUploading;

  const showPrompt = activeTab === 'rerun' || activeTab === 'edit';

  const previewImageUrl = generatedPreviewUrl ?? imageUrl;

  const displayedPreviewUrl =
    activeTab === 'upload' && selectedUploadPreviewUrl
      ? selectedUploadPreviewUrl
      : previewImageUrl;

  const costText = useMemo(() => {
    if (activeTab === 'upload') {
      return '';
    }
    if (estimatedCost) {
      return `Estimated cost: ${formatEstimatedCost(estimatedCost)}`;
    }
    if (isEstimatingCost) {
      return 'Estimating cost...';
    }
    return 'Estimated cost unavailable';
  }, [activeTab, estimatedCost, isEstimatingCost]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'w-[960px] h-[800px] max-w-[960px] max-h-[900px]',
          'p-0 gap-0 overflow-hidden flex flex-col'
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className='sr-only'>
            Re-run, edit, reframe, or upload a replacement image.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as TabId)}
          className='gap-0'
        >
          <TabsList
            variant='line'
            className='flex w-full h-auto shrink-0 items-stretch justify-start rounded-none text-inherit border-b border-border/40 bg-panel-header-bg px-3 py-0 gap-0'
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  data-tab={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative px-3.5 h-[38px] border-none bg-transparent rounded-none flex-none',
                    'font-[inherit] text-[10px] uppercase tracking-[0.12em] font-semibold',
                    'cursor-pointer flex items-center gap-1.5 transition-colors',
                    'text-muted-foreground hover:text-foreground',
                    'data-[state=active]:text-foreground data-[state=active]:bg-primary/8',
                    'data-[state=active]:border-none dark:data-[state=active]:border-none dark:data-[state=active]:bg-primary/8',
                    'focus-visible:ring-0 focus-visible:border-none focus-visible:outline-none shadow-none after:hidden'
                  )}
                >
                  <Icon className='size-3.5' />
                  {tab.label}
                  {isActive && (
                    <span className='absolute bottom-0 left-1.5 right-1.5 h-0.5 bg-primary rounded-t-sm' />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        <div className='flex-1 flex min-h-0 overflow-hidden'>
          <div className='flex-1 p-3 min-w-0 flex'>
            <ImagePreview url={displayedPreviewUrl} title={title} />
          </div>

          <aside className='w-[340px] shrink-0 border-l border-border/40 p-3 flex flex-col gap-3 overflow-y-auto'>
            {activeTab === 'upload' ? (
              <UploadTab
                selectedFiles={selectedFiles}
                onFilesSelected={handleFilesSelected}
                onFilesRejected={handleFilesRejected}
                onRemoveFile={handleRemoveFile}
                error={uploadError}
              />
            ) : (
              <>
                {activeTab === 'camera' && (
                  <div className='rounded-lg border border-border/40 p-2.5 bg-muted/20'>
                    <CameraControl
                      params={cameraParams}
                      onChange={setCameraParams}
                    />
                  </div>
                )}

                {showPrompt && (
                  <div className='flex flex-col gap-1.5'>
                    <div className='flex items-center justify-between'>
                      <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                        Prompt
                      </span>
                      <span className='text-[9px] text-muted-foreground/60 tabular-nums'>
                        {currentPrompt.length} chars
                      </span>
                    </div>
                    <textarea
                      value={currentPrompt}
                      onChange={(e) => setCurrentPrompt(e.target.value)}
                      disabled={activeTab === 'rerun' && !canOverrideRerunPrompt}
                      placeholder={
                        activeTab === 'rerun'
                          ? canOverrideRerunPrompt
                            ? 'Optional prompt tweak before re-running...'
                            : 'Prompt overrides are unavailable for this artifact right now. Re-run will use the original prompt as-is.'
                          : 'Describe only the changes you want to apply to the current image (for example: "add warm sunset lighting").'
                      }
                      className={cn(
                        'w-full resize-none bg-muted/30 border border-border/40 text-foreground',
                        'font-[inherit] text-[11px] leading-relaxed px-2.5 py-2 rounded-lg outline-none',
                        'focus:border-primary/50 focus:ring-2 focus:ring-primary/20',
                        'overflow-y-auto min-h-[120px]',
                        activeTab === 'rerun' && !canOverrideRerunPrompt
                          ? 'cursor-not-allowed opacity-60'
                          : undefined
                      )}
                    />
                  </div>
                )}

                {(activeTab === 'rerun' || activeTab === 'edit') && (
                  <div className='flex flex-col gap-1.5'>
                    <span className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                      Model
                    </span>
                    {(activeTab === 'rerun' ? rerunModels : editModels).length >
                    0 ? (
                      <select
                        value={
                          activeTab === 'rerun'
                            ? selectedRerunModelIndex
                            : selectedEditModelIndex
                        }
                        onChange={(e) =>
                          activeTab === 'rerun'
                            ? setSelectedRerunModelIndex(
                                Number(e.target.value)
                              )
                            : setSelectedEditModelIndex(
                                Number(e.target.value)
                              )
                        }
                        className={cn(
                          'bg-muted/30 border border-border/40 text-foreground',
                          'font-[inherit] text-[11px] px-2 h-[34px] rounded-lg outline-none cursor-pointer',
                          'focus:border-primary/50'
                        )}
                      >
                        {(activeTab === 'rerun'
                          ? rerunModels
                          : editModels
                        ).map((model, idx) => (
                          <option
                            key={`${model.provider}/${model.model}`}
                            value={idx}
                          >
                            {model.model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className='text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-2.5 py-2'>
                        No image models available.
                      </div>
                    )}
                  </div>
                )}

                <div className='text-[11px] text-muted-foreground min-h-4'>
                  {costText}
                </div>

                <RegenerateButton
                  onClick={handleRegenerate}
                  isRegenerating={isRegenerating}
                  disabled={!canRegenerate}
                  className='w-full'
                />
              </>
            )}
          </aside>
        </div>

        {activeTab !== 'upload' && generationError && (
          <div className='px-3 pb-2'>
            <div className='bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-xs text-destructive'>
              {generationError}
            </div>
          </div>
        )}

        <DialogFooter className='justify-end'>
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              onClick={handleClose}
              disabled={isUploading || isApplyingGenerated}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={isUpdateDisabled}>
              {isUploading ? (
                <>
                  <Loader2 className='size-4 animate-spin' />
                  Uploading...
                </>
              ) : isApplyingGenerated ? (
                <>
                  <Loader2 className='size-4 animate-spin' />
                  Updating...
                </>
              ) : (
                'Update'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
