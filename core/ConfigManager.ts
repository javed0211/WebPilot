import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: any = {};

  private constructor() {
    this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Loads and parses the unified webpilot.yaml configuration
   */
  private loadConfig() {
    try {
      const configPath = path.join(process.cwd(), 'config', 'webpilot.yaml');
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf8');
        this.config = yaml.load(fileContent) || {};
      } else {
        console.warn(`[ConfigManager] config/webpilot.yaml not found. Falling back to code defaults.`);
      }
    } catch (err: any) {
      console.error(`[ConfigManager Error] Failed to parse webpilot.yaml:`, err.message);
    }
  }

  /**
   * Retrieves a configuration property using dot-notation (e.g. 'browser.viewport.width')
   */
  public get(key: string, defaultValue?: any): any {
    const parts = key.split('.');
    let current = this.config;
    for (const part of parts) {
      if (current === undefined || current === null) return defaultValue;
      current = current[part];
    }
    return current !== undefined ? current : defaultValue;
  }

  /**
   * Retrieves the raw unified configuration object
   */
  public getAll(): any {
    return this.config;
  }
}
