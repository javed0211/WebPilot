import * as fs from 'fs';
import * as path from 'path';

export const FRAMEWORK_BASE_PAGE_REL_PATH = 'packages/test-framework/core/BasePage.ts';
export const FRAMEWORK_TSCONFIG_REL_PATH = 'tsconfig.json';

export const FRAMEWORK_PATH_ALIASES: Record<string, string[]> = {
  '@core/*': ['packages/test-framework/core/*'],
  '@pages/*': ['packages/test-framework/pages/*'],
  '@tests/*': ['packages/test-framework/tests/*'],
  '@config/*': ['packages/test-framework/config/*'],
  '@utils/*': ['packages/test-framework/utils/*'],
  '@data/*': ['packages/test-framework/data/*'],
  '@apis/*': ['packages/test-framework/apis/*'],
};

export function buildFrameworkTsConfigJson(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        lib: ['ES2022', 'DOM'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        moduleResolution: 'node',
        types: ['node'],
        baseUrl: '.',
        paths: FRAMEWORK_PATH_ALIASES,
      },
      include: ['packages/test-framework/**/*'],
    },
    null,
    2
  )}\n`;
}

function tsConfigNeedsUpgrade(existing: {
  compilerOptions?: { paths?: Record<string, string[]>; lib?: string[]; types?: string[] };
}): boolean {
  if (!existing.compilerOptions?.paths?.['@core/*']) {
    return true;
  }
  const libs = (existing.compilerOptions.lib || []).map((item) => String(item).toLowerCase());
  if (!libs.includes('dom')) {
    return true;
  }
  const types = existing.compilerOptions.types;
  // Missing types → ok (all @types/* load). Explicit types without 'node' → Buffer breaks.
  if (Array.isArray(types) && !types.map((t) => String(t).toLowerCase()).includes('node')) {
    return true;
  }
  return false;
}

/** Write root tsconfig.json when missing, missing aliases, DOM lib, or node types (BasePage needs them). */
export function ensureFrameworkTsConfig(cwd = process.cwd()): boolean {
  const tsconfigPath = path.join(cwd, FRAMEWORK_TSCONFIG_REL_PATH);
  if (fs.existsSync(tsconfigPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8')) as {
        compilerOptions?: { paths?: Record<string, string[]>; lib?: string[]; types?: string[] };
      };
      if (!tsConfigNeedsUpgrade(existing)) {
        return false;
      }
      // Heal in place when aliases exist but DOM/node types are missing — preserve other options.
      if (existing.compilerOptions?.paths?.['@core/*']) {
        const libs = new Set(
          (existing.compilerOptions.lib || ['ES2022']).map((item) => String(item))
        );
        libs.add('ES2022');
        libs.add('DOM');
        existing.compilerOptions.lib = Array.from(libs);
        if (!existing.compilerOptions.types) {
          existing.compilerOptions.types = ['node'];
        } else if (
          !existing.compilerOptions.types.map((t) => String(t).toLowerCase()).includes('node')
        ) {
          existing.compilerOptions.types = [...existing.compilerOptions.types, 'node'];
        }
        fs.writeFileSync(tsconfigPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
        console.log(
          '\x1b[32m[WebPilot] Updated tsconfig.json (DOM lib + node types required for BasePage).\x1b[0m'
        );
        return true;
      }
    } catch {
      // fall through and rewrite a broken tsconfig
    }
  }
  fs.writeFileSync(tsconfigPath, buildFrameworkTsConfigJson(), 'utf8');
  return true;
}

export interface FrameworkDependencyVersions {
  playwright: string;
  typescript: string;
  typesNode: string;
  ajv: string;
  chalk: string;
}

export function readFrameworkDependencyVersions(installRoot?: string | null): FrameworkDependencyVersions {
  const defaults: FrameworkDependencyVersions = {
    playwright: '^1.60.0',
    typescript: '^6.0.3',
    typesNode: '^25.9.0',
    ajv: '^8.20.0',
    chalk: '^4.1.2',
  };
  const root = installRoot ?? resolveInstallRoot();
  if (!root) {
    return defaults;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return {
      playwright: deps['@playwright/test'] ?? defaults.playwright,
      typescript: deps.typescript ?? defaults.typescript,
      typesNode: deps['@types/node'] ?? defaults.typesNode,
      ajv: deps.ajv ?? defaults.ajv,
      chalk: deps.chalk ?? defaults.chalk,
    };
  } catch {
    return defaults;
  }
}

/** Minimal BasePage for init when the full template is unavailable (older installs). */
export const MINIMAL_BASE_PAGE_FALLBACK = `import { Page, Locator, expect } from '@playwright/test';

type Role = Parameters<Page['getByRole']>[0];
type RoleOptions = Parameters<Page['getByRole']>[1];

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  public async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'load' });
  }

  public async click(selector: string, timeout = 10000): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
  }

  public async fill(selector: string, value: string, timeout = 10000): Promise<void> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    await locator.fill(value);
  }

  public async getText(selector: string, timeout = 10000): Promise<string> {
    const locator = this.page.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    return (await locator.innerText()).trim();
  }

  public async isVisible(selector: string, timeout = 5000): Promise<boolean> {
    try {
      await this.page.locator(selector).waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  public async clickByRole(role: Role, options?: RoleOptions): Promise<void> {
    await this.page.getByRole(role, options).click();
  }

  public async assertTitle(expectedTitle: string): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle);
  }

  public async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl);
  }

  public async assertTextPresent(selector: string, text: string, timeout = 10000): Promise<void> {
    await expect(this.page.locator(selector)).toContainText(text, { timeout });
  }

  public async assertElementVisible(selector: string, timeout = 10000): Promise<void> {
    await expect(this.page.locator(selector)).toBeVisible({ timeout });
  }

  public async assertHeadingVisible(text: string | RegExp): Promise<void> {
    await expect(this.page.getByRole('heading', { name: text })).toBeVisible();
  }

  public async assertCountAtLeast(locator: Locator, minimum: number): Promise<void> {
    const n = await locator.count();
    expect(n).toBeGreaterThanOrEqual(minimum);
  }
}
`;

function resolveInstallRoot(): string | null {
  const explicit = process.env.WEBPILOT_INSTALL_ROOT;
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  let current = path.resolve(__dirname, '..', '..');
  while (true) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: string; bin?: unknown };
        const name = pkg.name ?? '';
        if (name === 'webpilot' || /(^|\/)webpilot$/.test(name)) {
          return current;
        }
      } catch {
        // continue walking
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function loadFrameworkBasePageContent(): string | null {
  const candidates = [
    process.env.WEBPILOT_INSTALL_ROOT
      ? path.join(process.env.WEBPILOT_INSTALL_ROOT, FRAMEWORK_BASE_PAGE_REL_PATH)
      : null,
    resolveInstallRoot()
      ? path.join(resolveInstallRoot()!, FRAMEWORK_BASE_PAGE_REL_PATH)
      : null,
    path.join(process.cwd(), FRAMEWORK_BASE_PAGE_REL_PATH),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return null;
}

export function resolveFrameworkBasePageContent(): string {
  return loadFrameworkBasePageContent() ?? MINIMAL_BASE_PAGE_FALLBACK;
}
