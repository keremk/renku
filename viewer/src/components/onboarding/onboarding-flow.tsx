import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { OnboardingCard } from './onboarding-card.js';
import { StepWelcome } from './step-welcome.js';
import { StepStorage } from './step-storage.js';
import { StepMediaProviders, type MediaProviderValues } from './step-media-providers.js';
import { StepPromptProviders, type PromptProviderValues } from './step-prompt-providers.js';
import { StepCongrats } from './step-congrats.js';
import { setupOnboarding } from '@/data/onboarding-client';

const TOTAL_STEPS = 5;

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(1);
  const [storageRoot, setStorageRoot] = useState('');
  const [mediaProviders, setMediaProviders] = useState<MediaProviderValues>({
    fal: { selected: false, apiKey: '' },
    replicate: { selected: false, apiKey: '' },
    elevenlabs: { selected: false, apiKey: '' },
  });
  const [promptProviders, setPromptProviders] = useState<PromptProviderValues>({
    openai: { selected: false, apiKey: '' },
    vercelGateway: { selected: false, apiKey: '' },
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const stepTitles: Record<number, string> = {
    1: 'Welcome',
    2: 'Storage Setup',
    3: 'Media Providers',
    4: 'Prompt Providers',
    5: 'All Done',
  };

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  function handleNext() {
    if (step === 4) {
      void handleFinish();
      return;
    }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  }

  async function handleFinish() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await setupOnboarding({
        storageRoot: storageRoot.trim(),
        providers: {
          ...(mediaProviders.fal.selected && mediaProviders.fal.apiKey
            ? { fal: { apiKey: mediaProviders.fal.apiKey } }
            : {}),
          ...(mediaProviders.replicate.selected && mediaProviders.replicate.apiKey
            ? { replicate: { apiKey: mediaProviders.replicate.apiKey } }
            : {}),
          ...(mediaProviders.elevenlabs.selected && mediaProviders.elevenlabs.apiKey
            ? { elevenlabs: { apiKey: mediaProviders.elevenlabs.apiKey } }
            : {}),
        },
        promptProviders: {
          ...(promptProviders.openai.selected && promptProviders.openai.apiKey
            ? { openai: { apiKey: promptProviders.openai.apiKey } }
            : {}),
          ...(promptProviders.vercelGateway.selected && promptProviders.vercelGateway.apiKey
            ? { vercelGateway: { apiKey: promptProviders.vercelGateway.apiKey } }
            : {}),
        },
      });
      setStep(5);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Setup failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  function getNextLabel(): string {
    if (step === 4) return isSubmitting ? 'Setting up...' : 'Finish';
    if (step === TOTAL_STEPS) return 'Open Renku Home';
    return 'Next →';
  }

  function isNextDisabled(): boolean {
    if (step === 2) return !storageRoot.trim();
    if (step === 3) {
      return !mediaProviders.fal.selected && !mediaProviders.replicate.selected && !mediaProviders.elevenlabs.selected;
    }
    if (step === 4) {
      return !promptProviders.openai.selected && !promptProviders.vercelGateway.selected;
    }
    return false;
  }

  const configuredMediaProviders = [
    mediaProviders.fal.selected ? 'fal.ai' : null,
    mediaProviders.replicate.selected ? 'Replicate' : null,
    mediaProviders.elevenlabs.selected ? 'ElevenLabs' : null,
  ].filter((v): v is string => v !== null);

  const configuredPromptProviders = [
    promptProviders.openai.selected ? 'OpenAI' : null,
    promptProviders.vercelGateway.selected ? 'Vercel AI Gateway' : null,
  ].filter((v): v is string => v !== null);

  return (
    <OnboardingCard
      step={step}
      totalSteps={TOTAL_STEPS}
      title={stepTitles[step] ?? ''}
      onBack={handleBack}
      onNext={handleNext}
      nextLabel={getNextLabel()}
      nextDisabled={isNextDisabled()}
      isLoading={isSubmitting}
    >
      {step === 1 && <StepWelcome />}
      {step === 2 && (
        <StepStorage value={storageRoot} onChange={setStorageRoot} />
      )}
      {step === 3 && (
        <StepMediaProviders values={mediaProviders} onChange={setMediaProviders} />
      )}
      {step === 4 && (
        <>
          <StepPromptProviders values={promptProviders} onChange={setPromptProviders} />
          {submitError && (
            <p className='mt-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-3'>
              {submitError}
            </p>
          )}
        </>
      )}
      {step === 5 && (
        <StepCongrats
          storageRoot={storageRoot}
          mediaProviders={configuredMediaProviders}
          promptProviders={configuredPromptProviders}
        />
      )}
      {isSubmitting && step === 4 && (
        <div className='flex items-center gap-2 mt-3 text-sm text-muted-foreground'>
          <Loader2 className='w-4 h-4 animate-spin' />
          Initializing workspace...
        </div>
      )}
    </OnboardingCard>
  );
}
