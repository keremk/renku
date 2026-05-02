export function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <span className='rounded-full border border-border/50 bg-background/35 px-3 py-1 text-xs text-muted-foreground'>
      {label}: <span className='font-semibold text-foreground'>{value}</span>
    </span>
  );
}
