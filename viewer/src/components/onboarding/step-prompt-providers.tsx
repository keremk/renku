import { Input } from '@/components/ui/input';

export interface PromptProviderValues {
  openai: { selected: boolean; apiKey: string };
  vercelGateway: { selected: boolean; apiKey: string };
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

interface StepPromptProvidersProps {
  values: PromptProviderValues;
  onChange: (values: PromptProviderValues) => void;
}

export function StepPromptProviders({ values, onChange }: StepPromptProvidersProps) {
  function toggleOpenAI() {
    onChange({ ...values, openai: { ...values.openai, selected: !values.openai.selected } });
  }
  function toggleVercel() {
    onChange({ ...values, vercelGateway: { ...values.vercelGateway, selected: !values.vercelGateway.selected } });
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <p className='text-sm font-medium'>Prompt generation providers</p>
        <p className='text-xs text-muted-foreground'>
          Select at least one provider for script and prompt generation.
        </p>
      </div>

      <div className='space-y-3'>
        <ProviderCard
          name='OpenAI'
          description='GPT-4o for script and prompt generation'
          apiKeyLabel='OPENAI_API_KEY'
          apiKeyLink='https://platform.openai.com/api-keys'
          selected={values.openai.selected}
          apiKey={values.openai.apiKey}
          onToggle={toggleOpenAI}
          onApiKeyChange={(key) => onChange({ ...values, openai: { ...values.openai, apiKey: key } })}
        />

        <ProviderCard
          name='Vercel AI Gateway'
          description='Unified gateway to Claude, Gemini, GPT and more'
          apiKeyLabel='AI_GATEWAY_API_KEY'
          apiKeyLink='https://vercel.com/dashboard/ai'
          selected={values.vercelGateway.selected}
          apiKey={values.vercelGateway.apiKey}
          onToggle={toggleVercel}
          onApiKeyChange={(key) => onChange({ ...values, vercelGateway: { ...values.vercelGateway, apiKey: key } })}
        />
      </div>
    </div>
  );
}
