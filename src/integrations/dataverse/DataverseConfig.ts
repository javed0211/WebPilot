import { ConfigManager } from '../../core/ConfigManager';
import { DataverseConfig } from './types';

const DEFAULT_TIMEOUT = 120_000;

function expand(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? '');
}

export function expandEnvMap(env?: Record<string, string>): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) out[key] = expand(value);
  return out;
}

/**
 * Normalize org URL: strip trailing slash; accept bare hostnames.
 */
export function normalizeEnvironmentUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

export function resolveEnvironmentUrl(raw?: string): string {
  const fromEnv =
    process.env.DATAVERSE_URL ||
    process.env.DATAVERSE_ENVIRONMENT_URL ||
    process.env.DATAVERSE_ORG_URL ||
    '';
  return normalizeEnvironmentUrl(raw?.trim() || fromEnv);
}

export function loadDataverseConfig(): DataverseConfig {
  const raw = (ConfigManager.getInstance().getAll()?.dataverse ?? {}) as DataverseConfig;
  return {
    enabled: Boolean(raw.enabled),
    environmentUrl: resolveEnvironmentUrl(raw.environmentUrl),
    preview: Boolean(raw.preview),
    timeoutMs:
      typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULT_TIMEOUT,
    command: raw.command?.trim() || undefined,
    args: Array.isArray(raw.args) ? raw.args : undefined,
    env: expandEnvMap(raw.env),
  };
}

export function assertDataverseEnabled(
  config: DataverseConfig = loadDataverseConfig()
): DataverseConfig {
  if (!config.enabled) {
    throw new Error(
      'Dataverse integration is disabled. Set dataverse.enabled: true in resources/config/webpilot.yaml.'
    );
  }
  if (!config.environmentUrl) {
    throw new Error(
      'dataverse.environmentUrl is required (or set DATAVERSE_URL). Example: https://contoso.crm.dynamics.com'
    );
  }
  return config;
}

export function mcpEndpoint(environmentUrl: string, preview = false): string {
  const base = normalizeEnvironmentUrl(environmentUrl);
  return `${base}/api/${preview ? 'mcp_preview' : 'mcp'}`;
}
