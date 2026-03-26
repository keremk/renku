/**
 * Client functions for the onboarding API.
 */

export interface OnboardingStatus {
  initialized: boolean;
}

export interface BrowseFolderResult {
  path: string | null;
}

interface OnboardingErrorPayload {
  error?: string;
}

async function readOnboardingError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as OnboardingErrorPayload;
    if (body.error && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }

  if (response.statusText && response.statusText.trim().length > 0) {
    return response.statusText;
  }

  return 'Unknown error';
}

export interface OnboardingSetupData {
  storageRoot: string;
  providers: {
    fal?: { apiKey: string };
    replicate?: { apiKey: string };
    elevenlabs?: { apiKey: string };
  };
  promptProviders: {
    openai?: { apiKey: string };
    vercelGateway?: { apiKey: string };
  };
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const response = await fetch('/viewer-api/onboarding/status');
  if (!response.ok) {
    throw new Error(`Failed to get onboarding status: ${response.statusText}`);
  }
  return response.json() as Promise<OnboardingStatus>;
}

export async function browseFolder(): Promise<BrowseFolderResult> {
  const response = await fetch('/viewer-api/onboarding/browse-folder', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(await readOnboardingError(response));
  }
  return response.json() as Promise<BrowseFolderResult>;
}

export async function setupOnboarding(
  data: OnboardingSetupData
): Promise<void> {
  const response = await fetch('/viewer-api/onboarding/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? response.statusText);
  }
}
