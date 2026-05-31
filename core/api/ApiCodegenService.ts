import { GeneratedFile } from '../../agents/CodegenAgent';
import { ApiRequestStep, ApiStepExecutionRecord, ApiTestScenario } from './types';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'api-test';
}

function methodNameFromStep(step: ApiRequestStep, index: number): string {
  if (step.name) {
    const fromName = step.name
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('');
    if (fromName && /^[a-z]/.test(fromName)) return fromName.slice(0, 40);
  }
  const pathPart = step.url.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean).pop() ?? 'step';
  return `${step.method.toLowerCase()}${pathPart.charAt(0).toUpperCase()}${pathPart.slice(1)}${index}`;
}

export class ApiCodegenService {
  public static generate(
    scenario: ApiTestScenario,
    steps: ApiRequestStep[],
    _executionLog: ApiStepExecutionRecord[]
  ): GeneratedFile[] {
    const slug = slugify(scenario.name);
    const className =
      slug
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('') + 'Api';

    const clientMethods = steps
      .map((step, i) => ApiCodegenService.renderClientMethod(step, i))
      .join('\n\n');

    const clientFile: GeneratedFile = {
      path: `framework/apis/${className}.ts`,
      content: `import { APIResponse } from '@playwright/test';
import { BaseAPI } from '@core/BaseAPI';

/**
 * Generated API client — ${scenario.name}
 * @generated WebPilot
 */
export class ${className} {
  constructor(private readonly client: BaseAPI) {}

${clientMethods}
}
`
    };

    const specFile: GeneratedFile = {
      path: `framework/tests/api/${slug}.api.spec.ts`,
      content: `import { test } from '@core/fixtures';
import { ${className} } from '../../apis/${className}';

test.describe('API: ${scenario.name.replace(/'/g, "\\'")}', () => {
  test('${scenario.name.replace(/'/g, "\\'")}', async ({ apiClient }) => {
    const api = new ${className}(apiClient);
${steps.map((step, i) => ApiCodegenService.renderSpecCall(step, i)).join('\n')}
  });
});
`
    };

    return [clientFile, specFile];
  }

  /** Playwright fixture sets baseURL to apiBaseUrl — emit path-only URLs in generated code. */
  private static urlForGeneratedClient(url: string): string {
    const stripped = url
      .replace(/^\{\{apiBaseUrl\}\}/i, '')
      .replace(/^\{\{baseUrl\}\}/i, '');
    if (!stripped || stripped.startsWith('{{')) {
      return url.replace(/'/g, "\\'");
    }
    return (stripped.startsWith('/') ? stripped : `/${stripped}`).replace(/'/g, "\\'");
  }

  private static renderClientMethod(step: ApiRequestStep, index: number): string {
    const fn = methodNameFromStep(step, index);
    const url = ApiCodegenService.urlForGeneratedClient(step.url);
    const hasBody = step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method);
    const statusAssert =
      step.assertions?.status !== undefined
        ? `\n    await this.client.assertStatus(response, ${step.assertions.status});`
        : '';

    if (hasBody) {
      return `  async ${fn}(body: unknown): Promise<APIResponse> {
    const response = await this.client.${step.method.toLowerCase()}('${url}', body);${statusAssert}
    return response;
  }`;
    }
    return `  async ${fn}(): Promise<APIResponse> {
    const response = await this.client.${step.method.toLowerCase()}('${url}');${statusAssert}
    return response;
  }`;
  }

  private static renderSpecCall(step: ApiRequestStep, index: number): string {
    const fn = methodNameFromStep(step, index);
    if (step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method)) {
      return `    await api.${fn}(${JSON.stringify(step.body)});`;
    }
    return `    await api.${fn}();`;
  }
}
