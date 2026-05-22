import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseAPI } from './BaseAPI';
import { ApiRequestStep, HttpMethod } from '../../core/api/types';
import { deepInterpolate, getNestedProperty, interpolateString } from '../../core/api/variableUtils';

/**
 * Scenario-aware API client: variable store + step execution for runners and generated specs.
 */
export class ApiContext extends BaseAPI {
  private variables: Record<string, unknown>;

  constructor(requestContext: APIRequestContext, initialVariables: Record<string, unknown> = {}) {
    super(requestContext);
    this.variables = { ...initialVariables };
  }

  public getVariables(): Record<string, unknown> {
    return { ...this.variables };
  }

  public setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  public mergeVariables(vars: Record<string, unknown>): void {
    this.variables = { ...this.variables, ...vars };
  }

  public resolveUrl(url: string): string {
    return interpolateString(url, this.variables);
  }

  public async executeStep(step: ApiRequestStep): Promise<APIResponse> {
    const url = interpolateString(step.url, this.variables);
    const headers = step.headers
      ? (deepInterpolate(step.headers, this.variables) as Record<string, string>)
      : undefined;
    const body = step.body !== undefined ? deepInterpolate(step.body, this.variables) : undefined;

    const options = { headers, data: body };
    let response: APIResponse;

    switch (step.method) {
      case 'GET':
        response = await this.get(url, options);
        break;
      case 'POST':
        response = await this.post(url, body, options);
        break;
      case 'PUT':
        response = await this.put(url, body, options);
        break;
      case 'PATCH':
        response = await this.patch(url, body, options);
        break;
      case 'DELETE':
        response = await this.delete(url, options);
        break;
      case 'HEAD':
        response = await this.head(url, options);
        break;
      default:
        response = await this.request(step.method, url, options);
    }

    if (step.assertions?.status !== undefined) {
      await this.assertStatus(response, step.assertions.status);
    }
    if (step.assertions?.containsText) {
      await this.assertBodyContains(response, step.assertions.containsText);
    }
    if (step.assertions?.jsonPath) {
      const json = await this.getJson(response);
      const value = getNestedProperty(json, step.assertions.jsonPath.path);
      if (step.assertions.jsonPath.exists) {
        await this.assertJsonPathExists(json, step.assertions.jsonPath.path);
      }
      if (step.assertions.jsonPath.equals !== undefined) {
        await this.assertJsonPathEquals(json, step.assertions.jsonPath.path, step.assertions.jsonPath.equals);
      }
    }

    if (step.schema) {
      await this.validateSchema(response, step.schema);
    }

    if (step.extractedVariables) {
      const json = await this.getJson(response);
      for (const [pathKey, varName] of Object.entries(step.extractedVariables)) {
        const value = getNestedProperty(json, pathKey);
        if (value !== undefined) {
          this.setVariable(varName, value);
        }
      }
    }

    return response;
  }
}
