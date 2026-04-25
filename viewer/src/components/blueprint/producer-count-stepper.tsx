import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface ProducerCountStepperProps {
  value: number;
  max: number;
  disabled?: boolean;
  inputLabel: string;
  onChange: (value: number) => void;
}

export function ProducerCountStepper({
  value,
  max,
  disabled = false,
  inputLabel,
  onChange,
}: ProducerCountStepperProps) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitValue = (nextValue: string) => {
    const trimmed = nextValue.trim();
    if (trimmed.length === 0) {
      setDraftValue(String(value));
      return;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed)) {
      setDraftValue(String(value));
      return;
    }

    const clamped = Math.max(0, Math.min(max, parsed));
    setDraftValue(String(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  return (
    <div className='inline-flex items-center'>
      <Input
        type='number'
        min={0}
        max={max}
        step={1}
        value={draftValue}
        disabled={disabled}
        aria-label={inputLabel}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);
          const trimmed = nextValue.trim();
          if (trimmed.length === 0) {
            return;
          }
          const parsed = Number.parseInt(trimmed, 10);
          if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
            return;
          }
          onChange(parsed);
        }}
        onBlur={(event) => commitValue(event.target.value)}
        className='h-8 w-18 rounded-md border-border/50 bg-background/80 pr-1 text-center text-xs tabular-nums'
      />
    </div>
  );
}
