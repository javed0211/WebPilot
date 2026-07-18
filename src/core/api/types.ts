export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiRequestStep {
  name: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  extractedVariables?: Record<string, string>;
  /** Response JSON Schema (OpenAPI) — validated via Ajv when present. */
  schema?: object;
  /** Relative path to a sidecar schema file under tests/api/ (for NL scenarios). */
  schemaRef?: string;
  operationId?: string;
  tags?: string[];
  assertions?: {
    status?: number;
    statusIn?: number[];
    containsText?: string;
    jsonPath?: { path: string; equals?: unknown; exists?: boolean };
    headerEquals?: Record<string, string>;
  };
}

export type ApiSourceType = 'plain-text' | 'openapi-url' | 'openapi-file' | 'openapi-inline';

export type ApiAuthType = 'bearer' | 'apiKey' | 'basic' | 'none';

export interface ApiAuthPlan {
  type: ApiAuthType;
  /** Env var holding the secret (bearer token, API key, or user:pass for basic). */
  envVar: string;
  /** For apiKey: header or query param name. */
  name?: string;
  in?: 'header' | 'query';
  scheme?: string;
}

export interface ApiTestScenario {
  name: string;
  sourceType: ApiSourceType;
  sourceRef?: string;
  tags?: string[];
  steps: ApiRequestStep[];
  variables?: Record<string, unknown>;
  auth?: ApiAuthPlan;
  /** When true, parser could not produce steps and LLM parsing is required */
  needsLlm?: boolean;
  rawContent?: string;
}

export interface ApiStepExecutionRecord {
  stepIndex: number;
  stepName: string;
  method: HttpMethod;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  status: number;
  durationMs: number;
  success: boolean;
  error?: string;
  responsePreview?: string;
}

export interface ApiExecutionResult {
  success: boolean;
  steps: ApiStepExecutionRecord[];
  variables: Record<string, unknown>;
}
