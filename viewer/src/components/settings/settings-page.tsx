import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, House, Loader2, Save } from 'lucide-react';
import { ViewerPageHeader } from '@/components/layout/viewer-page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { browseFolder } from '@/data/onboarding-client';
import {
  fetchViewerSettings,
  updateViewerApiTokens,
  updateViewerStorageRoot,
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

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<ViewerSettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [storageRootDraft, setStorageRootDraft] = useState('');
  const [isBrowsingStorageRoot, setIsBrowsingStorageRoot] = useState(false);
  const [isSavingStorageRoot, setIsSavingStorageRoot] = useState(false);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [confirmStorageChangeOpen, setConfirmStorageChangeOpen] =
    useState(false);
  const [dialogStorageRoot, setDialogStorageRoot] = useState('');
  const [dialogMigrateContent, setDialogMigrateContent] = useState(false);
  const [isBrowsingDialogStorageRoot, setIsBrowsingDialogStorageRoot] =
    useState(false);

  const [apiTokensDraft, setApiTokensDraft] =
    useState<SettingsApiTokens>(EMPTY_TOKENS);
  const [isSavingApiTokens, setIsSavingApiTokens] = useState(false);
  const [apiTokensFeedback, setApiTokensFeedback] = useState<string | null>(
    null
  );
  const [apiTokensError, setApiTokensError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const snapshot = await fetchViewerSettings();
      setSettings(snapshot);
      setStorageRootDraft(snapshot.storageRoot);
      setApiTokensDraft(snapshot.apiTokens);
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

  async function handleBrowseStorageRoot(): Promise<void> {
    setIsBrowsingStorageRoot(true);
    setStorageError(null);
    setStorageFeedback(null);

    try {
      const result = await browseFolder();
      if (result.path) {
        setStorageRootDraft(result.path);
      }
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : 'Failed to open folder browser'
      );
    } finally {
      setIsBrowsingStorageRoot(false);
    }
  }

  async function handleBrowseDialogStorageRoot(): Promise<void> {
    setIsBrowsingDialogStorageRoot(true);
    try {
      const result = await browseFolder();
      if (result.path) {
        setDialogStorageRoot(result.path);
      }
    } catch {
      // Error display is handled on submit for consistency.
    } finally {
      setIsBrowsingDialogStorageRoot(false);
    }
  }

  function openStorageConfirmDialog(): void {
    if (!settings) {
      return;
    }

    const normalizedDraft = storageRootDraft.trim();
    setDialogStorageRoot(
      normalizedDraft.length > 0 ? normalizedDraft : settings.storageRoot
    );
    setDialogMigrateContent(false);
    setConfirmStorageChangeOpen(true);
  }

  async function handleConfirmStorageChange(): Promise<void> {
    setIsSavingStorageRoot(true);
    setStorageError(null);
    setStorageFeedback(null);

    try {
      const result = await updateViewerStorageRoot({
        storageRoot: dialogStorageRoot.trim(),
        migrateContent: dialogMigrateContent,
      });

      setConfirmStorageChangeOpen(false);
      await loadSettings();
      setStorageFeedback(buildStorageSuccessMessage(result.mode));
    } catch (error) {
      setStorageError(
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

  return (
    <div className='h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-4'>
      <ViewerPageHeader subtitle='Settings' />

      <main className='flex-1 min-h-0 flex'>
        <div className='w-full max-w-[1080px] mx-auto min-h-0 flex flex-col'>
          <section className='flex-1 min-h-0 bg-sidebar-bg rounded-[var(--radius-panel)] border border-panel-border overflow-hidden flex flex-col'>
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
                  <div className='mx-auto w-full max-w-4xl space-y-4'>
                    <div className='rounded-xl border border-border/40 bg-panel-bg p-4 shadow-sm'>
                      <div className='space-y-1.5'>
                        <label
                          htmlFor='settings-storage-root'
                          className='text-xs text-muted-foreground'
                        >
                          New storage location
                        </label>
                        <div className='flex flex-col gap-2 lg:flex-row lg:items-center'>
                          <Input
                            id='settings-storage-root'
                            value={storageRootDraft}
                            onChange={(event) =>
                              setStorageRootDraft(event.target.value)
                            }
                            placeholder='/Users/you/Renku'
                            className='h-9 font-mono text-sm bg-background/35'
                          />
                          <div className='flex items-center gap-2 shrink-0'>
                            <Button
                              variant='outline'
                              className='h-9'
                              onClick={() => void handleBrowseStorageRoot()}
                              disabled={
                                isBrowsingStorageRoot || isSavingStorageRoot
                              }
                            >
                              {isBrowsingStorageRoot ? (
                                <Loader2 className='w-4 h-4 animate-spin' />
                              ) : (
                                <FolderOpen className='w-4 h-4' />
                              )}
                              <span className='ml-1.5'>Select Folder</span>
                            </Button>
                            <Button
                              onClick={openStorageConfirmDialog}
                              disabled={isSavingStorageRoot}
                            >
                              <Save className='w-4 h-4 mr-1.5' />
                              Save Storage Location
                            </Button>
                          </div>
                        </div>
                      </div>

                      <p className='text-xs text-muted-foreground mt-3'>
                        If the selected folder already contains a Renku
                        workspace, Renku switches to it and refreshes its
                        catalog templates only.
                      </p>
                    </div>

                    {storageFeedback && (
                      <p className='text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3'>
                        {storageFeedback}
                      </p>
                    )}

                    {storageError && (
                      <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                        {storageError}
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value='tokens' className='flex-1 min-h-0 p-6'>
                  <div className='mx-auto w-full max-w-4xl space-y-4'>
                    <div className='rounded-xl border border-border/40 bg-panel-bg overflow-hidden shadow-sm'>
                      <TokenTableRow
                        label='FAL_KEY'
                        value={apiTokensDraft.fal}
                        onChange={(value) =>
                          setApiTokensDraft((prev) => ({ ...prev, fal: value }))
                        }
                      />
                      <TokenTableRow
                        label='REPLICATE_API_TOKEN'
                        value={apiTokensDraft.replicate}
                        onChange={(value) =>
                          setApiTokensDraft((prev) => ({
                            ...prev,
                            replicate: value,
                          }))
                        }
                      />
                      <TokenTableRow
                        label='ELEVENLABS_API_KEY'
                        value={apiTokensDraft.elevenlabs}
                        onChange={(value) =>
                          setApiTokensDraft((prev) => ({
                            ...prev,
                            elevenlabs: value,
                          }))
                        }
                      />
                      <TokenTableRow
                        label='OPENAI_API_KEY'
                        value={apiTokensDraft.openai}
                        onChange={(value) =>
                          setApiTokensDraft((prev) => ({
                            ...prev,
                            openai: value,
                          }))
                        }
                      />
                      <TokenTableRow
                        label='AI_GATEWAY_API_KEY'
                        value={apiTokensDraft.vercelGateway}
                        onChange={(value) =>
                          setApiTokensDraft((prev) => ({
                            ...prev,
                            vercelGateway: value,
                          }))
                        }
                        isLast
                      />
                    </div>

                    <div className='flex justify-end'>
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
                  onChange={(event) => setDialogStorageRoot(event.target.value)}
                  placeholder='/Users/you/Renku'
                  className='h-9 font-mono text-sm bg-background/35'
                />
                <Button
                  variant='outline'
                  className='h-9 shrink-0'
                  onClick={() => void handleBrowseDialogStorageRoot()}
                  disabled={isBrowsingDialogStorageRoot || isSavingStorageRoot}
                >
                  {isBrowsingDialogStorageRoot ? (
                    <Loader2 className='w-4 h-4 animate-spin' />
                  ) : (
                    <FolderOpen className='w-4 h-4' />
                  )}
                  <span className='ml-1.5'>Select Folder</span>
                </Button>
              </div>
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
              disabled={!hasDialogStorageChange || isSavingStorageRoot}
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

function TokenTableRow({
  label,
  value,
  onChange,
  isLast = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isLast?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] border-b border-border/30',
        isLast && 'border-b-0'
      )}
    >
      <div className='px-4 py-3 bg-sidebar-header-bg/80 flex items-center'>
        <span className='text-xs font-medium text-muted-foreground'>
          {label}
        </span>
      </div>
      <div className='px-4 py-2'>
        <Input
          type='text'
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder='Paste API token'
          className='h-9 font-mono text-sm bg-background/35'
          autoComplete='off'
        />
      </div>
    </div>
  );
}

function buildStorageSuccessMessage(mode: StorageRootUpdateMode): string {
  if (mode === 'migrated') {
    return 'Storage root updated. Existing workspace content was copied and catalog templates were refreshed.';
  }

  if (mode === 'initialized') {
    return 'Storage root updated. A new workspace was initialized and catalog templates were copied.';
  }

  return 'Storage root updated. Existing workspace was selected and catalog templates were refreshed.';
}
