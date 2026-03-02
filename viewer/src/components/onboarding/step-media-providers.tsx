import { Input } from '@/components/ui/input';

export interface MediaProviderValues {
  fal: { selected: boolean; apiKey: string };
  replicate: { selected: boolean; apiKey: string };
  elevenlabs: { selected: boolean; apiKey: string };
}

interface ProviderCardProps {
  name: string;
  description: string;
  apiKeyLabel: string;
  apiKeyLink: string;
  selected: boolean;
  apiKey: string;
  onToggle: () => void;
  onApiKeyChange: (key: string) => void;
}

function ProviderCard({
  name,
  description,
  apiKeyLabel,
  apiKeyLink,
  selected,
  apiKey,
  onToggle,
  onApiKeyChange,
}: ProviderCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 transition-all cursor-pointer select-none ${
        selected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : 'border-border/40 bg-muted/30'
      }`}
      onClick={onToggle}
      onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      role='checkbox'
      aria-checked={selected}
      tabIndex={0}
    >
      <div className='flex items-start gap-3'>
        <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
          selected ? 'bg-primary border-primary' : 'border-border'
        }`}>
          {selected && (
            <svg className='w-2.5 h-2.5 text-primary-foreground' fill='currentColor' viewBox='0 0 12 12'>
              <path d='M10 3L5 8.5 2 5.5' stroke='currentColor' strokeWidth='2' fill='none' strokeLinecap='round' strokeLinejoin='round' />
            </svg>
          )}
        </div>
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium'>{name}</p>
          <p className='text-xs text-muted-foreground mt-0.5'>{description}</p>
          <a
            href={apiKeyLink}
            target='_blank'
            rel='noopener noreferrer'
            className='text-xs text-primary hover:underline mt-1 inline-block'
            onClick={(e) => e.stopPropagation()}
          >
            Get API key →
          </a>
        </div>
      </div>

      {selected && (
        <div className='mt-3' onClick={(e) => e.stopPropagation()}>
          <label className='text-xs text-muted-foreground block mb-1'>
            {apiKeyLabel}
          </label>
          <Input
            type='text'
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder='Paste your API key here'
            className='h-8 text-sm font-mono'
            autoComplete='off'
          />
        </div>
      )}
    </div>
  );
}

interface StepMediaProvidersProps {
  values: MediaProviderValues;
  onChange: (values: MediaProviderValues) => void;
}

export function StepMediaProviders({ values, onChange }: StepMediaProvidersProps) {
  function toggleFal() {
    onChange({ ...values, fal: { ...values.fal, selected: !values.fal.selected } });
  }
  function toggleReplicate() {
    onChange({ ...values, replicate: { ...values.replicate, selected: !values.replicate.selected } });
  }
  function toggleElevenlabs() {
    onChange({ ...values, elevenlabs: { ...values.elevenlabs, selected: !values.elevenlabs.selected } });
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <p className='text-sm font-medium'>Media generation providers</p>
        <p className='text-xs text-muted-foreground'>
          Select at least one provider for AI video, image, and audio generation.
        </p>
      </div>

      <div className='space-y-3'>
        <ProviderCard
          name='fal.ai'
          description='High-speed AI video generation'
          apiKeyLabel='FAL_KEY'
          apiKeyLink='https://fal.ai/dashboard'
          selected={values.fal.selected}
          apiKey={values.fal.apiKey}
          onToggle={toggleFal}
          onApiKeyChange={(key) => onChange({ ...values, fal: { ...values.fal, apiKey: key } })}
        />

        <ProviderCard
          name='Replicate'
          description='Run open-source AI models in the cloud'
          apiKeyLabel='REPLICATE_API_TOKEN'
          apiKeyLink='https://replicate.com/account/api-tokens'
          selected={values.replicate.selected}
          apiKey={values.replicate.apiKey}
          onToggle={toggleReplicate}
          onApiKeyChange={(key) => onChange({ ...values, replicate: { ...values.replicate, apiKey: key } })}
        />

        <ProviderCard
          name='ElevenLabs'
          description='AI voice and audio generation'
          apiKeyLabel='ELEVENLABS_API_KEY'
          apiKeyLink='https://elevenlabs.io/app/settings/api-keys'
          selected={values.elevenlabs.selected}
          apiKey={values.elevenlabs.apiKey}
          onToggle={toggleElevenlabs}
          onApiKeyChange={(key) => onChange({ ...values, elevenlabs: { ...values.elevenlabs, apiKey: key } })}
        />
      </div>
    </div>
  );
}
