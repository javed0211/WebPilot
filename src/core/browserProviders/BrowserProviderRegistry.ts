import { ConfigManager } from '../ConfigManager';
import {
  BrowserProvider,
  BrowserProviderCheck,
  BrowserProviderConfig,
  BrowserProviderName,
  BrowserSessionInfo,
  browserProviderDisplayName,
} from './BrowserProvider';

const PROVIDERS: BrowserProviderName[] = [
  'local-playwright',
  'browser-use',
  'remote-cdp',
  'selenium-grid',
  'browserstack',
  'lambdatest',
  'testmu',
];

function resolveValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const envMatch = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  return envMatch ? process.env[envMatch[1]] : trimmed;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !['false', '0', 'off', 'no'].includes(value.toLowerCase());
  return Boolean(value);
}

function isProviderName(value: string): value is BrowserProviderName {
  return (PROVIDERS as string[]).includes(value);
}

class ConfiguredBrowserProvider implements BrowserProvider {
  constructor(
    public readonly name: BrowserProviderName,
    public readonly config: BrowserProviderConfig
  ) {}

  public sessionInfo(): BrowserSessionInfo {
    return {
      provider: this.name,
      displayName: browserProviderDisplayName(this.name),
      browserName: this.config.browserName,
      browserVersion: this.config.browserVersion,
      platform: this.config.platform,
      endpoint: this.config.endpoint,
    };
  }

  public doctor(): BrowserProviderCheck[] {
    const checks: BrowserProviderCheck[] = [];
    const pass = (label: string) => checks.push({ ok: true, required: true, label });
    const warn = (label: string, fix?: string) =>
      checks.push({ ok: false, required: false, label, fix });
    const fail = (label: string, fix?: string) =>
      checks.push({ ok: false, required: true, label, fix });

    switch (this.name) {
      case 'local-playwright':
        pass(`Provider local-playwright selected (${this.config.browserName})`);
        break;
      case 'browser-use':
        pass(`WebPilot agent provider selected (${this.config.browserName})`);
        break;
      case 'testmu':
        if (!this.config.enabled) warn('TestMu provider is configured but disabled');
        if (this.config.username && this.config.accessKey) {
          pass('TestMu credentials are configured');
        } else {
          fail(
            'TestMu credentials missing',
            'Set TESTMU_USERNAME and TESTMU_ACCESS_KEY or browserProviders.testmu credentials.'
          );
        }
        break;
      case 'remote-cdp':
      case 'selenium-grid':
        if (this.config.endpoint) pass(`${this.name} endpoint is configured`);
        else fail(`${this.name} endpoint missing`, `Set browserProviders.${this.name}.endpoint.`);
        break;
      case 'browserstack':
      case 'lambdatest':
        if (this.config.username && this.config.accessKey) pass(`${this.name} credentials are configured`);
        else {
          fail(
            `${this.name} credentials missing`,
            `Set browserProviders.${this.name}.username and accessKey.`
          );
        }
        break;
      default:
        fail(`Unknown provider ${this.name}`);
    }

    return checks;
  }
}

export class BrowserProviderRegistry {
  public static availableProviders(): BrowserProviderName[] {
    return [...PROVIDERS];
  }

  public static activeName(override?: string): BrowserProviderName {
    const cm = ConfigManager.getInstance();
    const raw = String(
      override ||
        process.env.WEBPILOT_BROWSER_PROVIDER ||
        cm.get('browserProviders.active') ||
        (cm.get('browser.testmu.enabled', false)
          ? 'testmu'
          : cm.get('framework.useBrowserUse', false)
            ? 'browser-use'
            : 'local-playwright')
    );
    if (!isProviderName(raw)) {
      throw new Error(
        `Unknown browser provider "${raw}". Supported providers: ${PROVIDERS.join(', ')}`
      );
    }
    return raw;
  }

  public static resolve(override?: string): BrowserProvider {
    const cm = ConfigManager.getInstance();
    const name = BrowserProviderRegistry.activeName(override);
    const browser = cm.get('browser', {});
    const providers = cm.get('browserProviders', {});
    const providerRaw = ((providers?.[name] || {}) as Record<string, unknown>) || {};
    const legacyTestMu = name === 'testmu' ? (browser?.testmu || {}) : {};
    const raw = { ...providerRaw, ...legacyTestMu };

    const browserName =
      resolveValue(raw.browserName) ||
      resolveValue(raw.target) ||
      resolveValue(browser?.target) ||
      (name === 'local-playwright' ? 'chromium' : 'chrome');
    const endpoint = resolveValue(raw.endpoint);
    const username = resolveValue(raw.username);
    const accessKey = resolveValue(raw.accessKey);
    const viewport = raw.viewport || browser?.viewport;

    return new ConfiguredBrowserProvider(name, {
      name,
      browserName,
      headless: boolValue(raw.headless, boolValue(browser?.headless, true)),
      viewport:
        viewport && typeof viewport === 'object'
          ? (viewport as { width: number; height: number })
          : undefined,
      endpoint,
      enabled: boolValue(raw.enabled, name !== 'testmu' || boolValue(browser?.testmu?.enabled, false)),
      username,
      accessKey,
      browserVersion: resolveValue(raw.browserVersion),
      platform: resolveValue(raw.platform),
      raw,
    });
  }

  /**
   * Headless mode from resources/config/webpilot.yaml only
   * (browserProviders.<active>.headless → browser.headless → true).
   */
  public static resolveHeadless(providerOverride?: string): boolean {
    return BrowserProviderRegistry.resolve(providerOverride).config.headless;
  }

  /** Inverse of resolveHeadless — visible browser when yaml says headless: false. */
  public static resolveHeaded(providerOverride?: string): boolean {
    return !BrowserProviderRegistry.resolveHeadless(providerOverride);
  }
}
