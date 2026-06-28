import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export type TokenLimitField = 'max_tokens' | 'max_completion_tokens';

export interface ModelCapabilities {
  tokenLimitField: TokenLimitField;
  modelKey: string;
  source: 'override' | 'family' | 'default' | 'probe';
}

interface LlmModelsConfig {
  families?: { match: string; tokenLimitField: TokenLimitField; notes?: string }[];
  defaults?: { tokenLimitField?: TokenLimitField };
  overrides?: Record<string, { tokenLimitField?: TokenLimitField }>;
}

export interface AzureChatPayloadOptions {
  messages: { role: string; content: string }[];
  maxTokens: number;
  temperature?: number;
  responseFormat?: 'json' | 'text';
}

let cachedModelsConfig: LlmModelsConfig | null = null;

function loadModelsConfig(): LlmModelsConfig {
  if (cachedModelsConfig) {
    return cachedModelsConfig;
  }
  const configPath = path.join(process.cwd(), 'resources', 'config', 'llm-models.json');
  if (!fs.existsSync(configPath)) {
    cachedModelsConfig = { defaults: { tokenLimitField: 'max_tokens' } };
    return cachedModelsConfig;
  }
  cachedModelsConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')) as LlmModelsConfig;
  return cachedModelsConfig;
}

function normalizeModelKey(modelOrDeployment: string): string {
  return modelOrDeployment.toLowerCase().replace(/^azure\//, '').trim();
}

export function resolveModelCapabilities(modelOrDeployment: string): ModelCapabilities {
  const key = normalizeModelKey(modelOrDeployment);
  const cfg = loadModelsConfig();

  const override = cfg.overrides?.[key] ?? cfg.overrides?.[modelOrDeployment];
  if (override?.tokenLimitField) {
    return { tokenLimitField: override.tokenLimitField, modelKey: key, source: 'override' };
  }

  for (const family of cfg.families || []) {
    if (key.includes(family.match.toLowerCase())) {
      return {
        tokenLimitField: family.tokenLimitField,
        modelKey: key,
        source: 'family',
      };
    }
  }

  return {
    tokenLimitField: cfg.defaults?.tokenLimitField || 'max_tokens',
    modelKey: key,
    source: 'default',
  };
}

export function buildAzureChatPayload(
  modelOrDeployment: string,
  options: AzureChatPayloadOptions
): Record<string, unknown> {
  const caps = resolveModelCapabilities(modelOrDeployment);
  const payload: Record<string, unknown> = {
    messages: options.messages,
    [caps.tokenLimitField]: options.maxTokens,
  };
  if (options.temperature !== undefined) {
    payload.temperature = options.temperature;
  }
  if (options.responseFormat === 'json') {
    payload.response_format = { type: 'json_object' };
  }
  return payload;
}

export function extractAzureErrorMessage(error: unknown): string {
  const err = error as { response?: { data?: { error?: { message?: string }; message?: string } }; message?: string };
  return (
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    'Unknown Azure OpenAI error'
  );
}

/**
 * Probe the live deployment once and learn which token-limit field it accepts.
 * Result can be persisted to config/llm-models.json overrides by doctor.
 */
export async function probeAzureTokenLimitField(params: {
  endpoint: string;
  deployment: string;
  apiKey: string;
  apiVersion: string;
}): Promise<{ field: TokenLimitField; detail: string }> {
  const endpoint = params.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/openai/deployments/${params.deployment}/chat/completions?api-version=${params.apiVersion}`;
  const headers = { 'api-key': params.apiKey, 'Content-Type': 'application/json' };
  const body = { messages: [{ role: 'user', content: 'ping' }] };

  for (const field of ['max_completion_tokens', 'max_tokens'] as const) {
    try {
      await axios.post(url, { ...body, [field]: 8 }, { headers, timeout: 30000 });
      return { field, detail: `Deployment accepts ${field}` };
    } catch (error) {
      const message = extractAzureErrorMessage(error);
      if (/max_completion_tokens/i.test(message) && field === 'max_tokens') {
        continue;
      }
      if (/max_tokens/i.test(message) && field === 'max_completion_tokens') {
        continue;
      }
      throw new Error(message);
    }
  }

  return { field: 'max_completion_tokens', detail: 'Defaulted to max_completion_tokens after probe' };
}
