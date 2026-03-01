import { useCallback, useMemo, useState, type ComponentType } from 'react';
import {
  ArrowRight,
  FolderOpen,
  LayoutTemplate,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  createBlueprintFromTemplate,
  type CatalogTemplateItem,
} from '@/data/blueprint-client';
import { switchBlueprint } from '@/hooks/use-blueprint-route';
import { prettifyBlueprintName } from '@/lib/blueprint-display';
import { useHomeData } from '@/services/use-home-data';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import renkuLogo from '../../../../web/public/logo.svg';

const BLUEPRINT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function ViewerHomePage() {
  const { blueprints, templates, blueprintsState, templatesState, refreshAll } =
    useHomeData();

  const [selectedTemplate, setSelectedTemplate] =
    useState<CatalogTemplateItem | null>(null);
  const [newBlueprintName, setNewBlueprintName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const isFormNameValid = useMemo(
    () => BLUEPRINT_NAME_PATTERN.test(newBlueprintName.trim()),
    [newBlueprintName]
  );

  const handleTemplateSelect = useCallback((template: CatalogTemplateItem) => {
    setSelectedTemplate(template);
    setNewBlueprintName(template.name);
    setCreateError(null);
  }, []);

  const closeCreateDialog = useCallback(() => {
    setSelectedTemplate(null);
    setCreateError(null);
    setIsCreating(false);
  }, []);

  const handleCreateBlueprint = useCallback(async () => {
    if (!selectedTemplate) {
      return;
    }
    const normalizedName = newBlueprintName.trim();
    if (!BLUEPRINT_NAME_PATTERN.test(normalizedName)) {
      setCreateError('Blueprint name must be kebab-case (e.g., my-blueprint).');
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      await createBlueprintFromTemplate(selectedTemplate.name, normalizedName);
      switchBlueprint(normalizedName);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : 'Failed to create blueprint from template'
      );
      setIsCreating(false);
    }
  }, [newBlueprintName, selectedTemplate]);

  return (
    <div className='h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-4'>
      <header className='rounded-[var(--radius-panel)] border border-sidebar-border bg-sidebar-bg overflow-hidden'>
        <div className='h-[56px] px-4 sm:px-5 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <img
              src={renkuLogo}
              alt='Renku'
              className='h-10 w-10 rounded-md object-contain'
            />
            <div className='min-w-0'>
              <p className='text-sm font-semibold tracking-[0.02em]'>
                Renku
              </p>
              <p className='text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold'>
                Blueprint Home
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <div className='px-4 sm:px-5 py-3 flex items-center justify-between gap-3'>
          <p className='text-sm text-muted-foreground'>
            Open an existing blueprint or start from a catalog template.
          </p>
          <Button
            variant='outline'
            size='sm'
            className='h-8'
            onClick={() => void refreshAll()}
          >
            <RefreshCw className='w-3.5 h-3.5 mr-1.5' />
            Refresh
          </Button>
        </div>
      </header>

      <main className='flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4'>
        <section className='flex flex-col min-h-0 bg-sidebar-bg rounded-[var(--radius-panel)] border border-sidebar-border overflow-hidden'>
          <div className='h-[45px] px-4 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between shrink-0'>
            <div className='flex items-center gap-2'>
              <FolderOpen className='w-4 h-4 text-muted-foreground' />
              <h2 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                My Blueprints
              </h2>
            </div>
            <span className='text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium'>
              {blueprints.length}
            </span>
          </div>

          <div className='flex-1 overflow-y-auto p-2'>
            {blueprintsState.isLoading && (
              <HomeLoader label='Loading blueprints...' />
            )}

            {blueprintsState.error && (
              <HomeError error={blueprintsState.error} />
            )}

            {!blueprintsState.isLoading &&
              !blueprintsState.error &&
              blueprints.length === 0 && (
                <HomeEmptyState
                  icon={FolderOpen}
                  title='No blueprints yet'
                  description='Create your first project from a catalog template on the right.'
                />
              )}

            {!blueprintsState.isLoading &&
              !blueprintsState.error &&
              blueprints.length > 0 && (
                <div className='flex flex-col gap-1'>
                  {blueprints.map((blueprint) => (
                    <button
                      key={blueprint.name}
                      type='button'
                      onClick={() => switchBlueprint(blueprint.name)}
                      className='w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-transparent bg-transparent hover:bg-item-hover-bg hover:border-border/50 transition-colors text-left'
                    >
                      <FolderOpen className='w-4 h-4 shrink-0 text-muted-foreground' />
                      <div className='flex-1 min-w-0'>
                        <p className='text-sm font-medium truncate'>
                          {prettifyBlueprintName(blueprint.name)}
                        </p>
                        <p className='text-xs text-muted-foreground truncate'>
                          {blueprint.name}
                        </p>
                      </div>
                      <ArrowRight className='w-4 h-4 text-muted-foreground' />
                    </button>
                  ))}
                </div>
              )}
          </div>
        </section>

        <section className='flex flex-col min-h-0 bg-sidebar-bg rounded-[var(--radius-panel)] border border-panel-border overflow-hidden'>
          <div className='h-[45px] px-4 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between shrink-0'>
            <div className='flex items-center gap-2'>
              <LayoutTemplate className='w-4 h-4 text-muted-foreground' />
              <h2 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                Catalog Templates
              </h2>
            </div>
            <span className='text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium'>
              {templates.length}
            </span>
          </div>

          <div className='flex-1 overflow-y-auto p-4'>
            {templatesState.isLoading && (
              <HomeLoader label='Loading templates...' />
            )}

            {templatesState.error && <HomeError error={templatesState.error} />}

            {!templatesState.isLoading &&
              !templatesState.error &&
              templates.length === 0 && (
                <HomeEmptyState
                  icon={LayoutTemplate}
                  title='No catalog templates available'
                  description='Run renku update to sync templates from the catalog.'
                />
              )}

            {!templatesState.isLoading &&
              !templatesState.error &&
              templates.length > 0 && (
                <div className='grid grid-cols-1 2xl:grid-cols-2 gap-3'>
                  {templates.map((template) => (
                    <article
                      key={template.name}
                      className='rounded-xl border border-border bg-card shadow-lg transition-all hover:border-primary/70 hover:shadow-xl hover:-translate-y-1 overflow-hidden flex flex-col'
                    >
                      <div className='p-4 space-y-2'>
                        <div className='flex items-start justify-between gap-2'>
                          <h3 className='text-sm font-semibold text-foreground leading-snug'>
                            {template.title}
                          </h3>
                          <span className='text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0'>
                            {template.name}
                          </span>
                        </div>
                        <p className='text-xs text-muted-foreground leading-relaxed'>
                          {template.description || 'No description provided.'}
                        </p>
                      </div>

                      <div className='mt-auto border-t border-border/60 bg-muted/50 px-4 py-3 flex items-center justify-between gap-3'>
                        <span className='text-xs text-muted-foreground'>
                          Create a new blueprint from this template
                        </span>
                        <Button
                          size='sm'
                          className='h-8'
                          onClick={() => handleTemplateSelect(template)}
                        >
                          <Sparkles className='w-3.5 h-3.5 mr-1.5' />
                          Use Template
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
          </div>
        </section>
      </main>

      <Dialog
        open={Boolean(selectedTemplate)}
        onOpenChange={(open) => !open && closeCreateDialog()}
      >
        <DialogContent className='sm:max-w-[460px] p-0 gap-0 overflow-hidden'>
          <DialogHeader>
            <DialogTitle>Create Blueprint</DialogTitle>
            <DialogDescription>
              Create a new blueprint from a catalog template.
            </DialogDescription>
          </DialogHeader>

          <div className='px-6 py-6 space-y-4'>
            <div className='space-y-1.5'>
              <p className='text-xs text-muted-foreground'>Template</p>
              <p className='text-sm font-medium text-foreground'>
                {selectedTemplate?.title}
              </p>
              <p className='text-xs text-muted-foreground'>
                {selectedTemplate?.name}
              </p>
            </div>

            <div className='space-y-1.5'>
              <label
                htmlFor='new-blueprint-name'
                className='text-xs text-muted-foreground'
              >
                New blueprint name
              </label>
              <Input
                id='new-blueprint-name'
                value={newBlueprintName}
                onChange={(event) => {
                  setNewBlueprintName(event.target.value);
                  setCreateError(null);
                }}
                placeholder='my-blueprint'
                className='h-9'
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !isCreating) {
                    void handleCreateBlueprint();
                  }
                }}
              />
              <p className='text-xs text-muted-foreground'>
                Use kebab-case (lowercase letters, numbers, and hyphens).
              </p>
            </div>

            {createError && (
              <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
                {createError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={closeCreateDialog}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateBlueprint()}
              disabled={isCreating || !isFormNameValid}
            >
              {isCreating ? (
                <>
                  <Loader2 className='w-4 h-4 mr-2 animate-spin' />
                  Creating...
                </>
              ) : (
                'Create Blueprint'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HomeLoader({ label }: { label: string }) {
  return (
    <div className='h-full min-h-32 flex items-center justify-center text-sm text-muted-foreground gap-2'>
      <Loader2 className='w-4 h-4 animate-spin' />
      <span>{label}</span>
    </div>
  );
}

function HomeError({ error }: { error: string }) {
  return (
    <div className='h-full min-h-32 flex items-center justify-center p-4'>
      <p className='w-full bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive'>
        {error}
      </p>
    </div>
  );
}

function HomeEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className='flex flex-col items-center justify-center h-full min-h-32 text-center px-8'>
      <div className='w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4'>
        <Icon className='size-8 text-muted-foreground' />
      </div>
      <p className='text-sm font-medium text-foreground mb-1'>{title}</p>
      <p className='text-xs text-muted-foreground max-w-[320px]'>
        {description}
      </p>
    </div>
  );
}
