import * as fs from 'fs';
import * as path from 'path';
import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseAPI } from './BaseAPI';
import { ApiAuthPlan, ApiRequestStep, HttpMethod } from '../../../src/core/api/types';
import { deepInterpolate, getNestedProperty, interpolateString } from '../../../src/core/api/variableUtils';

/**
 * Scenario-aware API client: variable store + step execution for runners and generated specs.
 */
export class ApiContext extends BaseAPI {
  private variables: Record<string, unknown>;
  private projectRoot: string;

  constructor(
    requestContext: APIRequestContext,
    initialVariables: Record<string, unknown> = {},
    projectRoot = process.cwd()
  ) {
    super(requestContext);
    this.variables = { ...initialVariables };
    this.projectRoot = projectRoot;
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

  public resolveSchema(step: ApiRequestStep): object | undefined {
    if (step.schema) return step.schema;
    if (!step.schemaRef) return undefined;
    const candidates = [
      path.join(this.projectRoot, 'tests', 'api', step.schemaRef),
      path.join(this.projectRoot, step.schemaRef),
      path.join(this.projectRoot, 'tests', 'api', 'schemas', path.basename(step.schemaRef)),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as object;
      }
    }
    throw new Error(`Schema sidecar not found for ${step.schemaRef}`);
  }

  public async executeStep(step: ApiRequestStep): Promise<APIResponse> {
    const url = interpolateString(step.url, this.variables);
    const headers = step.headers
      ? (deepInterpolate(step.headers, this.variables) as Record<string, string>)
      : undefined;
    const body = step.body !== undefined ? deepInterpolate(step.body, this.variables) : undefined;

    // Drop empty Authorization if env token missing
    if (headers?.Authorization && /Bearer\s*$/i.test(headers.Authorization.trim())) {
      delete headers.Authorization;
    }

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
    } else if (step.assertions?.statusIn?.length) {
      await this.assertStatusIn(response, step.assertions.statusIn);
    }

    if (step.assertions?.containsText) {
      await this.assertBodyContains(response, step.assertions.containsText);
    }
    if (step.assertions?.headerEquals) {
      await this.assertHeaderEquals(response, step.assertions.headerEquals);
    }
    if (step.assertions?.jsonPath) {
      const json = await this.getJson(response);
      if (step.assertions.jsonPath.exists) {
        await this.assertJsonPathExists(json, step.assertions.jsonPath.path);
      }
      if (step.assertions.jsonPath.equals !== undefined) {
        await this.assertJsonPathEquals(json, step.assertions.jsonPath.path, step.assertions.jsonPath.equals);
      }
    }

    const schema = this.resolveSchema(step);
    if (schema) {
      await this.validateSchema(response, schema);
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

/**
 * Build Playwright extraHTTPHeaders from an OpenAPI auth plan + environment.
 */
export function resolveApiAuthHeaders(
  auth: ApiAuthPlan | undefined,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  if (!auth || auth.type === 'none') return {};
  const secret = env[auth.envVar]?.trim();
  if (!secret) return {};

  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${secret}` };
  }
  if (auth.type === 'basic') {
    const encoded = secret.includes(':')
      ? Buffer.from(secret).toString('base64')
      : secret;
    return { Authorization: `Basic ${encoded}` };
  }
  if (auth.type === 'apiKey' && auth.name) {
    if (auth.in === 'query') return {};
    return { [auth.name]: secret };
  }
  return {};
}
