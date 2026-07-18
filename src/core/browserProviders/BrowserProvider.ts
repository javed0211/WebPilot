export type BrowserProviderName =
  | 'local-playwright'
  | 'browser-use'
  | 'remote-cdp'
  | 'selenium-grid'
  | 'browserstack'
  | 'lambdatest'
  | 'testmu';

export interface BrowserSessionInfo {
  provider: BrowserProviderName;
  /** Customer-facing label (e.g. "WebPilot agent" for provider browser-use). */
  displayName?: string;
  browserName: string;
  browserVersion?: string;
  platform?: string;
  sessionId?: string;
  endpoint?: string;
  videoUrl?: string;
  logsUrl?: string;
}

/** Human-readable provider label for logs and HTML reports. */
export function browserProviderDisplayName(provider?: string | null): string {
  switch (provider) {
    case 'browser-use':
      return 'WebPilot agent';
    case 'local-playwright':
      return 'Local Playwright';
    case 'testmu':
      return 'TestMu';
    case 'remote-cdp':
      return 'Remote CDP';
    case 'selenium-grid':
      return 'Selenium Grid';
    case 'browserstack':
      return 'BrowserStack';
    case 'lambdatest':
      return 'LambdaTest';
    default:
      return provider || 'local-playwright';
  }
}

export interface BrowserProviderCheck {
  ok: boolean;
  required: boolean;
  label: string;
  fix?: string;
}

export interface BrowserProviderConfig {
  name: BrowserProviderName;
  browserName: string;
  headless: boolean;
  viewport?: { width: number; height: number };
  endpoint?: string;
  enabled?: boolean;
  username?: string;
  accessKey?: string;
  browserVersion?: string;
  platform?: string;
  raw: Record<string, unknown>;
}

export interface BrowserProvider {
  name: BrowserProviderName;
  config: BrowserProviderConfig;
  sessionInfo(): BrowserSessionInfo;
  doctor(): BrowserProviderCheck[];
}
