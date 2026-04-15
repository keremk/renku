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
  return (
    <div className='inline-flex items-center'>
      <Input
        type='number'
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={inputLabel}
        onChange={(event) => {
          const trimmed = event.target.value.trim();
          if (trimmed.length === 0) {
            return;
          }
          const parsed = Number.parseInt(trimmed, 10);
          if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
            return;
          }
          onChange(parsed);
        }}
        className='h-8 w-[4.5rem] rounded-md border-border/50 bg-background/80 pr-1 text-center text-xs tabular-nums'
      />
    </div>
  );
}
