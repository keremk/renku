import { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { browseFolder } from '@/data/onboarding-client';

interface StepStorageProps {
  value: string;
  onChange: (path: string) => void;
}

export function StepStorage({ value, onChange }: StepStorageProps) {
  const [isBrowsing, setIsBrowsing] = useState(false);

  async function handleBrowse() {
    setIsBrowsing(true);
    try {
      const result = await browseFolder();
      if (result.path) {
        onChange(result.path);
      }
    } finally {
      setIsBrowsing(false);
    }
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <label htmlFor='storage-root' className='text-sm font-medium'>
          Storage folder
        </label>
        <p className='text-xs text-muted-foreground'>
          Renku will store your blueprints, builds, and artifacts here.
        </p>
        <div className='flex gap-2'>
          <Input
            id='storage-root'
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='/Users/you/renku-workspace'
            className='h-9 flex-1 font-mono text-sm'
          />
          <Button
            variant='outline'
            size='sm'
            className='h-9 shrink-0'
            onClick={() => void handleBrowse()}
            disabled={isBrowsing}
          >
            {isBrowsing ? (
              <Loader2 className='w-4 h-4 animate-spin' />
            ) : (
              <FolderOpen className='w-4 h-4' />
            )}
            <span className='ml-1.5'>Browse...</span>
          </Button>
        </div>
      </div>

      <p className='text-xs text-muted-foreground'>
        The catalog of built-in blueprints will be copied into this folder.
        You can change this location later by running{' '}
        <code className='text-xs bg-muted px-1 py-0.5 rounded'>renku init --root=&lt;path&gt;</code>.
      </p>
    </div>
  );
}
