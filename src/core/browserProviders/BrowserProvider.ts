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
  browserName: string;
  browserVersion?: string;
  platform?: string;
  sessionId?: string;
  endpoint?: string;
  videoUrl?: string;
  logsUrl?: string;
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
