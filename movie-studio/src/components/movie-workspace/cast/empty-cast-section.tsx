import { Card } from '@/components/ui/card';

interface EmptyCastSectionProps {
  message: string;
}

export function EmptyCastSection({ message }: EmptyCastSectionProps) {
  return (
    <Card className='m-4 min-h-30 border-2 border-dashed border-border/40 bg-muted/20 px-6 py-8 shadow-none flex items-center justify-center text-center text-sm text-muted-foreground'>
      {message}
    </Card>
  );
}
