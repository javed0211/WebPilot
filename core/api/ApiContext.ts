import { APIRequestContext, APIResponse } from 'playwright';
import { RuntimeBaseAPI } from './RuntimeBaseAPI';
import { ApiRequestStep } from './types';
import { deepInterpolate, getNestedProperty, interpolateString } from './variableUtils';

export class ApiContext extends RuntimeBaseAPI {
  private variables: Record<string, unknown>;

  constructor(
    requestContext: APIRequestContext,
    initialVariables: Record<string, unknown> = {}
  ) {
    super(requestContext);
    this.variables = { ...initialVariables };
  }

  public getVariables(): Record<string, unknown> {
    return { ...this.variables };
  }

  public setVariable(name: string, value: unknown): void {
    this.variables[name] = value;
  }

  public resolveUrl(url: string): string {
    return interpolateString(url, this.variables);
  }

  public async executeStep(step: ApiRequestStep): Promise<APIResponse> {
    const url = interpolateString(step.url, this.variables);
    const headers = step.headers
      ? (deepInterpolate(step.headers, this.variables) as Record<string, string>)
      : undefined;
    const body =
      step.body !== undefined ? deepInterpolate(step.body, this.variables) : undefined;
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
      const payload = await this.getJson(response);
      if (step.assertions.jsonPath.exists) {
        await this.assertJsonPathExists(payload, step.assertions.jsonPath.path);
      }
      if (step.assertions.jsonPath.equals !== undefined) {
        await this.assertJsonPathEquals(
          payload,
          step.assertions.jsonPath.path,
          step.assertions.jsonPath.equals
        );
      }
    }
    if (step.schema) await this.validateSchema(response, step.schema);
    if (step.extractedVariables) {
      const payload = await this.getJson(response);
      for (const [jsonPath, variableName] of Object.entries(step.extractedVariables)) {
        const value = getNestedProperty(payload, jsonPath);
        if (value !== undefined) this.setVariable(variableName, value);
      }
    }
    return response;
  }
}
