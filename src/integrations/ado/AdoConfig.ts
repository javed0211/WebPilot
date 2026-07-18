import { ConfigManager } from '../../core/ConfigManager';
import { AdoAuthMode, AdoConfig } from './types';

const DEFAULT_DOMAINS = ['core', 'work-items', 'test-plans'];
const DEFAULT_TIMEOUT = 90_000;

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
 * Resolves a Personal Access Token from common ADO / Azure CLI env names.
 */
export function resolveAdoPat(): string | undefined {
  const candidates = [
    process.env.ADO_MCP_AUTH_TOKEN,
    process.env.AZURE_DEVOPS_EXT_PAT,
    process.env.AZURE_DEVOPS_PAT,
    process.env.SYSTEM_ACCESSTOKEN,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function loadAdoConfig(): AdoConfig {
  const raw = (ConfigManager.getInstance().getAll()?.ado ?? {}) as AdoConfig;
  return {
    enabled: Boolean(raw.enabled),
    organization: raw.organization?.trim() || process.env.AZURE_DEVOPS_ORG || '',
    project: raw.project?.trim() || process.env.AZURE_DEVOPS_PROJECT || '',
    auth: (raw.auth === 'azcli' ? 'azcli' : 'pat') as AdoAuthMode,
    tenant: raw.tenant?.trim() || undefined,
    domains: Array.isArray(raw.domains) && raw.domains.length > 0 ? raw.domains : DEFAULT_DOMAINS,
    timeoutMs: typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULT_TIMEOUT,
    testPlans: {
      defaultPlanName: raw.testPlans?.defaultPlanName || 'WebPilot Automation',
      autoPublishResults: Boolean(raw.testPlans?.autoPublishResults),
    },
    command: raw.command?.trim() || undefined,
    args: Array.isArray(raw.args) ? raw.args : undefined,
    env: expandEnvMap(raw.env),
  };
}

export function assertAdoEnabled(
  config: AdoConfig = loadAdoConfig(),
  options: { requirePat?: boolean } = {}
): AdoConfig {
  if (!config.enabled) {
    throw new Error(
      'Azure DevOps integration is disabled. Set ado.enabled: true in resources/config/webpilot.yaml.'
    );
  }
  if (!config.organization) {
    throw new Error(
      'ado.organization is required (or set AZURE_DEVOPS_ORG). Example: ado.organization: "contoso".'
    );
  }
  if (!config.project) {
    throw new Error(
      'ado.project is required (or set AZURE_DEVOPS_PROJECT). Example: ado.project: "MyProject".'
    );
  }
  const requirePat = options.requirePat !== false;
  if (requirePat && config.auth === 'pat' && !resolveAdoPat()) {
    throw new Error(
      'ADO PAT not found. Set ADO_MCP_AUTH_TOKEN, AZURE_DEVOPS_EXT_PAT, or AZURE_DEVOPS_PAT.'
    );
  }
  return config;
}

export function orgUrl(organization: string): string {
  return `https://dev.azure.com/${organization}`;
}
