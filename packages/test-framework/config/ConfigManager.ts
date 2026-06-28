import * as fs from 'fs';
import * as path from 'path';

export interface EnvConfig {
  environment: string;
  baseUrl: string;
  apiBaseUrl: string;
  credentials: Record<string, string>;
  variables: Record<string, any>;
}

export class ConfigManager {
  private static instance: EnvConfig | null = null;

  /**
   * Loads and parses the environment configuration. Resolves dynamic placeholders from environment variables.
   */
  public static getConfig(): EnvConfig {
    if (this.instance) {
      return this.instance;
    }

    const env = process.env.ENV || 'qa';
    const configPath = path.join(process.cwd(), 'resources', 'config', 'environments', `${env}.json`);

    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found for environment "${env}" at: ${configPath}`);
    }

    const rawContent = fs.readFileSync(configPath, 'utf8');
    let configObj: EnvConfig;
    try {
      configObj = JSON.parse(rawContent);
    } catch (err: any) {
      throw new Error(`Failed to parse configuration file at ${configPath}: ${err.message}`);
    }

    // Resolve system environment variables dynamically: e.g., ${QA_USERNAME}
    const resolvedConfig = this.resolveEnvVars(configObj) as EnvConfig;
    this.instance = resolvedConfig;
    return resolvedConfig;
  }

  private static resolveEnvVars(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/\${(\w+)}/g, (_, varName) => {
        return process.env[varName] !== undefined ? process.env[varName]! : `\${${varName}}`;
      });
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.resolveEnvVars(item));
    } else if (obj !== null && typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const key in obj) {
        result[key] = this.resolveEnvVars(obj[key]);
      }
      return result;
    }
    return obj;
  }
}

export const config = ConfigManager.getConfig();
