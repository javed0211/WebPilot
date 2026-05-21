import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export class BaseAPI {
  protected requestContext: APIRequestContext;

  constructor(requestContext: APIRequestContext) {
    this.requestContext = requestContext;
  }

  /**
   * Send a GET request
   */
  public async get(url: string, options?: Parameters<APIRequestContext['get']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] GET request to: ${url}`);
    return this.requestContext.get(url, options);
  }

  /**
   * Send a POST request
   */
  public async post(url: string, data?: any, options?: Parameters<APIRequestContext['post']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] POST request to: ${url}`);
    return this.requestContext.post(url, {
      data,
      ...options
    });
  }

  /**
   * Send a PUT request
   */
  public async put(url: string, data?: any, options?: Parameters<APIRequestContext['put']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] PUT request to: ${url}`);
    return this.requestContext.put(url, {
      data,
      ...options
    });
  }

  /**
   * Send a DELETE request
   */
  public async delete(url: string, options?: Parameters<APIRequestContext['delete']>[1]): Promise<APIResponse> {
    console.log(`[BaseAPI] DELETE request to: ${url}`);
    return this.requestContext.delete(url, options);
  }

  /**
   * Assert response status code
   */
  public async assertStatus(response: APIResponse, expectedStatus: number): Promise<void> {
    const status = response.status();
    console.log(`[BaseAPI] Assert status code equals ${expectedStatus} (Actual: ${status})`);
    expect(status).toBe(expectedStatus);
  }

  /**
   * Assert response body contains a specific substring
   */
  public async assertBodyContains(response: APIResponse, text: string): Promise<void> {
    const textBody = await response.text();
    console.log(`[BaseAPI] Assert body contains text: "${text}"`);
    expect(textBody).toContain(text);
  }

  /**
   * Validates response JSON against a contract JSON schema using AJV
   */
  public async validateSchema(response: APIResponse, schema: object): Promise<void> {
    console.log(`[BaseAPI] Validating JSON response schema contract...`);
    const json = await response.json();
    const validate = ajv.compile(schema);
    const valid = validate(json);
    if (!valid) {
      const errorText = ajv.errorsText(validate.errors);
      console.error(`[BaseAPI] [Schema Validation Failed] details:`, errorText);
      throw new Error(`JSON Schema contract validation failed: ${errorText}`);
    }
    console.log(`[BaseAPI] JSON Schema contract validated successfully.`);
  }

  /**
   * Helper to extract body json
   */
  public async getJson<T = any>(response: APIResponse): Promise<T> {
    return response.json() as Promise<T>;
  }
}
