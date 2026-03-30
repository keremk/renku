import { Button } from '@/components/ui/button';

export function ResetOverrideButton({ onReset }: { onReset: () => void }) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='h-6 px-2 text-xs'
      onClick={onReset}
    >
      Reset
    </Button>
  );
}
