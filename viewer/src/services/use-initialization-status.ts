import { useCallback, useEffect, useState } from 'react';
import { getOnboardingStatus } from '@/data/onboarding-client';

interface InitializationStatus {
  initialized: boolean | null;
  isLoading: boolean;
  error: string | null;
  recheck: () => void;
}

export function useInitializationStatus(): InitializationStatus {
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(() => {
    setIsLoading(true);
    setError(null);
    getOnboardingStatus()
      .then((status) => {
        setInitialized(status.initialized);
      })
      .catch((cause) => {
        setInitialized(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to determine initialization status.'
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      check();
    }, 0);
    return () => {
      clearTimeout(timeout);
    };
  }, [check]);

  return { initialized, isLoading, error, recheck: check };
}
