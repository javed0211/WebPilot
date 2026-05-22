import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import Ajv from 'ajv';
import { HttpMethod } from '../../core/api/types';
import { getNestedProperty } from '../../core/api/variableUtils';

const ajv = new Ajv({ allErrors: true });

export class BaseAPI {
  protected requestContext: APIRequestContext;

  constructor(requestContext: APIRequestContext) {
    this.requestContext = requestContext;
  }

  /** Used by generated API clients and runners that wrap the same Playwright context. */
  public getRequestContext(): APIRequestContext {
    return this.requestContext;
  }

  public async get(url: string, options?: Parameters<APIRequestContext['get']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] GET ${url}`);
    return this.requestContext.get(url, options);
  }

  public async post(url: string, data?: unknown, options?: Parameters<APIRequestContext['post']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] POST ${url}`);
    return this.requestContext.post(url, { data, ...options });
  }

  public async put(url: string, data?: unknown, options?: Parameters<APIRequestContext['put']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] PUT ${url}`);
    return this.requestContext.put(url, { data, ...options });
  }

  public async patch(url: string, data?: unknown, options?: Parameters<APIRequestContext['patch']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] PATCH ${url}`);
    return this.requestContext.patch(url, { data, ...options });
  }

  public async delete(url: string, options?: Parameters<APIRequestContext['delete']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] DELETE ${url}`);
    return this.requestContext.delete(url, options);
  }

  public async head(url: string, options?: Parameters<APIRequestContext['head']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] HEAD ${url}`);
    return this.requestContext.head(url, options);
  }

  public async request(
    method: HttpMethod,
    url: string,
    options?: { headers?: Record<string, string>; data?: unknown }
  ): Promise<APIResponse> {
    console.log(`[BaseAPI] ${method} ${url}`);
    return this.requestContext.fetch(url, { method, ...options });
  }

  public async assertStatus(response: APIResponse, expectedStatus: number): Promise<void> {
    const status = response.status();
    console.log(`[BaseAPI] Assert status ${expectedStatus} (actual: ${status})`);
    expect(status).toBe(expectedStatus);
  }

  public async assertBodyContains(response: APIResponse, text: string): Promise<void> {
    const textBody = await response.text();
    console.log(`[BaseAPI] Assert body contains: "${text}"`);
    expect(textBody).toContain(text);
  }

  public async assertJsonPathExists(json: unknown, jsonPath: string): Promise<void> {
    const value = getNestedProperty(json, jsonPath);
    console.log(`[BaseAPI] Assert JSON path exists: ${jsonPath}`);
    expect(value).not.toBeUndefined();
  }

  public async assertJsonPathEquals(json: unknown, jsonPath: string, expected: unknown): Promise<void> {
    const value = getNestedProperty(json, jsonPath);
    console.log(`[BaseAPI] Assert ${jsonPath} === ${JSON.stringify(expected)}`);
    expect(value).toEqual(expected);
  }

  public extractFromResponse<T = unknown>(json: unknown, jsonPath: string): T | undefined {
    return getNestedProperty(json, jsonPath) as T | undefined;
  }

  public async validateSchema(response: APIResponse, schema: object): Promise<void> {
    console.log(`[BaseAPI] Validating JSON schema...`);
    const json = await response.json();
    const validate = ajv.compile(schema);
    const valid = validate(json);
    if (!valid) {
      const errorText = ajv.errorsText(validate.errors);
      console.error(`[BaseAPI] Schema validation failed:`, errorText);
      throw new Error(`JSON Schema validation failed: ${errorText}`);
    }
    console.log(`[BaseAPI] Schema validated.`);
  }

  public async getJson<T = unknown>(response: APIResponse): Promise<T> {
    return response.json() as Promise<T>;
  }

  public async getText(response: APIResponse): Promise<string> {
    return response.text();
  }

  public async saveResponseBody(response: APIResponse, filePath: string): Promise<void> {
    const fs = await import('fs');
    const body = await response.text();
    fs.writeFileSync(filePath, body, 'utf8');
  }
}
