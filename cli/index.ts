import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import { Engine } from '../core/Engine';
import { APIRunner } from '../core/APIRunner';
import { LLMClient } from '../core/LLMClient';
import { CliDisplay } from '../utils/CliDisplay';
import { UsageTracker } from '../utils/UsageTracker';
import { Logger } from '../utils/Logger';

const program = new Command();

program
  .name('webpilot')
  .description('WebPilot: Production-Grade AI-Native Quality Engineering Platform')
  .version('1.0.0');

/**
 * COMMAND: init
 */
program
  .command('init')
  .description('Scaffold a brand new WebPilot AI QE project')
  .action(async () => {
    const spinner = ora('Scaffolding project directories...').start();
    try {
      const dirs = [
        'config/environments',
        'tests/web',
        'tests/api',
        'tests/bdd',
        'framework/core',
        'framework/pages',
        'framework/tests',
        'reports/videos',
        'reports/traces',
        'artifacts',
        'prompts',
        'agents',
        'core',
        'utils',
        'healing-cache',
        'reports/assets',
        'cli'
      ];

      dirs.forEach(d => fs.mkdirSync(path.join(process.cwd(), d), { recursive: true }));

      // Define path helper
      const writeFrameworkFile = (subdir: string, filename: string, content: string) => {
        const dirPath = path.join(process.cwd(), 'framework', subdir);
        fs.mkdirSync(dirPath, { recursive: true });
        const filePath = path.join(dirPath, filename);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content.trim() + '\n', 'utf8');
        }
      };

      // 1. Scaffold BasePage.ts
      writeFrameworkFile('core', 'BasePage.ts', `import { Page, expect } from '@playwright/test';

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  public async navigate(url: string): Promise<void> {
    console.log(\`[BasePage] Navigating to URL: \${url}\`);
    await this.page.goto(url, { waitUntil: 'load' });
  }

  public async click(selector: string, timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Action: Click element matching "\${selector}"\`);
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }

  public async fill(selector: string, value: string, timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Action: Fill field "\${selector}" with value: "\${value}"\`);
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.fill(value);
  }

  public async getText(selector: string, timeout = 10000): Promise<string> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    const text = await locator.innerText();
    return text.trim();
  }

  public async isVisible(selector: string, timeout = 5000): Promise<boolean> {
    try {
      const locator = this.page.locator(selector);
      await locator.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  public async scrollIntoView(selector: string, timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Action: Scroll into view: "\${selector}"\`);
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'attached', timeout });
    await locator.scrollIntoViewIfNeeded();
  }

  public async selectOption(selector: string, value: string | string[], timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Action: Select option: "\${value}" from "\${selector}"\`);
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.selectOption(value);
  }

  public async assertTitle(expectedTitle: string): Promise<void> {
    console.log(\`[BasePage] Assertion: Verify page title equals "\${expectedTitle}"\`);
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  public async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    console.log(\`[BasePage] Assertion: Verify page URL matches "\${expectedUrl}"\`);
    await expect(this.page).toHaveURL(expectedUrl);
  }

  public async assertTextPresent(selector: string, text: string, timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Assertion: Verify text "\${text}" is present within selector "\${selector}"\`);
    const locator = this.page.locator(selector);
    await expect(locator).toContainText(text, { timeout });
  }

  public async assertElementVisible(selector: string, timeout = 10000): Promise<void> {
    console.log(\`[BasePage] Assertion: Verify element visibility matching "\${selector}"\`);
    const locator = this.page.locator(selector);
    await expect(locator).toBeVisible({ timeout });
  }
}`);

      // 2. Scaffold BaseAPI.ts
      writeFrameworkFile('core', 'BaseAPI.ts', `import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export class BaseAPI {
  protected requestContext: APIRequestContext;

  constructor(requestContext: APIRequestContext) {
    this.requestContext = requestContext;
  }

  public async get(url: string, options?: Parameters<APIRequestContext['get']>[1]): Promise<APIResponse> {
    console.log(\`[BaseAPI] GET request to: \${url}\`);
    return this.requestContext.get(url, options);
  }

  public async post(url: string, data?: any, options?: Parameters<APIRequestContext['post']>[1]): Promise<APIResponse> {
    console.log(\`[BaseAPI] POST request to: \${url}\`);
    return this.requestContext.post(url, { data, ...options });
  }

  public async put(url: string, data?: any, options?: Parameters<APIRequestContext['put']>[1]): Promise<APIResponse> {
    console.log(\`[BaseAPI] PUT request to: \${url}\`);
    return this.requestContext.put(url, { data, ...options });
  }

  public async delete(url: string, options?: Parameters<APIRequestContext['delete']>[1]): Promise<APIResponse> {
    console.log(\`[BaseAPI] DELETE request to: \${url}\`);
    return this.requestContext.delete(url, options);
  }

  public async assertStatus(response: APIResponse, expectedStatus: number): Promise<void> {
    const status = response.status();
    console.log(\`[BaseAPI] Assert status code equals \${expectedStatus} (Actual: \${status})\`);
    expect(status).toBe(expectedStatus);
  }

  public async assertBodyContains(response: APIResponse, text: string): Promise<void> {
    const textBody = await response.text();
    console.log(\`[BaseAPI] Assert body contains text: "\${text}"\`);
    expect(textBody).toContain(text);
  }

  public async validateSchema(response: APIResponse, schema: object): Promise<void> {
    console.log(\`[BaseAPI] Validating JSON response schema contract...\`);
    const json = await response.json();
    const validate = ajv.compile(schema);
    const valid = validate(json);
    if (!valid) {
      const errorText = ajv.errorsText(validate.errors);
      console.error(\`[BaseAPI] [Schema Validation Failed] details:\`, errorText);
      throw new Error(\`JSON Schema contract validation failed: \${errorText}\`);
    }
    console.log(\`[BaseAPI] JSON Schema contract validated successfully.\`);
  }

  public async getJson<T = any>(response: APIResponse): Promise<T> {
    return response.json() as Promise<T>;
  }
}`);

      // 3. Scaffold fixtures.ts
      writeFrameworkFile('core', 'fixtures.ts', `import { test as base, expect } from '@playwright/test';
import { config } from '@config/ConfigManager';
import { BaseAPI } from '@core/BaseAPI';

export type WebPilotFixtures = {
  apiClient: BaseAPI;
};

export const test = base.extend<WebPilotFixtures>({
  apiClient: async ({ playwright }, use) => {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (process.env.AUTH_TOKEN) {
      headers['Authorization'] = \`Bearer \${process.env.AUTH_TOKEN}\`;
    }

    const requestContext = await playwright.request.newContext({
      baseURL: config.apiBaseUrl || undefined,
      extraHTTPHeaders: headers
    });

    const client = new BaseAPI(requestContext);
    await use(client);
    await requestContext.dispose();
  }
});

export { expect };`);

      // 4. Scaffold ConfigManager.ts
      writeFrameworkFile('config', 'ConfigManager.ts', `import * as fs from 'fs';
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

  public static getConfig(): EnvConfig {
    if (this.instance) return this.instance;
    const env = process.env.ENV || 'qa';
    const configPath = path.join(process.cwd(), 'config', 'environments', \`\${env}.json\`);
    if (!fs.existsSync(configPath)) {
      throw new Error(\`Configuration file not found for environment "\${env}" at: \${configPath}\`);
    }
    const rawContent = fs.readFileSync(configPath, 'utf8');
    let configObj: EnvConfig;
    try {
      configObj = JSON.parse(rawContent);
    } catch (err: any) {
      throw new Error(\`Failed to parse configuration file at \${configPath}: \${err.message}\`);
    }
    const resolvedConfig = this.resolveEnvVars(configObj) as EnvConfig;
    this.instance = resolvedConfig;
    return resolvedConfig;
  }

  private static resolveEnvVars(obj: any): any {
    if (typeof obj === 'string') {
      return obj.replace(/\\$\\{(\\w+)\\}/g, (_, varName) => {
        return process.env[varName] !== undefined ? process.env[varName]! : \`\\\${varName}\`;
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

export const config = ConfigManager.getConfig();`);

      // 5. Scaffold DataLoader.ts
      writeFrameworkFile('data', 'DataLoader.ts', `import * as fs from 'fs';
import * as path from 'path';
import { config } from '@config/ConfigManager';

export class DataLoader {
  public static loadJson<T = any>(filename: string): T {
    const searchPaths = [
      path.join(process.cwd(), 'data', filename),
      path.join(process.cwd(), 'framework', 'data', filename),
      path.join(process.cwd(), 'data', config.environment, filename),
      path.join(process.cwd(), 'framework', 'data', config.environment, filename),
    ];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        try {
          return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
        } catch (err: any) {
          throw new Error(\`Failed to parse JSON file at \${p}: \${err.message}\`);
        }
      }
    }
    throw new Error(\`Data file "\${filename}" not found in any standard data directories.\`);
  }

  public static loadCsv(filename: string): Record<string, string>[] {
    const searchPaths = [
      path.join(process.cwd(), 'data', filename),
      path.join(process.cwd(), 'framework', 'data', filename),
    ];
    let filePath = '';
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }
    if (!filePath) throw new Error(\`CSV file "\${filename}" not found.\`);
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const lines = raw.split(/\\r?\\n/);
    if (lines.length === 0 || !lines[0]) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    const results: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const values = line.split(',').map(v => v.trim());
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index] : '';
      });
      results.push(row);
    }
    return results;
  }
}`);

      // 6. Scaffold Logger.ts
      writeFrameworkFile('utils', 'Logger.ts', `import { test } from '@playwright/test';
import chalk from 'chalk';

export class Logger {
  public static info(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(\`\${chalk.blue.bold('[INFO]')} \${chalk.gray(timestamp)} \${message}\`);
    try {
      test.info().annotations.push({ type: 'info', description: message });
    } catch {}
  }

  public static success(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(\`\${chalk.green.bold('[PASS]')} \${chalk.gray(timestamp)} \${chalk.green(message)}\`);
    try {
      test.info().annotations.push({ type: 'pass', description: message });
    } catch {}
  }

  public static warn(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(\`\${chalk.yellow.bold('[WARN]')} \${chalk.gray(timestamp)} \${chalk.yellow(message)}\`);
    try {
      test.info().annotations.push({ type: 'warning', description: message });
    } catch {}
  }

  public static error(message: string, error?: Error): void {
    const timestamp = new Date().toLocaleTimeString();
    console.error(\`\${chalk.red.bold('[FAIL]')} \${chalk.gray(timestamp)} \${chalk.red.bold(message)}\`);
    if (error?.stack) console.error(chalk.red(error.stack));
    try {
      test.info().annotations.push({ type: 'error', description: \`\${message} \${error?.message || ''}\` });
    } catch {}
  }

  public static async step<T>(name: string, action: () => Promise<T>): Promise<T> {
    console.log(\`\\n\${chalk.cyan.bold('[STEP]')} \${chalk.white.bold(name)}\`);
    console.log(chalk.cyan('─'.repeat(50)));
    try {
      return await test.step(name, action);
    } catch {
      return await action();
    }
  }
}`);

      // 7. Scaffold WaitUtils.ts
      writeFrameworkFile('utils', 'WaitUtils.ts', `import { Page } from '@playwright/test';

export class WaitUtils {
  public static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public static async waitForCondition(
    condition: () => Promise<boolean> | boolean,
    timeout = 10000,
    pollInterval = 500
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) return true;
      await this.sleep(pollInterval);
    }
    throw new Error(\`Condition was not met within the timeout of \${timeout}ms.\`);
  }

  public static async waitForNetworkIdle(page: Page, timeout = 10000): Promise<void> {
    console.log(\`[WaitUtils] Waiting for network idle...\`);
    await page.waitForLoadState('networkidle', { timeout });
  }

  public static async waitForElementCount(
    page: Page,
    selector: string,
    expectedCount: number,
    timeout = 10000
  ): Promise<void> {
    console.log(\`[WaitUtils] Waiting for element count of "\${selector}" to be \${expectedCount}\`);
    await this.waitForCondition(async () => {
      const count = await page.locator(selector).count();
      return count === expectedCount;
    }, timeout);
  }
}`);

      // 8. Scaffold AssertionUtils.ts
      writeFrameworkFile('utils', 'AssertionUtils.ts', `import { Page, expect } from '@playwright/test';
import { Logger } from '@utils/Logger';

export class AssertionUtils {
  public static assertTrue(value: boolean, message: string): void {
    Logger.info(\`Asserting: \${message}\`);
    try {
      expect(value).toBe(true);
      Logger.success(\`Assertion Passed: \${message}\`);
    } catch (err: any) {
      Logger.error(\`Assertion Failed: \${message}\`, err);
      throw err;
    }
  }

  public static assertEquals<T>(actual: T, expected: T, message: string): void {
    Logger.info(\`Asserting equality: \${message} (Expected: \${expected}, Got: \${actual})\`);
    try {
      expect(actual as any).toEqual(expected);
      Logger.success(\`Assertion Passed: \${message}\`);
    } catch (err: any) {
      Logger.error(\`Assertion Failed: \${message}\`, err);
      throw err;
    }
  }

  public static async assertElementVisible(page: Page, selector: string, message: string): Promise<void> {
    Logger.info(\`Asserting element visibility: \${message} ("\${selector}")\`);
    try {
      const locator = page.locator(selector);
      await expect(locator).toBeVisible();
      Logger.success(\`Assertion Passed: \${message}\`);
    } catch (err: any) {
      Logger.error(\`Assertion Failed: \${message}\`, err);
      throw err;
    }
  }

  public static async assertElementText(page: Page, selector: string, expectedText: string, message: string): Promise<void> {
    Logger.info(\`Asserting element contains text: \${message} ("\${selector}" -> "\${expectedText}")\`);
    try {
      const locator = page.locator(selector);
      await expect(locator).toContainText(expectedText);
      Logger.success(\`Assertion Passed: \${message}\`);
    } catch (err: any) {
      Logger.error(\`Assertion Failed: \${message}\`, err);
      throw err;
    }
  }
}`);

      // 9. Create playwright.config.ts in framework/
      const playConfigDest = path.join(process.cwd(), 'framework', 'playwright.config.ts');
      const defaultPlaywrightConfig = `import { defineConfig, devices } from '@playwright/test';
import { config } from './config/ConfigManager';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: config.variables.timeout || 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: config.variables.retry || 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never', outputFolder: '../playwright-report' }],
    ['junit', { outputFile: '../reports/junit-results.xml' }],
    ['list']
  ],
  use: {
    baseURL: config.baseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;
      fs.writeFileSync(playConfigDest, defaultPlaywrightConfig, 'utf8');

      spinner.succeed(chalk.green('Project structure successfully created!'));
      
      console.log(`\n${chalk.cyan('Next steps:')}`);
      console.log(`  1. Define env settings in ${chalk.bold('config/environments/qa.json')}`);
      console.log(`  2. Add your provider API keys in a ${chalk.bold('.env')} file`);
      console.log(`  3. Create your first NL test: ${chalk.bold('webpilot create test login')}`);
      console.log(`  4. Run it: ${chalk.bold('webpilot run tests/web/login.txt')}\n`);
    } catch (err: any) {
      spinner.fail(chalk.red(`Init failed: ${err.message}`));
    }
  });

/**
 * COMMAND: doctor
 */
program
  .command('doctor')
  .description('Audit framework configuration, environment secrets, and browser binaries')
  .action(async () => {
    console.log(`\n${chalk.magenta('=== WebPilot Doctor Diagnostic Check ===')}`);
    
    // Check paths
    const requiredDirs = ['config', 'tests', 'core', 'agents'];
    let pathsOk = true;
    requiredDirs.forEach(dir => {
      const exists = fs.existsSync(path.join(process.cwd(), dir));
      console.log(exists 
        ? `  ${chalk.green('✔')} Directory "${dir}" found` 
        : `  ${chalk.red('✘')} Directory "${dir}" is missing`
      );
      if (!exists) pathsOk = false;
    });

    // Check LLM variables
    const keys = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
    console.log(`\n${chalk.blue('Checking LLM Credentials:')}`);
    let credsOk = false;
    keys.forEach(k => {
      const present = !!process.env[k];
      console.log(present
        ? `  ${chalk.green('✔')} Environment variable "${k}" is active`
        : `  ${chalk.yellow('⚠')} Variable "${k}" is missing (optional fallback)`
      );
      if (present) credsOk = true;
    });

    if (!credsOk) {
      console.log(`  ${chalk.red('✘ No LLM credentials active! Please export GEMINI_API_KEY or OPENAI_API_KEY.')}`);
    }

    console.log(`\n${chalk.magenta('=== Diagnostics Complete ===')}\n`);
  });

/**
 * COMMAND: create test <name>
 */
program
  .command('create')
  .argument('<type>', 'Type of template to create: "test" or "api"')
  .argument('<name>', 'Logical name of the test asset')
  .description('Generate template natural language test scripts')
  .action((type, name) => {
    const cleanName = name.replace(/\s+/g, '_').toLowerCase();
    
    if (type === 'test') {
      const testPath = path.join(process.cwd(), 'tests', 'web', `${cleanName}.txt`);
      const template = `@smoke @login
Test: ${name}

Given user opens application
When user logs in with valid credentials
Then dashboard should be visible
`;
      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, template, 'utf8');
      console.log(chalk.green(`Created Web UI template: ${testPath}`));
    } else if (type === 'api') {
      const apiPath = path.join(process.cwd(), 'tests', 'api', `${cleanName}.txt`);
      const template = `@api @user
Test: API User validation

Send POST request to {{baseUrl}}/api/login
With body payload {"username": "admin", "password": "password"}
Extract response body.token into token
Send GET request to {{baseUrl}}/api/users
With Headers {"Authorization": "Bearer {{token}}"}
Assert status is 200
`;
      fs.mkdirSync(path.dirname(apiPath), { recursive: true });
      fs.writeFileSync(apiPath, template, 'utf8');
      console.log(chalk.green(`Created API template: ${apiPath}`));
    } else {
      console.error(chalk.red(`Unsupported type: ${type}. Choose "test" or "api".`));
    }
  });

/**
 * COMMAND: run <file>
 */
program
  .command('run')
  .argument('<paths...>', 'Paths to natural language test scripts or directories')
  .option('-e, --env <env>', 'Environment to switch to (dev, qa, prod)', 'qa')
  .option('--headed', 'Launch browser in visible headed mode', false)
  .option('--architecture <arch>', 'Target generated architecture: flat, pom, bdd, pom-bdd', 'pom')
  .option('--parallel <workers>', 'Run parallel workers', '1')
  .option('--report', 'Automatically generate HTML report after run completes')
  .description('Run natural language scripts in fully autonomous execution mode')
  .action(async (paths: string[], options) => {
    let files: string[] = [];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          const readdir = (dir: string) => {
            for (const f of fs.readdirSync(dir)) {
              const fp = path.join(dir, f);
              if (fs.statSync(fp).isDirectory()) readdir(fp);
              else if (fp.endsWith('.txt')) files.push(fp);
            }
          };
          readdir(p);
        } else if (p.endsWith('.txt')) {
          files.push(p);
        }
      }
    }
    
    files = [...new Set(files)];
    if (files.length === 0) {
      console.log(chalk.red('No .txt test scripts found to run.'));
      process.exit(1);
    }
    
    const concurrency = parseInt(options.parallel, 10) || 1;
    const jobStart = Date.now();
    UsageTracker.reset();
    
    CliDisplay.printBanner({
      test: files.length > 1 ? `${files.length} tests` : files[0],
      env: options.env,
      mode: options.headed ? 'headed' : 'headless',
      architecture: options.architecture
    });
    
    Logger.info(`Starting execution of ${files.length} tests with concurrency ${concurrency}...`);
    
    let passes = 0;
    let fails = 0;
    
    const runTest = async (file: string) => {
      const isUI = file.endsWith('.txt') && !file.includes('/api/');
      let success = false;
      let stepsExecuted: number | undefined;
      const testName = path.basename(file, path.extname(file));
      const testStart = Date.now();
      
      try {
        if (isUI) {
          const engine = new Engine({
            testFilePath: file,
            env: options.env,
            headed: options.headed,
            interactive: false,
            architecture: options.architecture as any
          });
          const result = await engine.execute();
          success = result.success;
          stepsExecuted = result.stepsExecuted;
        } else {
          const envPath = path.join(process.cwd(), 'config', 'environments', `${options.env}.json`);
          const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf8'));
          const llmClient = new LLMClient();
          const runner = new APIRunner({ baseUrl: envConfig.baseUrl, apiBaseUrl: envConfig.apiBaseUrl }, llmClient);
          const fileContent = fs.readFileSync(file, 'utf8');
          const steps = await runner.parseNaturalLanguageTest(fileContent);
          stepsExecuted = steps.length;
          success = await runner.runPipeline(steps);
        }
      } catch (err: any) {
        Logger.error(`Error executing ${file}: ${err.message}`);
      }
      
      if (success) passes++; else fails++;
      
      CliDisplay.printJobSummary({
        test: testName,
        success,
        durationMs: Date.now() - testStart,
        usage: UsageTracker.getSnapshot(),
        stepsExecuted
      });
    };
    
    let i = 0;
    const workers = Array(concurrency).fill(0).map(async () => {
      while (i < files.length) {
        const file = files[i++];
        await runTest(file);
      }
    });
    
    await Promise.all(workers);
    
    console.log(`\n${chalk.blue.bold('=== Suite Execution Finished ===')}`);
    console.log(`Passed: ${chalk.green(passes)}, Failed: ${chalk.red(fails)}`);
    console.log(`Total duration: ${((Date.now() - jobStart)/1000).toFixed(1)}s`);
    
    if (options.report) {
      Logger.info('\nGenerating HTML report...');
      const { execSync } = require('child_process');
      const cliArgs = ['npx', 'ts-node', 'core/execution_report/run-cli.ts', '--env', options.env];
      execSync(cliArgs.join(' '), { stdio: 'inherit', cwd: process.cwd() });
    }
    
    process.exit(fails > 0 ? 1 : 0);
  });

/**
 * COMMAND: interactive <file>
 */
program
  .command('interactive')
  .argument('<file>', 'Path to the natural language test script')
  .option('-e, --env <env>', 'Environment to switch to', 'qa')
  .option('--architecture <arch>', 'Target generated architecture', 'pom')
  .description('Execute web test in human-in-the-loop interactive mode')
  .action(async (file, options) => {
    const testName = path.basename(file, path.extname(file));
    const jobStart = Date.now();

    UsageTracker.reset();
    CliDisplay.printBanner({
      test: file,
      env: options.env,
      mode: 'interactive · headed',
      architecture: options.architecture
    });

    let success = false;
    let stepsExecuted: number | undefined;

    try {
      const engine = new Engine({
        testFilePath: file,
        env: options.env,
        headed: true,
        interactive: true,
        architecture: options.architecture as any
      });
      const result = await engine.execute();
      success = result.success;
      stepsExecuted = result.stepsExecuted;
    } finally {
      CliDisplay.printJobSummary({
        test: testName,
        success,
        durationMs: Date.now() - jobStart,
        usage: UsageTracker.getSnapshot(),
        stepsExecuted
      });
    }

    process.exit(success ? 0 : 1);
  });

/**
 * COMMAND: report
 */
program
  .command('report')
  .description('Aggregate execution results; optionally generate HTML report with AI analysis')
  .option('--html', 'Generate reports/index.html and per-test HTML reports')
  .option('--no-ai', 'Skip LLM analysis section in HTML report')
  .option('--test <slug>', 'Limit HTML report to one test slug (e.g. automationexercise_add_to_cart)')
  .option('-e, --env <env>', 'Environment name for report header', 'qa')
  .option('--file <path>', 'Original test file path (metadata)')
  .action(async (options) => {
    if (options.html) {
      const { execSync } = require('child_process');
      const cliArgs = ['npx', 'ts-node', 'core/execution_report/run-cli.ts', '--env', options.env];
      if (options.noAi) cliArgs.push('--no-ai');
      if (options.test) cliArgs.push('--test', options.test);
      execSync(cliArgs.join(' '), { stdio: 'inherit', cwd: process.cwd() });
      return;
    }
    console.log(`\n${chalk.blue.bold('=== WebPilot Executive Quality Dashboard ===')}`);
    
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      console.log(chalk.yellow('No execution report cards found inside /reports yet.'));
      return;
    }

    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith('_summary.json'));
    if (files.length === 0) {
      console.log(chalk.yellow('No execution report cards found inside /reports yet.'));
      return;
    }

    let passes = 0;
    let fails = 0;
    console.log(`\n${chalk.bold('Recent Executions:')}`);
    
    files.forEach(f => {
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(reportsDir, f), 'utf8'));
        const isPass = summary.status === 'PASSED';
        if (isPass) passes++; else fails++;

        const statusColor = isPass ? chalk.green('PASSED') : chalk.red('FAILED');
        console.log(`  - ${chalk.bold(summary.test)}: [${statusColor}] at ${summary.timestamp} (${summary.stepsExecuted} steps)`);
      } catch {}
    });

    const total = passes + fails;
    const passRate = total > 0 ? ((passes / total) * 100).toFixed(1) : '0';

    console.log(`\n${chalk.bold('Summary Metrics:')}`);
    console.log(`  Total Executions : ${total}`);
    console.log(`  Passed Runs      : ${chalk.green(passes)}`);
    console.log(`  Failed Runs      : ${chalk.red(fails)}`);
    console.log(`  Success rate     : ${chalk.cyan(passRate)}%\n`);
  });

/**
 * COMMAND: self-heal
 */
program
  .command('self-heal')
  .option('--clean', 'Purge current self-healing records')
  .description('Audit and manage selector correction maps inside /.healing-cache')
  .action((options) => {
    const cachePath = path.join(process.cwd(), '.healing-cache', 'cache.json');
    if (options.clean) {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        console.log(chalk.green('Self-healing cache purged successfully.'));
      }
      return;
    }

    if (!fs.existsSync(cachePath)) {
      console.log(chalk.yellow('No healed selectors cached in /.healing-cache/cache.json yet.'));
      return;
    }

    try {
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const entries = Object.keys(cache);
      
      console.log(`\n${chalk.magenta('=== WebPilot Self-Healing Cache Audit ===')}`);
      console.log(`Total selector entries healed: ${chalk.bold(entries.length)}\n`);
      
      entries.forEach(broken => {
        console.log(`  ${chalk.red('Broken:')} "${broken}"`);
        console.log(`  ${chalk.green('Healed:')} "${cache[broken]}"\n`);
      });
    } catch {
      console.error(chalk.red('Error reading self-healing cache.'));
    }
  });

program.parse(process.argv);
