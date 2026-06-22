import { GeneratedFile } from '../../agents/CodegenAgent';
import { ApiRequestStep, ApiStepExecutionRecord, ApiTestScenario } from './types';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48) || 'api_test'
  );
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function methodNameFromStep(step: ApiRequestStep, index: number): string {
  if (step.name) return snakeCase(step.name).slice(0, 40);
  const pathPart =
    step.url.replace(/\{\{[^}]+\}\}/g, '').split('/').filter(Boolean).pop() ?? 'step';
  return `${step.method.toLowerCase()}_${snakeCase(pathPart)}_${index}`;
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
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Api';
    const moduleName = `${slug}_api`;

    return [
      {
        path: `framework/apis/${moduleName}.py`,
        content: `from playwright.sync_api import APIResponse

from framework.core.base_api import BaseAPI


class ${className}:
    """Generated API client — ${scenario.name.replace(/"""/g, '')}."""

    def __init__(self, client: BaseAPI) -> None:
        self.client = client

${steps.map((step, index) => ApiCodegenService.renderClientMethod(step, index)).join('\n\n')}
`,
      },
      {
        path: `framework/tests/api/test_${slug}.py`,
        content: `import json

import pytest

from framework.apis.${moduleName} import ${className}
from framework.core.base_api import BaseAPI


@pytest.mark.api
def test_${slug}(api_client: BaseAPI) -> None:
    api = ${className}(api_client)
${steps.map((step, index) => ApiCodegenService.renderTestCall(step, index)).join('\n')}
`,
      },
    ];
  }

  private static urlForGeneratedClient(url: string): string {
    if (/^https?:\/\//i.test(url)) return url.replace(/'/g, "\\'");
    const stripped = url
      .replace(/^\{\{apiBaseUrl\}\}/i, '')
      .replace(/^\{\{baseUrl\}\}/i, '');
    if (!stripped || stripped.startsWith('{{')) return url.replace(/'/g, "\\'");
    return (stripped.startsWith('/') ? stripped : `/${stripped}`).replace(/'/g, "\\'");
  }

  private static renderClientMethod(step: ApiRequestStep, index: number): string {
    const methodName = methodNameFromStep(step, index);
    const url = ApiCodegenService.urlForGeneratedClient(step.url);
    const hasBody = step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method);
    const statusAssert =
      step.assertions?.status !== undefined
        ? `\n        self.client.assert_status(response, ${step.assertions.status})`
        : '';
    if (hasBody) {
      return `    def ${methodName}(self, body: object) -> APIResponse:
        response = self.client.${step.method.toLowerCase()}('${url}', body)${statusAssert}
        return response`;
    }
    return `    def ${methodName}(self) -> APIResponse:
        response = self.client.${step.method.toLowerCase()}('${url}')${statusAssert}
        return response`;
  }

  private static renderTestCall(step: ApiRequestStep, index: number): string {
    const methodName = methodNameFromStep(step, index);
    if (step.body !== undefined && ['POST', 'PUT', 'PATCH'].includes(step.method)) {
      const body = JSON.stringify(JSON.stringify(step.body));
      return `    api.${methodName}(json.loads(${body}))`;
    }
    return `    api.${methodName}()`;
  }
}
