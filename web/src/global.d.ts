type RenkuCookieConsentValue = 'accepted' | 'rejected';

interface PostHogClient {
  init: (apiKey: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
}

interface RenkuCookieConsentController {
  getConsent: () => RenkuCookieConsentValue | null;
  setConsent: (consent: RenkuCookieConsentValue) => void;
  openBanner: () => void;
}

declare global {
  interface Window {
    posthog?: PostHogClient;
    renkuCookieConsent?: RenkuCookieConsentController;
    __renkuPosthogInitialized?: boolean;
    __renkuCookieBannerInitialized?: boolean;
    __renkuScrollDepthInitialized?: boolean;
  }
}

export {};
