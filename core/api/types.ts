export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ApiRequestStep {
  name: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  extractedVariables?: Record<string, string>;
  schema?: object;
  assertions?: {
    status?: number;
    containsText?: string;
    jsonPath?: { path: string; equals?: unknown; exists?: boolean };
  };
}

export type ApiSourceType = 'plain-text' | 'openapi-url' | 'openapi-file' | 'openapi-inline';

export interface ApiTestScenario {
  name: string;
  sourceType: ApiSourceType;
  sourceRef?: string;
  tags?: string[];
  steps: ApiRequestStep[];
  variables?: Record<string, unknown>;
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
