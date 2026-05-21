import axios, { AxiosResponse } from 'axios';
import Ajv from 'ajv';
import { LLMClient, LLMMessage } from './LLMClient';
import { Logger } from '../utils/Logger';

const ajv = new Ajv({ allErrors: true });

export interface APIRequestStep {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  extractedVariables?: Record<string, string>; // Maps response json-path to variable name
  schema?: any; // JSON Schema for AJV validation
  assertions?: {
    status?: number;
    containsText?: string;
  };
}

export class APIRunner {
  private sharedVariables: Record<string, any> = {};
  private llm: LLMClient | null = null;

  constructor(initialVariables?: Record<string, any>, llm?: LLMClient) {
    this.sharedVariables = initialVariables ?? {};
    this.llm = llm ?? null;
  }

  /**
   * Replaces variables inside string placeholders (e.g. {{baseUrl}} or {{token}})
   */
  private interpolate(str: string): string {
    return str.replace(/{{(\w+)}}/g, (_, name) => {
      if (this.sharedVariables[name] !== undefined) {
        return String(this.sharedVariables[name]);
      }
      return `{{${name}}}`;
    });
  }

  private deepInterpolate(obj: any): any {
    if (typeof obj === 'string') {
      return this.interpolate(obj);
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.deepInterpolate(item));
    } else if (obj !== null && typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const key in obj) {
        result[key] = this.deepInterpolate(obj[key]);
      }
      return result;
    }
    return obj;
  }

  /**
   * Helper to extract nested json properties (e.g. data.user.id)
   */
  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => {
      return acc && acc[part] !== undefined ? acc[part] : undefined;
    }, obj);
  }

  /**
   * Parses natural language instructions into API Step JSON objects using LLM
   */
  public async parseNaturalLanguageTest(testContent: string): Promise<APIRequestStep[]> {
    if (!this.llm) {
      throw new Error('LLM Client is required to run natural language API parsing.');
    }

    const systemPrompt = `You are the WebPilot API Parsing Agent.
Your job is to read natural language API test stories and translate them into a structured JSON array of API request steps.

Each step in the array MUST strictly match this JSON schema:
{
  "name": "string (Logical step name)",
  "method": "GET" | "POST" | "PUT" | "DELETE",
  "url": "string (URL, supports {{variable}} syntax)",
  "headers": { "string": "string" },
  "body": {},
  "extractedVariables": { "responseBodyPath": "variableName" },
  "schema": {}, (Optional valid JSON schema object to assert against response)
  "assertions": {
    "status": number (Expected status code),
    "containsText": "string"
  }
}

Example NL text:
"Post to login endpoint {{baseUrl}}/api/login with user admin/pass. Extract body.token into token. Then GET user details from {{baseUrl}}/api/user using token header."

Output ONLY raw valid JSON array. Do not include markdown code block formatting.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Parse this API Test narrative:\n\n${testContent}` }
    ];

    const response = await this.llm.complete(messages);

    try {
      let cleanedText = response.text.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '');
      }
      cleanedText = cleanedText.trim();
      return JSON.parse(cleanedText);
    } catch {
      console.error('[API Parser Error] Failed to parse steps as JSON. Content:', response.text);
      return [];
    }
  }

  /**
   * Executes a pipeline of API request steps
   */
  public async runPipeline(steps: APIRequestStep[]): Promise<boolean> {
    Logger.info(`API pipeline — ${steps.length} step${steps.length === 1 ? '' : 's'}`);
    let success = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      Logger.step(i + 1, steps.length, step.name);

      const url = this.interpolate(step.url);
      const headers = this.deepInterpolate(step.headers ?? {});
      const body = this.deepInterpolate(step.body);

      Logger.detail(`${step.method} ${url}`);
      if (Object.keys(headers).length > 0) {
        Logger.detail(`Headers: ${JSON.stringify(headers)}`);
      }
      if (body) {
        Logger.detail(`Body: ${JSON.stringify(body)}`);
      }

      try {
        const startTime = Date.now();
        const response: AxiosResponse = await axios({
          method: step.method,
          url,
          headers,
          data: body,
          validateStatus: () => true, // Don't throw on error statuses, let assertions handle it
          timeout: 10000
        });
        const duration = Date.now() - startTime;

        Logger.success(`Response ${response.status} (${duration}ms)`);

        if (step.assertions) {
          if (step.assertions.status && response.status !== step.assertions.status) {
            Logger.error(`Expected status ${step.assertions.status}, got ${response.status}`);
            success = false;
          }
          if (step.assertions.containsText) {
            const resStr = JSON.stringify(response.data);
            if (!resStr.includes(step.assertions.containsText)) {
              Logger.error(`Response missing text: "${step.assertions.containsText}"`);
              success = false;
            }
          }
        }

        if (step.schema) {
          const validate = ajv.compile(step.schema);
          const valid = validate(response.data);
          if (!valid) {
            Logger.error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
            success = false;
          } else {
            Logger.success('Schema contract validated');
          }
        }

        if (step.extractedVariables) {
          for (const pathKey in step.extractedVariables) {
            const varName = step.extractedVariables[pathKey];
            const value = this.getNestedProperty(response.data, pathKey);
            if (value !== undefined) {
              this.sharedVariables[varName] = value;
              Logger.ai(`Extracted {{${varName}}} ← ${pathKey}`);
            } else {
              Logger.warn(`Could not extract "${pathKey}" from response`);
            }
          }
        }

      } catch (err: any) {
        Logger.error(`Request failed: ${err.message}`);
        success = false;
      }

      if (!success) {
        Logger.error('Aborting API pipeline');
        break;
      }
    }

    return success;
  }

  public getSharedVariables(): Record<string, any> {
    return this.sharedVariables;
  }
}
