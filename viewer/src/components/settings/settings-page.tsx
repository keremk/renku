import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, House, Loader2, Save } from 'lucide-react';
import { ViewerPageHeader } from '@/components/layout/viewer-page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PropertyRow } from '@/components/blueprint/shared/property-row';
import { cn } from '@/lib/utils';
import {
  browseFolder,
  getBrowseFolderSupport,
  type BrowseFolderSupport,
} from '@/data/onboarding-client';
import {
  fetchViewerSettings,
  updateViewerApiTokens,
  updateViewerArtifactsSettings,
  updateViewerConcurrency,
  updateViewerStorageRoot,
  type ViewerArtifactsSettings,
  type SettingsApiTokens,
  type StorageRootUpdateMode,
  type ViewerSettingsSnapshot,
} from '@/data/settings-client';
import { navigateToPath } from '@/hooks/use-blueprint-route';

const EMPTY_TOKENS: SettingsApiTokens = {
  fal: '',
  replicate: '',
  elevenlabs: '',
  openai: '',
  vercelGateway: '',
};

type SettingsTab = 'general' | 'tokens';
type ArtifactOutputOption = 'disabled' | 'copy' | 'symlink';

interface ProviderTokenField {
  key: keyof SettingsApiTokens;
  label: string;
  description: string;
}

const ARTIFACT_OUTPUT_PATH_PATTERN =
  '<blueprint>/artifacts/<friendly-name-or-movieId>/...';

const PROVIDER_TOKEN_FIELDS: ProviderTokenField[] = [
  {
    key: 'fal',
    label: 'Fal',
    description: 'Used for Fal provided models.',
  },
  {
    key: 'replicate',
    label: 'Replicate',
    description: 'Used for Replicate provided models.',
  },
  {
    key: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Used for ElevenLabs provided models.',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    description: 'Used for OpenAI provided models for creating prompts.',
  },
  {
    key: 'vercelGateway',
    label: 'Vercel AI Gateway',
    description: 'Used for Vercel AI Gateway provided models.',
  },
];

const SETTINGS_CONTENT_WIDTH_CLASS = 'mx-auto w-full max-w-4xl space-y-4';
const SETTINGS_ROWS_STACK_CLASS = 'space-y-4';
const SETTINGS_PROPERTY_ROW_CLASS = 'max-w-none w-full';
const SETTINGS_CONTROL_ROW_NOWRAP_CLASS = 'flex items-center gap-2';
const SETTINGS_CONTROL_ROW_CLASS = 'flex flex-wrap items-center gap-2';
const SETTINGS_INPUT_CLASS =
  'h-8 text-xs font-mono bg-muted/30 border-border/50 focus:bg-background focus:border-primary/50';
const SETTINGS_SELECT_TRIGGER_CLASS =
  'h-8 w-full max-w-[230px] text-xs font-mono bg-muted/30 border-border/50 focus:bg-background focus:border-primary/50';
const SETTINGS_STATUS_MUTED_CLASS = 'text-xs text-muted-foreground';
const SETTINGS_STATUS_SUCCESS_CLASS =
  'text-xs text-emerald-700 dark:text-emerald-300';
const SETTINGS_ACTION_ROW_CLASS = 'pt-1 flex justify-end';
const SETTINGS_PROVIDER_LABEL_CLASS = 'text-sm font-semibold text-foreground';
const SETTINGS_ARTIFACT_PATH_CLASS =
  'font-mono text-[11px] text-muted-foreground mt-1 block';
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 10;
const CONCURRENCY_DEBOUNCE_MS = 700;

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<ViewerSettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isSavingStorageRoot, setIsSavingStorageRoot] = useState(false);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [dialogStorageError, setDialogStorageError] = useState<string | null>(
    null
  );

  const [confirmStorageChangeOpen, setConfirmStorageChangeOpen] =
    useState(false);
  const [dialogStorageRoot, setDialogStorageRoot] = useState('');
  const [dialogMigrateContent, setDialogMigrateContent] = useState(false);
  const [dialogAllowNonEmptyTarget, setDialogAllowNonEmptyTarget] =
    useState(false);
  const [
    dialogRequiresNonEmptyTargetConfirmation,
    setDialogRequiresNonEmptyTargetConfirmation,
  ] = useState(false);
  const [isBrowsingDialogStorageRoot, setIsBrowsingDialogStorageRoot] =
    useState(false);
  const [browseFolderSupport, setBrowseFolderSupport] =
    useState<BrowseFolderSupport | null>(null);

  const [apiTokensDraft, setApiTokensDraft] =
    useState<SettingsApiTokens>(EMPTY_TOKENS);
  const [isSavingApiTokens, setIsSavingApiTokens] = useState(false);
  const [apiTokensFeedback, setApiTokensFeedback] = useState<string | null>(
    null
  );
  const [apiTokensError, setApiTokensError] = useState<string | null>(null);

  const [artifactsDraft, setArtifactsDraft] = useState<ViewerArtifactsSettings>(
    {
      enabled: true,
      mode: 'copy',
    }
  );
  const [isSavingArtifacts, setIsSavingArtifacts] = useState(false);
  const [artifactsFeedback, setArtifactsFeedback] = useState<string | null>(
    null
  );
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  const [concurrencyDraft, setConcurrencyDraft] =
    useState<number>(CONCURRENCY_MIN);
  const [isSavingConcurrency, setIsSavingConcurrency] = useState(false);
  const [concurrencyFeedback, setConcurrencyFeedback] = useState<string | null>(
    null
  );
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);
  const concurrencySaveRequestRef = useRef(0);
  const savedConcurrencyRef = useRef(CONCURRENCY_MIN);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const snapshot = await fetchViewerSettings();
      setSettings(snapshot);
      setApiTokensDraft(snapshot.apiTokens);
      setArtifactsDraft(snapshot.artifacts);
      setConcurrencyDraft(snapshot.concurrency);
      savedConcurrencyRef.current = snapshot.concurrency;
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load settings'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!artifactsFeedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setArtifactsFeedback(null);
    }, 1600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [artifactsFeedback]);

  useEffect(() => {
    if (!concurrencyFeedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setConcurrencyFeedback(null);
    }, 1600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [concurrencyFeedback]);

  useEffect(() => {
    let disposed = false;

    async function loadBrowseFolderSupport() {
      try {
        const support = await getBrowseFolderSupport();
        if (!disposed) {
          setBrowseFolderSupport(support);
        }
      } catch (error) {
        if (!disposed) {
          setBrowseFolderSupport({
            supported: false,
            reason:
              error instanceof Error
                ? error.message
                : 'Native folder picker support check failed.',
          });
        }
      }
    }

    void loadBrowseFolderSupport();

    return () => {
      disposed = true;
    };
  }, []);

  const persistConcurrency = useCallback(
    async (targetConcurrency: number, requestId: number): Promise<void> => {
      setIsSavingConcurrency(true);
      setConcurrencyError(null);

      try {
        const response = await updateViewerConcurrency({
          concurrency: targetConcurrency,
        });

        if (requestId !== concurrencySaveRequestRef.current) {
          return;
        }

        savedConcurrencyRef.current = response.concurrency;
        setSettings((current) =>
          current
            ? {
                ...current,
                concurrency: response.concurrency,
              }
            : current
        );
        setConcurrencyFeedback('Saved');
      } catch (error) {
        if (requestId !== concurrencySaveRequestRef.current) {
          return;
        }

        setConcurrencyDraft(savedConcurrencyRef.current);
        setConcurrencyError(
          error instanceof Error
            ? error.message
            : 'Failed to save concurrency setting'
        );
      } finally {
        if (requestId === concurrencySaveRequestRef.current) {
          setIsSavingConcurrency(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (concurrencyDraft === settings.concurrency) {
      return;
    }

    const requestId = concurrencySaveRequestRef.current + 1;
    concurrencySaveRequestRef.current = requestId;
    setConcurrencyFeedback(null);

    const timeout = window.setTimeout(() => {
      void persistConcurrency(concurrencyDraft, requestId);
    }, CONCURRENCY_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [concurrencyDraft, settings, persistConcurrency]);

  const hasApiTokenChanges = useMemo(() => {
    if (!settings) {
      return false;
    }

    return (
      apiTokensDraft.fal !== settings.apiTokens.fal ||
      apiTokensDraft.replicate !== settings.apiTokens.replicate ||
      apiTokensDraft.elevenlabs !== settings.apiTokens.elevenlabs ||
      apiTokensDraft.openai !== settings.apiTokens.openai ||
      apiTokensDraft.vercelGateway !== settings.apiTokens.vercelGateway
    );
  }, [settings, apiTokensDraft]);

  const hasDialogStorageChange = useMemo(() => {
    if (!settings) {
      return false;
    }

    const nextRoot = dialogStorageRoot.trim();
    return nextRoot !== '' && nextRoot !== settings.storageRoot;
  }, [dialogStorageRoot, settings]);

  async function handleBrowseDialogStorageRoot(): Promise<void> {
    setIsBrowsingDialogStorageRoot(true);
    setDialogStorageError(null);

    try {
      const result = await browseFolder();
      if (result.path) {
        setDialogStorageRoot(result.path);
        setDialogAllowNonEmptyTarget(false);
        setDialogRequiresNonEmptyTargetConfirmation(false);
      }
    } catch (error) {
      setDialogStorageError(
        error instanceof Error ? error.message : 'Failed to open folder browser'
      );
    } finally {
      setIsBrowsingDialogStorageRoot(false);
    }
  }

  function openStorageConfirmDialog(): void {
    if (!settings) {
      return;
    }

    setDialogStorageRoot(settings.storageRoot);
    setDialogMigrateContent(false);
    setDialogAllowNonEmptyTarget(false);
    setDialogRequiresNonEmptyTargetConfirmation(false);
    setDialogStorageError(null);
    setConfirmStorageChangeOpen(true);
  }

  async function handleConfirmStorageChange(): Promise<void> {
    setIsSavingStorageRoot(true);
    setDialogStorageError(null);
    setStorageFeedback(null);

    try {
      const result = await updateViewerStorageRoot({
        storageRoot: dialogStorageRoot.trim(),
        migrateContent: dialogMigrateContent,
        allowNonEmptyTarget: dialogAllowNonEmptyTarget,
      });

      setConfirmStorageChangeOpen(false);
      await loadSettings();
      setStorageFeedback(buildStorageSuccessMessage(result.mode));
    } catch (error) {
      if (getErrorStatus(error) === 409) {
        setDialogRequiresNonEmptyTargetConfirmation(true);
      }

      setDialogStorageError(
        error instanceof Error ? error.message : 'Failed to update storage root'
      );
    } finally {
      setIsSavingStorageRoot(false);
    }
  }

  async function handleSaveApiTokens(): Promise<void> {
    setIsSavingApiTokens(true);
    setApiTokensError(null);
    setApiTokensFeedback(null);

    try {
      await updateViewerApiTokens(apiTokensDraft);
      await loadSettings();
      setApiTokensFeedback('API tokens saved to ~/.config/renku/.env.');
    } catch (error) {
      setApiTokensError(
        error instanceof Error ? error.message : 'Failed to save API tokens'
      );
    } finally {
      setIsSavingApiTokens(false);
    }
  }

  function handleApiTokenDraftChange(
    key: keyof SettingsApiTokens,
    value: string
  ): void {
    setApiTokensDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleArtifactOutputChange(
    nextValue: ArtifactOutputOption
  ): Promise<void> {
    const previous = artifactsDraft;
    const next: ViewerArtifactsSettings =
      nextValue === 'disabled'
        ? {
            enabled: false,
            mode: previous.mode,
          }
        : {
            enabled: true,
            mode: nextValue,
          };

    if (next.enabled === previous.enabled && next.mode === previous.mode) {
      return;
    }

    setArtifactsDraft(next);
    setIsSavingArtifacts(true);
    setArtifactsError(null);
    setArtifactsFeedback(null);

    try {
      const response = await updateViewerArtifactsSettings(next);
      setArtifactsDraft(response.artifacts);
      setSettings((current) =>
        current
          ? {
              ...current,
              artifacts: response.artifacts,
            }
          : current
      );
      setArtifactsFeedback('Saved');
    } catch (error) {
      setArtifactsDraft(previous);
      setArtifactsError(
        error instanceof Error
          ? error.message
          : 'Failed to save artifact output settings'
      );
    } finally {
      setIsSavingArtifacts(false);
    }
  }

  return (
    <div className='h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-4'>
      <ViewerPageHeader subtitle='Settings' />

      <main className='flex-1 min-h-0 flex'>
        <div className='w-full max-w-[1080px] mx-auto min-h-0 flex flex-col'>
          <section className='flex-1 min-h-0 bg-sidebar-bg rounded-(--radius-panel) border border-panel-border overflow-hidden flex flex-col'>
            {isLoading && (
              <div className='flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground gap-2'>
                <Loader2 className='w-4 h-4 animate-spin' />
                <span>Loading settings...</span>
              </div>
            )}

            {!isLoading && loadError && (
              <div className='p-6'>
                <p className='bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive'>
                  {loadError}
                </p>
              </div>
            )}

            {!isLoading && !loadError && settings && (
              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as SettingsTab)}
                className='flex-1 min-h-0'
              >
                <TabsList
                  variant='line'
                  className='w-full h-[45px] rounded-none p-0 border-b border-border/40 bg-sidebar-header-bg justify-start gap-0'
                >
                  <TabsTrigger
                    value='general'
                    className='h-full rounded-none border-0 px-5 text-[11px] uppercase tracking-[0.12em] font-semibold data-[state=active]:bg-item-active-bg data-[state=active]:text-foreground'
                  >
                    General
                  </TabsTrigger>
                  <TabsTrigger
                    value='tokens'
                    className='h-full rounded-none border-0 px-5 text-[11px] uppercase tracking-[0.12em] font-semibold data-[state=active]:bg-item-active-bg data-[state=active]:text-foreground'
                  >
                    API Tokens
                  </TabsTrigger>
                </TabsList>

                <TabsContent value='general' className='flex-1 min-h-0 p-6'>
                  <div className={SETTINGS_CONTENT_WIDTH_CLASS}>
                    <div className={SETTINGS_ROWS_STACK_CLASS}>
                      <PropertyRow
                        name='Storage location'
                        description='Workspace root for blueprints, builds, and artifacts.'
                        className={SETTINGS_PROPERTY_ROW_CLASS}
                      >
                        <div className={SETTINGS_CONTROL_ROW_NOWRAP_CLASS}>
                          <Input
                            id='settings-storage-root'
                            value={settings.storageRoot}
                            readOnly
                            placeholder='/Users/you/Renku'
                            className={cn(
                              SETTINGS_INPUT_CLASS,
                              'flex-1 min-w-0'
                            )}
                          />
                          <div className='flex items-center gap-2 shrink-0'>
                            <Button
                              className='h-8'
                              onClick={openStorageConfirmDialog}
                              disabled={isSavingStorageRoot}
                            >
                              Change
                            </Button>
                          </div>
                        </div>
                      </PropertyRow>

                      <PropertyRow
                        name='Artifact output'
                        description={
                          <>
                            <span>
                              Materialize generated files for external editors.
                            </span>
                            <code className={SETTINGS_ARTIFACT_PATH_CLASS}>
                              {ARTIFACT_OUTPUT_PATH_PATTERN}
                            </code>
                          </>
                        }
                        className={SETTINGS_PROPERTY_ROW_CLASS}
                      >
                        <div className={SETTINGS_CONTROL_ROW_CLASS}>
                          <Select
                            value={
                              artifactsDraft.enabled
                                ? artifactsDraft.mode
                                : 'disabled'
                            }
                            onValueChange={(value: ArtifactOutputOption) =>
                              void handleArtifactOutputChange(value)
                            }
                            disabled={isSavingArtifacts}
                          >
                            <SelectTrigger
                              className={SETTINGS_SELECT_TRIGGER_CLASS}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value='disabled'>Disabled</SelectItem>
                              <SelectItem value='copy'>Copy</SelectItem>
                              <SelectItem value='symlink'>Symlink</SelectItem>
                            </SelectContent>
                          </Select>

                          {isSavingArtifacts && (
                            <span className={SETTINGS_STATUS_MUTED_CLASS}>
                              Saving...
                            </span>
                          )}

                          {!isSavingArtifacts && artifactsFeedback && (
                            <span className={SETTINGS_STATUS_SUCCESS_CLASS}>
                              {artifactsFeedback}
                            </span>
                          )}
                        </div>
                      </PropertyRow>

                      <PropertyRow
                        name='Concurrency'
                        description='Maximum number of producer jobs running in parallel.'
                        className={SETTINGS_PROPERTY_ROW_CLASS}
                      >
                        <div className='space-y-1.5'>
                          <div className='flex items-center gap-3'>
                            <Slider
                              min={CONCURRENCY_MIN}
                              max={CONCURRENCY_MAX}
                              step={1}
                              value={[concurrencyDraft]}
                              onValueChange={(values) => {
                                const next = values[0];
                                if (next === undefined) {
                                  throw new Error(
                                    'Concurrency slider did not return a value.'
                                  );
                                }
                                setConcurrencyError(null);
                                setConcurrencyFeedback(null);
                                setConcurrencyDraft(next);
                              }}
                              aria-label='Concurrency'
                              className='w-full max-w-[230px]'
                            />
                            <span className='w-6 text-right font-mono text-xs text-muted-foreground'>
                              {concurrencyDraft}
                            </span>
                            {isSavingConcurrency && (
                              <span className={SETTINGS_STATUS_MUTED_CLASS}>
                                Saving...
                              </span>
                            )}
                            {!isSavingConcurrency && concurrencyFeedback && (
                              <span className={SETTINGS_STATUS_SUCCESS_CLASS}>
                                {concurrencyFeedback}
                              </span>
                            )}
                          </div>
                          <p className='text-[11px] text-muted-foreground'>
                            Range {CONCURRENCY_MIN}-{CONCURRENCY_MAX}
                          </p>
                        </div>
                      </PropertyRow>
                    </div>

                    {storageFeedback && (
                      <p className='text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3'>
                        {storageFeedback}
                      </p>
                    )}

                    {artifactsError && (
                      <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                        {artifactsError}
                      </p>
                    )}

                    {concurrencyError && (
                      <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                        {concurrencyError}
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value='tokens' className='flex-1 min-h-0 p-6'>
                  <div className={SETTINGS_CONTENT_WIDTH_CLASS}>
                    <div className={SETTINGS_ROWS_STACK_CLASS}>
                      {PROVIDER_TOKEN_FIELDS.map((provider) => (
                        <PropertyRow
                          key={provider.key}
                          name={
                            <span className={SETTINGS_PROVIDER_LABEL_CLASS}>
                              {provider.label}
                            </span>
                          }
                          description={provider.description}
                          className={SETTINGS_PROPERTY_ROW_CLASS}
                        >
                          <Input
                            type='text'
                            value={apiTokensDraft[provider.key]}
                            onChange={(event) =>
                              handleApiTokenDraftChange(
                                provider.key,
                                event.target.value
                              )
                            }
                            placeholder='Paste token'
                            className={SETTINGS_INPUT_CLASS}
                            autoComplete='off'
                          />
                        </PropertyRow>
                      ))}
                    </div>

                    <div className={SETTINGS_ACTION_ROW_CLASS}>
                      <Button
                        onClick={() => void handleSaveApiTokens()}
                        disabled={!hasApiTokenChanges || isSavingApiTokens}
                      >
                        {isSavingApiTokens ? (
                          <>
                            <Loader2 className='w-4 h-4 mr-1.5 animate-spin' />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className='w-4 h-4 mr-1.5' />
                            Save API Tokens
                          </>
                        )}
                      </Button>
                    </div>

                    {apiTokensFeedback && (
                      <p className='text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3'>
                        {apiTokensFeedback}
                      </p>
                    )}

                    {apiTokensError && (
                      <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                        {apiTokensError}
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <div className='px-4 py-4 border-t border-border/40 bg-dialog-footer-bg shrink-0 flex items-center justify-end'>
              <Button variant='outline' onClick={() => navigateToPath('/')}>
                <House className='w-4 h-4 mr-1.5' />
                Back to Home
              </Button>
            </div>
          </section>
        </div>
      </main>

      <Dialog
        open={confirmStorageChangeOpen}
        onOpenChange={setConfirmStorageChangeOpen}
      >
        <DialogContent className='sm:max-w-[560px] p-0 gap-0 overflow-hidden'>
          <DialogHeader>
            <DialogTitle>Confirm Storage Change</DialogTitle>
            <DialogDescription>
              Choose the final storage location and how Renku should apply the
              move.
            </DialogDescription>
          </DialogHeader>

          <div className='px-6 py-6 space-y-4'>
            <div className='space-y-1.5'>
              <label
                htmlFor='confirm-storage-root'
                className='text-xs text-muted-foreground'
              >
                New storage location
              </label>
              <div className='flex items-center gap-2'>
                <Input
                  id='confirm-storage-root'
                  value={dialogStorageRoot}
                  onChange={(event) => {
                    setDialogStorageRoot(event.target.value);
                    setDialogAllowNonEmptyTarget(false);
                    setDialogRequiresNonEmptyTargetConfirmation(false);
                    setDialogStorageError(null);
                  }}
                  placeholder='/Users/you/Renku'
                  className='h-9 font-mono text-sm bg-background/35'
                />
                {browseFolderSupport?.supported && (
                  <Button
                    variant='outline'
                    className='h-9 shrink-0'
                    onClick={() => void handleBrowseDialogStorageRoot()}
                    disabled={
                      isBrowsingDialogStorageRoot || isSavingStorageRoot
                    }
                  >
                    {isBrowsingDialogStorageRoot ? (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    ) : (
                      <FolderOpen className='w-4 h-4' />
                    )}
                    <span className='ml-1.5'>Select Folder</span>
                  </Button>
                )}
              </div>
              {browseFolderSupport && !browseFolderSupport.supported && (
                <p className='text-xs text-muted-foreground'>
                  Native folder picker is unavailable on this system. Enter the
                  path manually.
                </p>
              )}
            </div>

            <div className='rounded-lg border border-border/40 bg-panel-bg px-4 py-3 flex items-center justify-between gap-4'>
              <div className='space-y-1'>
                <p className='text-sm font-medium'>
                  Copy existing workspace content
                </p>
                <p className='text-xs text-muted-foreground'>
                  Copies blueprints, builds, and artifacts from the current
                  storage root into the new location without deleting source
                  files.
                </p>
              </div>
              <Switch
                checked={dialogMigrateContent}
                onCheckedChange={setDialogMigrateContent}
                disabled={isSavingStorageRoot}
              />
            </div>

            {dialogRequiresNonEmptyTargetConfirmation && (
              <div className='rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-4'>
                <div className='space-y-1'>
                  <p className='text-sm font-medium'>
                    Allow existing target content
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    Keep existing files in the selected folder and replace only
                    the `catalog` folder using Renku catalog contents.
                  </p>
                </div>
                <Switch
                  aria-label='Allow existing target content'
                  checked={dialogAllowNonEmptyTarget}
                  onCheckedChange={setDialogAllowNonEmptyTarget}
                  disabled={isSavingStorageRoot}
                />
              </div>
            )}

            {dialogStorageError && (
              <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                {dialogStorageError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setConfirmStorageChangeOpen(false)}
              disabled={isSavingStorageRoot}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleConfirmStorageChange()}
              disabled={
                !hasDialogStorageChange ||
                isSavingStorageRoot ||
                (dialogRequiresNonEmptyTargetConfirmation &&
                  !dialogAllowNonEmptyTarget)
              }
            >
              {isSavingStorageRoot ? (
                <>
                  <Loader2 className='w-4 h-4 mr-2 animate-spin' />
                  Applying...
                </>
              ) : (
                'Confirm Change'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildStorageSuccessMessage(mode: StorageRootUpdateMode): string {
  if (mode === 'migrated') {
    return 'Storage root updated. Existing workspace content was copied and catalog templates were synced from Renku.';
  }

  if (mode === 'initialized') {
    return 'Storage root updated. A new workspace was initialized and catalog templates were synced from Renku.';
  }

  return 'Storage root updated. Existing workspace is now active.';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const status = (error as Error & { status?: unknown }).status;
  if (typeof status !== 'number') {
    return undefined;
  }

  return status;
}
