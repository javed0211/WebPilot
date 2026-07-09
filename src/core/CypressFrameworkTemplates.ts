import * as fs from 'fs';
import * as path from 'path';

export const CYPRESS_FRAMEWORK_PATHS = {
  tsconfig: 'tsconfig.json',
  cypressConfig: 'cypress.config.ts',
  supportE2e: 'cypress/support/e2e.ts',
  supportCommands: 'cypress/support/commands.ts',
  supportConfig: 'cypress/support/config.ts',
  basePage: 'cypress/support/pages/BasePage.ts',
  sampleSpec: 'cypress/e2e/automationexercise_smoke.cy.ts',
} as const;

export function isFullTypeScriptCypress(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'typescript' && profile.automationTool === 'cypress';
}

export function buildCypressTsConfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        types: ['cypress', 'node'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: {
          '@support/*': ['cypress/support/*'],
          '@pages/*': ['cypress/support/pages/*'],
        },
      },
      include: ['cypress/**/*.ts', 'cypress.config.ts'],
    },
    null,
    2
  )}\n`;
}

export function buildCypressConfigTs(): string {
  return `import { defineConfig } from 'cypress';
import { loadEnvConfig } from './cypress/support/config';

const envConfig = loadEnvConfig();

export default defineConfig({
  e2e: {
    baseUrl: envConfig.baseUrl || 'https://automationexercise.com',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    setupNodeEvents() {
      // register plugins here when needed
    },
  },
});
`;
}

export const CYPRESS_SUPPORT_CONFIG = `import * as fs from 'fs';
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

export const CYPRESS_SUPPORT_E2E = `import './commands';
`;

export const CYPRESS_SUPPORT_COMMANDS = `// WebPilot Cypress custom commands.
// Add project-specific cy.* helpers here.
`;

export const CYPRESS_BASE_PAGE = `/** Shared Cypress helpers for WebPilot-generated page objects. */
export class BasePage {
  visit(url: string): void {
    cy.visit(url);
  }

  visitPath(path = '/'): void {
    cy.visit(path);
  }

  clickSelector(selector: string): void {
    cy.get(selector).click();
  }

  fillSelector(selector: string, value: string): void {
    cy.get(selector).clear().type(value);
  }

  assertVisible(text: string | RegExp): void {
    cy.contains(text).should('be.visible');
  }

  assertUrlIncludes(fragment: string): void {
    cy.url().should('include', fragment);
  }
}
`;

export const CYPRESS_SAMPLE_SPEC = `import { BasePage } from '../support/pages/BasePage';

describe('AutomationExercise smoke', () => {
  it('opens the home page', () => {
    const home = new BasePage();
    home.visit('https://automationexercise.com/');
    home.assertVisible(/AutomationExercise/i);
  });
});
`;

export interface CypressFrameworkFile {
  path: string;
  content: string;
}

export function cypressFrameworkFiles(): CypressFrameworkFile[] {
  return [
    { path: CYPRESS_FRAMEWORK_PATHS.tsconfig, content: buildCypressTsConfigJson() },
    { path: CYPRESS_FRAMEWORK_PATHS.cypressConfig, content: buildCypressConfigTs() },
    { path: CYPRESS_FRAMEWORK_PATHS.supportConfig, content: CYPRESS_SUPPORT_CONFIG },
    { path: CYPRESS_FRAMEWORK_PATHS.supportE2e, content: CYPRESS_SUPPORT_E2E },
    { path: CYPRESS_FRAMEWORK_PATHS.supportCommands, content: CYPRESS_SUPPORT_COMMANDS },
    { path: CYPRESS_FRAMEWORK_PATHS.basePage, content: CYPRESS_BASE_PAGE },
    { path: CYPRESS_FRAMEWORK_PATHS.sampleSpec, content: CYPRESS_SAMPLE_SPEC },
  ];
}

export function readCypressDependencyVersions(installRoot?: string | null): {
  cypress: string;
  typescript: string;
  typesNode: string;
} {
  const defaults = {
    cypress: '^14.3.0',
    typescript: '^6.0.3',
    typesNode: '^25.9.0',
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
      cypress: deps.cypress ?? defaults.cypress,
      typescript: deps.typescript ?? defaults.typescript,
      typesNode: deps['@types/node'] ?? defaults.typesNode,
    };
  } catch {
    return defaults;
  }
}

/** Write missing Cypress framework files (safe for existing projects). */
export function ensureCypressFramework(cwd = process.cwd()): string[] {
  const written: string[] = [];
  for (const file of cypressFrameworkFiles()) {
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

/** Write tsconfig.json when missing or when Cypress types were never configured. */
export function ensureCypressTsConfig(cwd = process.cwd()): boolean {
  const tsconfigPath = path.join(cwd, CYPRESS_FRAMEWORK_PATHS.tsconfig);
  if (fs.existsSync(tsconfigPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
        compilerOptions?: { types?: string[] };
      };
      if (existing.compilerOptions?.types?.includes('cypress')) {
        return false;
      }
    } catch {
      // rewrite broken config
    }
  }
  fs.writeFileSync(tsconfigPath, buildCypressTsConfigJson(), 'utf8');
  return true;
}
