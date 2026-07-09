import * as fs from 'fs';
import * as path from 'path';

export const WDIO_FRAMEWORK_PATHS = {
  tsconfig: 'tsconfig.json',
  wdioConfig: 'wdio.conf.ts',
  supportConfig: 'test/support/config.ts',
  basePage: 'test/pageobjects/BasePage.ts',
  sampleSpec: 'test/specs/automationexercise_smoke.spec.ts',
} as const;

export function isFullTypeScriptWebdriverIO(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'typescript' && profile.automationTool === 'webdriverio';
}

export function buildWdioTsConfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        types: ['node', '@wdio/globals/types'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: {
          '@support/*': ['test/support/*'],
          '@pageobjects/*': ['test/pageobjects/*'],
        },
      },
      include: ['test/**/*.ts', 'wdio.conf.ts'],
    },
    null,
    2
  )}\n`;
}

export function buildWdioConfigTs(): string {
  return `import { loadEnvConfig } from './test/support/config';

const envConfig = loadEnvConfig();

export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--remote-allow-origins=*'],
      },
    },
  ],
  logLevel: 'info',
  baseUrl: envConfig.baseUrl || 'https://automationexercise.com',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  services: ['chromedriver'],
} as const;
`;
}

export const WDIO_SUPPORT_CONFIG = `import * as fs from 'fs';
import * as path from 'path';

export interface EnvConfig {
  environment?: string;
  baseUrl?: string;
  apiBaseUrl?: string;
  credentials?: Record<string, string>;
  variables?: Record<string, unknown>;
}

function resolveEnvVars<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replace(/\\$\\{(\\w+)\\}/g, (match, name: string) => process.env[name] ?? match) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVars(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveEnvVars(nested);
    }
    return result as T;
  }
  return value;
}

export function loadEnvConfig(): EnvConfig {
  const env = process.env.ENV || 'qa';
  const configPath = path.join(process.cwd(), 'resources', 'config', 'environments', \`\${env}.json\`);
  if (!fs.existsSync(configPath)) {
    return { baseUrl: 'https://automationexercise.com', environment: env };
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as EnvConfig;
  return resolveEnvVars(raw);
}
`;

export const WDIO_BASE_PAGE = `import { browser } from '@wdio/globals';

/** Shared WebdriverIO helpers for WebPilot-generated page objects. */
export class BasePage {
  public async open(url: string): Promise<void> {
    await browser.url(url);
  }

  public async openPath(path = '/'): Promise<void> {
    await browser.url(path);
  }

  public async click(selector: string): Promise<void> {
    const element = await $(selector);
    await element.waitForDisplayed();
    await element.click();
  }

  public async fill(selector: string, value: string): Promise<void> {
    const element = await $(selector);
    await element.waitForDisplayed();
    await element.setValue(value);
  }

  public async assertVisible(selector: string): Promise<void> {
    const element = await $(selector);
    await element.waitForDisplayed();
  }
}
`;

export const WDIO_SAMPLE_SPEC = `import { browser, expect } from '@wdio/globals';
import { BasePage } from '../pageobjects/BasePage';

describe('AutomationExercise smoke', () => {
  it('opens the home page', async () => {
    const home = new BasePage();
    await home.open('https://automationexercise.com/');
    await expect(browser).toHaveTitle(expect.stringContaining('Automation Exercise'));
  });
});
`;

export interface WdioFrameworkFile {
  path: string;
  content: string;
}

export function webdriverIOFrameworkFiles(): WdioFrameworkFile[] {
  return [
    { path: WDIO_FRAMEWORK_PATHS.tsconfig, content: buildWdioTsConfigJson() },
    { path: WDIO_FRAMEWORK_PATHS.wdioConfig, content: buildWdioConfigTs() },
    { path: WDIO_FRAMEWORK_PATHS.supportConfig, content: WDIO_SUPPORT_CONFIG },
    { path: WDIO_FRAMEWORK_PATHS.basePage, content: WDIO_BASE_PAGE },
    { path: WDIO_FRAMEWORK_PATHS.sampleSpec, content: WDIO_SAMPLE_SPEC },
  ];
}

export function readWdioDependencyVersions(installRoot?: string | null): {
  wdio: string;
  typescript: string;
  typesNode: string;
  chromedriver: string;
} {
  const defaults = {
    wdio: '^9.4.0',
    typescript: '^6.0.3',
    typesNode: '^25.9.0',
    chromedriver: '^131.0.0',
  };
  if (!installRoot) {
    return defaults;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return {
      wdio: deps['@wdio/cli'] ?? deps.webdriverio ?? defaults.wdio,
      typescript: deps.typescript ?? defaults.typescript,
      typesNode: deps['@types/node'] ?? defaults.typesNode,
      chromedriver: deps.chromedriver ?? defaults.chromedriver,
    };
  } catch {
    return defaults;
  }
}

export function ensureWebdriverIOFramework(cwd = process.cwd()): string[] {
  const written: string[] = [];
  for (const file of webdriverIOFrameworkFiles()) {
    const fullPath = path.join(cwd, file.path);
    if (fs.existsSync(fullPath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content.trimEnd() + '\n', 'utf8');
    written.push(file.path);
  }
  return written;
}

export function ensureWdioTsConfig(cwd = process.cwd()): boolean {
  const tsconfigPath = path.join(cwd, WDIO_FRAMEWORK_PATHS.tsconfig);
  if (fs.existsSync(tsconfigPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
        compilerOptions?: { types?: string[] };
      };
      if (existing.compilerOptions?.types?.includes('@wdio/globals/types')) {
        return false;
      }
    } catch {
      // rewrite broken config
    }
  }
  fs.writeFileSync(tsconfigPath, buildWdioTsConfigJson(), 'utf8');
  return true;
}
