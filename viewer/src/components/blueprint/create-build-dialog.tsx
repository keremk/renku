import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createBuild } from '@/data/blueprint-client';
import { updateBlueprintRoute } from '@/hooks/use-blueprint-route';
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

interface CreateBuildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprintFolder: string;
  onRefresh?: () => Promise<void>;
  title?: string;
  description?: string;
}

export function CreateBuildDialog({
  open,
  onOpenChange,
  blueprintFolder,
  onRefresh,
  title = 'Create New Build',
  description,
}: CreateBuildDialogProps) {
  const dialogDescription =
    description ?? 'Create a new build for this blueprint.';
  const [newBuildName, setNewBuildName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetDialogState = useCallback(() => {
    setNewBuildName('');
    setCreateError(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isCreating) {
        return;
      }

      if (!nextOpen) {
        resetDialogState();
      }

      onOpenChange(nextOpen);
    },
    [isCreating, onOpenChange, resetDialogState]
  );

  const handleCreateBuild = useCallback(async () => {
    setIsCreating(true);
    setCreateError(null);

    try {
      const displayName = newBuildName.trim();
      const result = await createBuild(
        blueprintFolder,
        displayName.length > 0 ? displayName : undefined
      );
      await onRefresh?.();
      resetDialogState();
      onOpenChange(false);
      updateBlueprintRoute(result.movieId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create build.';
      setCreateError(message);
      console.error('Failed to create build:', error);
    } finally {
      setIsCreating(false);
    }
  }, [blueprintFolder, newBuildName, onOpenChange, onRefresh, resetDialogState]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className='sm:max-w-[400px] p-0 gap-0 overflow-hidden'
        showCloseButton={!isCreating}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className='px-6 py-6'>
          <label className='text-sm font-medium text-foreground'>
            Display Name (optional)
          </label>
          <Input
            value={newBuildName}
            onChange={(event) => {
              setNewBuildName(event.target.value);
              setCreateError(null);
            }}
            placeholder='e.g., Test Run, Final Version'
            className='mt-2'
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !isCreating) {
                void handleCreateBuild();
              }
            }}
          />
          <p className='text-xs text-muted-foreground mt-2'>
            A friendly name to identify this build. You can change it later.
          </p>

          {createError ? (
            <p className='text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3 mt-4'>
              {createError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleCreateBuild()} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className='w-4 h-4 mr-2 animate-spin' />
                Creating...
              </>
            ) : (
              'Create Build'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
