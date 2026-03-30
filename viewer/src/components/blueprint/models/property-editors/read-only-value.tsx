export function ReadOnlyValue({ value }: { value: unknown }) {
  const text =
    value === undefined
      ? '—'
      : Array.isArray(value) || (value && typeof value === 'object')
        ? JSON.stringify(value)
        : String(value);

  return <span className='text-muted-foreground text-right block'>{text}</span>;
}
