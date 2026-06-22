import Ajv from 'ajv';
import { APIRequestContext, APIResponse } from 'playwright';
import { HttpMethod } from './types';
import { getNestedProperty } from './variableUtils';

const ajv = new Ajv({ allErrors: true });

/**
 * Internal TypeScript API runtime used by the orchestration CLI.
 * Generated framework clients use framework/core/base_api.py instead.
 */
export class RuntimeBaseAPI {
  constructor(protected requestContext: APIRequestContext) {}

  public get(url: string, options?: Parameters<APIRequestContext['get']>[1]) {
    return this.requestContext.get(url, options);
  }

  public post(
    url: string,
    data?: unknown,
    options?: Parameters<APIRequestContext['post']>[1]
  ) {
    return this.requestContext.post(url, { data, ...options });
  }

  public put(
    url: string,
    data?: unknown,
    options?: Parameters<APIRequestContext['put']>[1]
  ) {
    return this.requestContext.put(url, { data, ...options });
  }

  public patch(
    url: string,
    data?: unknown,
    options?: Parameters<APIRequestContext['patch']>[1]
  ) {
    return this.requestContext.patch(url, { data, ...options });
  }

  public delete(url: string, options?: Parameters<APIRequestContext['delete']>[1]) {
    return this.requestContext.delete(url, options);
  }

  public head(url: string, options?: Parameters<APIRequestContext['head']>[1]) {
    return this.requestContext.head(url, options);
  }

  public request(
    method: HttpMethod,
    url: string,
    options?: { headers?: Record<string, string>; data?: unknown }
  ) {
    return this.requestContext.fetch(url, { method, ...options });
  }

  public async assertStatus(response: APIResponse, expected: number): Promise<void> {
    if (response.status() !== expected) {
      throw new Error(`Expected status ${expected}, received ${response.status()}`);
    }
  }

  public async assertBodyContains(response: APIResponse, text: string): Promise<void> {
    if (!(await response.text()).includes(text)) {
      throw new Error(`Response body does not contain "${text}"`);
    }
  }

  public async assertJsonPathExists(json: unknown, jsonPath: string): Promise<void> {
    if (getNestedProperty(json, jsonPath) === undefined) {
      throw new Error(`JSON path does not exist: ${jsonPath}`);
    }
  }

  public async assertJsonPathEquals(
    json: unknown,
    jsonPath: string,
    expected: unknown
  ): Promise<void> {
    const actual = getNestedProperty(json, jsonPath);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `JSON path ${jsonPath} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
      );
    }
  }

  public async validateSchema(response: APIResponse, schema: object): Promise<void> {
    const validate = ajv.compile(schema);
    if (!validate(await response.json())) {
      throw new Error(`JSON Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }
  }

  public getJson<T = unknown>(response: APIResponse): Promise<T> {
    return response.json() as Promise<T>;
  }
}
