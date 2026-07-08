#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import inquirer from 'inquirer';
import { Engine } from '../core/Engine';
import { ApiEngine } from '../core/ApiEngine';
import { OpenApiLoader } from '../core/api/OpenApiLoader';
import { LLMClient } from '../core/LLMClient';
import { CliDisplay } from '../utils/CliDisplay';
import { UsageTracker } from '../utils/UsageTracker';
import { Logger } from '../utils/Logger';
import { findCliInstallRoot, initializeProjectContext } from './ProjectContext';
import { generateExecutionReports } from '../core/ExecutionReportService';
import { generateMarkdownReport } from '../core/execution_report/generateMarkdownReport';
import { listSummarySlugs, resolveSummaryPath, migrateLegacyReportFiles, ensureReportDirs } from '../core/ReportPaths';
import { setupPythonVenv } from '../integrations/browser_use/PythonRuntime';
import { RepoKnowledgeGraph } from '../core/knowledge/RepoKnowledgeGraph';
import { HEALING_PROPOSALS_DIR, KNOWLEDGE_GRAPH_PATH } from '../core/ProjectPaths';
import { DeterministicCodegenPipeline } from '../core/codegen/DeterministicCodegenPipeline';
import { readLatestPointer } from '../core/codegen/CodegenPaths';
import { BrowserProviderRegistry } from '../core/browserProviders/BrowserProviderRegistry';
import { collectSuiteReport } from '../core/execution_report/collector';
import { writeArtifactManifest } from '../core/ci/ArtifactManifest';
import { writeGithubActionsWorkflow } from '../core/ci/CiWorkflow';
import { ScenarioMetadataParser } from '../core/authoring/ScenarioMetadata';
import { AuthoringOutput } from '../core/authoring/NextSteps';
import { TestTemplateRegistry, TestTemplateKind } from '../core/authoring/TestTemplates';

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';
dotenv.config({ quiet: true });

// Commands that bootstrap, diagnose, or describe WebPilot must run without an
// existing project. `init` scaffolds a project; `setup` builds the Python
// engine inside the installed package; `doctor` inspects the environment.
const PROJECTLESS_COMMANDS = new Set([
  'init',
  'setup',
  'doctor',
  '--help',
  '-h',
  '--version',
  '-V',
  'help',
]);

const requestedCommand = process.argv[2];
initializeProjectContext(requestedCommand !== undefined && !PROJECTLESS_COMMANDS.has(requestedCommand));

function readCliPackageVersion(): string {
  try {
    const pkgPath = path.join(findCliInstallRoot(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('webpilot')
  .description('WebPilot: Production-Grade AI-Native Quality Engineering Platform')
  .version(readCliPackageVersion());

interface DoctorCheck {
  ok: boolean;
  required: boolean;
  label: string;
  fix?: string;
}

type InitLanguage = 'typescript' | 'python' | 'java' | 'csharp';
type InitTool = 'playwright' | 'selenium' | 'cypress' | 'webdriverio';
type InitPattern = 'simple' | 'pom' | 'screenplay' | 'bdd';
type InitTarget = 'web' | 'api' | 'web-api';
type InitProvider = 'google' | 'openai' | 'anthropic' | 'azure' | 'aws' | 'gcp' | 'ollama';

interface InitProfile {
  projectName: string;
  target: InitTarget;
  language: InitLanguage;
  automationTool: InitTool;
  frameworkPattern: InitPattern;
  testRunner: string;
  llmProvider: InitProvider;
  llmModel: string;
  azureEndpoint?: string;
  azureDeployment?: string;
}

const DEFAULT_MODELS: Record<InitProvider, string> = {
  google: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet',
  azure: '${AZURE_OPENAI_DEPLOYMENT}',
  aws: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  gcp: 'gemini-2.5-flash',
  ollama: 'llama3',
};

function slugName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'webpilot-project';
}

function inferDefaultRunner(language: InitLanguage, tool: InitTool): string {
  if (language === 'typescript' && tool === 'playwright') return 'playwright-test';
  if (language === 'typescript' && tool === 'cypress') return 'cypress';
  if (language === 'typescript' && tool === 'webdriverio') return 'webdriverio';
  if (language === 'python' && tool === 'playwright') return 'pytest';
  if (language === 'java' && tool === 'selenium') return 'junit';
  if (language === 'csharp' && tool === 'selenium') return 'nunit';
  return `${language}-${tool}`;
}

function isFullTypeScriptPlaywright(profile: InitProfile): boolean {
  return profile.language === 'typescript' && profile.automationTool === 'playwright';
}

async function resolveInitProfile(
  directory: string,
  options: {
    yes?: boolean;
    language?: InitLanguage;
    tool?: InitTool;
    pattern?: InitPattern;
    target?: InitTarget;
    llmProvider?: InitProvider;
    llmModel?: string;
    testRunner?: string;
    projectName?: string;
  }
): Promise<InitProfile> {
  const defaultProjectName = slugName(options.projectName || path.basename(path.resolve(process.cwd(), directory)));
  const shouldPrompt = !options.yes && process.stdin.isTTY;
  const defaults = {
    projectName: defaultProjectName,
    target: options.target || 'web-api',
    language: options.language || 'typescript',
    automationTool: options.tool || 'playwright',
    frameworkPattern: options.pattern || 'pom',
    llmProvider: options.llmProvider || 'google',
  };

  const answers: any = shouldPrompt
    ? await inquirer.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: 'Project name',
          default: defaults.projectName,
          filter: slugName,
        },
        {
          type: 'list',
          name: 'llmProvider',
          message: 'LLM provider',
          default: defaults.llmProvider,
          choices: [
            { name: 'Google Gemini', value: 'google' },
            { name: 'OpenAI', value: 'openai' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'Azure OpenAI', value: 'azure' },
            { name: 'AWS Bedrock', value: 'aws' },
            { name: 'GCP Vertex AI', value: 'gcp' },
            { name: 'Ollama (local)', value: 'ollama' },
          ],
        },
        {
          type: 'input',
          name: 'llmModel',
          message: 'LLM model/deployment',
          default: (answers: { llmProvider: InitProvider }) => DEFAULT_MODELS[answers.llmProvider],
        },
        {
          type: 'input',
          name: 'azureEndpoint',
          message: 'Azure OpenAI endpoint env placeholder',
          default: '${AZURE_OPENAI_ENDPOINT}',
          when: (answers: { llmProvider: InitProvider }) => answers.llmProvider === 'azure',
        },
        {
          type: 'list',
          name: 'target',
          message: 'Automation target',
          default: defaults.target,
          choices: [
            { name: 'Web UI', value: 'web' },
            { name: 'API', value: 'api' },
            { name: 'Web + API', value: 'web-api' },
          ],
        },
        {
          type: 'list',
          name: 'language',
          message: 'Programming language for generated automation',
          default: defaults.language,
          choices: [
            { name: 'TypeScript', value: 'typescript' },
            { name: 'Python', value: 'python' },
            { name: 'Java', value: 'java' },
            { name: 'C#', value: 'csharp' },
          ],
        },
        {
          type: 'list',
          name: 'automationTool',
          message: 'Browser automation tool',
          default: defaults.automationTool,
          choices: (answers: { language: InitLanguage }) => {
            if (answers.language === 'python') return [{ name: 'Playwright', value: 'playwright' }, { name: 'Selenium', value: 'selenium' }];
            if (answers.language === 'java') return [{ name: 'Selenium', value: 'selenium' }, { name: 'Playwright', value: 'playwright' }];
            if (answers.language === 'csharp') return [{ name: 'Selenium', value: 'selenium' }, { name: 'Playwright', value: 'playwright' }];
            return [
              { name: 'Playwright', value: 'playwright' },
              { name: 'Cypress', value: 'cypress' },
              { name: 'WebdriverIO', value: 'webdriverio' },
              { name: 'Selenium', value: 'selenium' },
            ];
          },
        },
        {
          type: 'list',
          name: 'frameworkPattern',
          message: 'Framework pattern',
          default: defaults.frameworkPattern,
          choices: [
            { name: 'Page Object Model', value: 'pom' },
            { name: 'Simple tests', value: 'simple' },
            { name: 'Screenplay', value: 'screenplay' },
            { name: 'BDD / Cucumber', value: 'bdd' },
          ],
        },
      ])
    : defaults;

  const provider = (answers.llmProvider || defaults.llmProvider) as InitProvider;
  const language = (answers.language || defaults.language) as InitLanguage;
  const tool = (answers.automationTool || defaults.automationTool) as InitTool;
  return {
    projectName: slugName(answers.projectName || defaults.projectName),
    target: (answers.target || defaults.target) as InitTarget,
    language,
    automationTool: tool,
    frameworkPattern: (answers.frameworkPattern || defaults.frameworkPattern) as InitPattern,
    testRunner: options.testRunner || inferDefaultRunner(language, tool),
    llmProvider: provider,
    llmModel: options.llmModel || answers.llmModel || DEFAULT_MODELS[provider],
    azureEndpoint: answers.azureEndpoint,
    azureDeployment: provider === 'azure' ? (options.llmModel || answers.llmModel || DEFAULT_MODELS.azure) : undefined,
  };
}

function writeProjectProfileConfig(projectRoot: string, profile: InitProfile): void {
  const configPath = path.join(projectRoot, 'resources', 'config', 'webpilot.yaml');
  if (!fs.existsSync(configPath)) return;
  let yaml = fs.readFileSync(configPath, 'utf8');
  yaml = yaml.replace(/activeProvider:\s*"[^"]+"/, `activeProvider: "${profile.llmProvider}"`);
  yaml += `

# Project generation profile selected by webpilot init.
project:
  name: "${profile.projectName}"
  target: "${profile.target}"
  language: "${profile.language}"
  automationTool: "${profile.automationTool}"
  testFramework: "${profile.testRunner}"
  frameworkPattern: "${profile.frameworkPattern}"
`;
  fs.writeFileSync(configPath, yaml, 'utf8');
}

function writeLlmProfile(projectRoot: string, profile: InitProfile): void {
  const llmPath = path.join(projectRoot, 'resources', 'config', 'llm.json');
  if (!fs.existsSync(llmPath)) return;
  const llm = JSON.parse(fs.readFileSync(llmPath, 'utf8'));
  llm[profile.llmProvider] = {
    ...(llm[profile.llmProvider] || {}),
    model: profile.llmModel,
  };
  if (profile.llmProvider === 'azure') {
    llm.azure.endpoint = profile.azureEndpoint || '${AZURE_OPENAI_ENDPOINT}';
    llm.azure.deploymentId = profile.azureDeployment || '${AZURE_OPENAI_DEPLOYMENT}';
    llm.azure.apiKey = '${AZURE_OPENAI_API_KEY}';
  }
  fs.writeFileSync(llmPath, JSON.stringify(llm, null, 2) + '\n', 'utf8');
}

function configuredValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('YOUR_') || trimmed.startsWith('your_')) return undefined;
  const envMatch = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  return envMatch ? process.env[envMatch[1]] : trimmed;
}

async function runDoctor(options: { provider?: string; json?: boolean } = {}): Promise<DoctorCheck[]> {
  const { execSync } = require('child_process');
  const originalLog = console.log;
  if (options.json) {
    console.log = () => undefined;
  }
  const checks: DoctorCheck[] = [];
  const pass = (label: string) => checks.push({ ok: true, required: true, label });
  const warn = (label: string, fix?: string) => checks.push({ ok: false, required: false, label, fix });
  const fail = (label: string, fix?: string) => checks.push({ ok: false, required: true, label, fix });
  const exists = (relativePath: string) => fs.existsSync(path.join(process.cwd(), relativePath));

  try {
  console.log(`\n${chalk.magenta('=== WebPilot Doctor ===')}`);

  console.log(`\n${chalk.blue('Browser provider')}`);
  try {
    const provider = BrowserProviderRegistry.resolve(options.provider);
    for (const check of provider.doctor()) {
      if (check.ok) pass(check.label);
      else if (check.required) fail(check.label, check.fix);
      else warn(check.label, check.fix);
    }
  } catch (error: any) {
    fail(error.message);
  }

  console.log(`\n${chalk.blue('Project')}`);
  let projectProfile: { language?: string; automationTool?: string; testFramework?: string } = {};
  try {
    const yaml = require('js-yaml');
    const configPath = path.join(process.cwd(), 'resources', 'config', 'webpilot.yaml');
    if (fs.existsSync(configPath)) {
      projectProfile = (yaml.load(fs.readFileSync(configPath, 'utf8')) as any)?.project || {};
    }
  } catch {
    projectProfile = {};
  }
  const requiredProjectPaths = [
    'resources/config/webpilot.yaml',
    'resources/config/llm.json',
    'resources/config/environments/qa.json',
    'resources/prompts',
    'tests',
    ...(projectProfile.language === 'python' && projectProfile.automationTool === 'playwright'
      ? ['pyproject.toml', 'tests/generated']
      : []),
    ...(projectProfile.language === 'java' && projectProfile.automationTool === 'selenium'
      ? ['pom.xml', 'src/test/java']
      : []),
    ...(projectProfile.language === 'typescript' && projectProfile.automationTool === 'cypress'
      ? ['cypress.config.ts', 'cypress/e2e']
      : []),
    ...(projectProfile.language === 'typescript' && projectProfile.automationTool === 'webdriverio'
      ? ['wdio.conf.ts', 'test/specs']
      : []),
    ...(!projectProfile.language ||
    (projectProfile.language === 'typescript' && projectProfile.automationTool === 'playwright')
      ? ['packages/test-framework']
      : []),
  ];
  for (const relativePath of requiredProjectPaths) {
    if (exists(relativePath)) pass(`${relativePath} found`);
    else fail(`${relativePath} missing`, `Run ${chalk.bold('webpilot init')} in this project.`);
  }
  try {
    fs.mkdirSync(path.join(process.cwd(), 'runtime'), { recursive: true });
    const probe = path.join(process.cwd(), 'runtime', `.webpilot-doctor-${Date.now()}`);
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    pass('runtime/ is writable');
  } catch (error: any) {
    fail('runtime/ is not writable', error.message);
  }

  console.log(`\n${chalk.blue('Node and Playwright')}`);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) pass(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} is too old`, 'Install Node 20 or newer.');
  try {
    const npmVersion = execSync('npm --version', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    pass(`npm ${npmVersion}`);
  } catch {
    fail('npm is not available', 'Install Node.js from https://nodejs.org/.');
  }
  try {
    const playwrightVersion = execSync('npx playwright --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    pass(playwrightVersion);
    const chromiumPath = require('playwright').chromium.executablePath();
    if (fs.existsSync(chromiumPath)) pass('Playwright Chromium browser installed');
    else warn('Playwright Chromium browser not installed', 'Run: npx playwright install chromium');
  } catch {
    fail('Playwright is not ready', 'Run: npm install && npx playwright install chromium');
  }

  console.log(`\n${chalk.blue('Python and WebPilot engine')}`);
  try {
    const { resolvePythonPath, hasBrowserUse } = require('../integrations/browser_use/PythonRuntime');
    const py = resolvePythonPath();
    const version = execSync(
      `"${py}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const [major, minor] = version.split('.').map(Number);
    if (major > 3 || (major === 3 && minor >= 11)) pass(`Python ${version} (${py})`);
    else {
      let compatiblePython: string | null = null;
      for (const candidate of ['python3.12', 'python3.11', 'python3']) {
        try {
          const candidateVersion = execSync(
            `"${candidate}" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"`,
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          ).trim();
          const [candidateMajor, candidateMinor] = candidateVersion.split('.').map(Number);
          if (candidateMajor > 3 || (candidateMajor === 3 && candidateMinor >= 11)) {
            compatiblePython = `${candidate} (${candidateVersion})`;
            break;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (compatiblePython) {
        warn(
          `Current Python ${version} is too old, but ${compatiblePython} is available`,
          'Run: webpilot setup'
        );
      } else {
        fail(`Python ${version} is too old`, 'Install Python 3.11+ and run: webpilot setup');
      }
    }

    if (!hasBrowserUse(py)) {
      warn(`browser_use not installed for ${py}`, 'Run: webpilot setup');
    } else {
      const installRoot = findCliInstallRoot();
      const source = execSync(`"${py}" -c "import browser_use; print(browser_use.__file__)"`, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: [
            path.join(installRoot, 'packages', 'browser-use'),
            path.join(installRoot, 'src'),
          ].join(path.delimiter),
        },
      }).trim();
      const vendored = source.includes(path.join('packages', 'browser-use'));
      if (vendored) pass('browser_use vendored source installed');
      else warn(`browser_use resolves outside WebPilot: ${source}`, 'Run: webpilot setup');
    }
  } catch (error: any) {
    warn(`Python/WebPilot engine check failed: ${error.message}`, 'Run: webpilot setup');
  }

  console.log(`\n${chalk.blue('LLM provider')}`);
  try {
    const { ConfigManager } = require('../core/ConfigManager');
    const provider = String(ConfigManager.getInstance().get('framework.activeProvider', 'google')).toLowerCase();
    const llmPath = path.join(process.cwd(), 'resources', 'config', 'llm.json');
    const llm = fs.existsSync(llmPath) ? JSON.parse(fs.readFileSync(llmPath, 'utf8')) : {};
    const block = llm[provider] || {};
    const requiredEnvByProvider: Record<string, string[]> = {
      google: ['GEMINI_API_KEY'],
      openai: ['OPENAI_API_KEY'],
      anthropic: ['ANTHROPIC_API_KEY'],
      azure: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT'],
      aws: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_BEDROCK_REGION'],
      gcp: ['GCP_API_KEY'],
    };
    const requiredEnv = requiredEnvByProvider[provider] || [];
    const missing = requiredEnv.filter((name) => !process.env[name]);
    const inlineApiKey = configuredValue(block.apiKey);
    const inlineEndpoint = configuredValue(block.endpoint);
    const inlineDeployment = configuredValue(block.deploymentId);

    if (provider === 'ollama') {
      pass('Ollama selected (no cloud API key required)');
    } else if (missing.length === 0 || inlineApiKey) {
      if (provider === 'azure' && !(process.env.AZURE_OPENAI_ENDPOINT || inlineEndpoint)) {
        fail('Azure endpoint missing', 'Set AZURE_OPENAI_ENDPOINT in .env.');
      } else if (provider === 'azure' && !(process.env.AZURE_OPENAI_DEPLOYMENT || inlineDeployment)) {
        fail('Azure deployment missing', 'Set AZURE_OPENAI_DEPLOYMENT in .env.');
      } else {
        pass(`${provider} credentials are configured`);
      }
    } else {
      fail(
        `${provider} credentials missing: ${missing.join(', ')}`,
        `Copy .env.example to .env and set ${missing.join(', ')}.`
      );
    }
  } catch (error: any) {
    fail(`LLM config check failed: ${error.message}`, 'Check resources/config/webpilot.yaml and resources/config/llm.json.');
  }

  console.log(`\n${chalk.blue('Report assets')}`);
  const installRoot = findCliInstallRoot();
  for (const asset of ['webpilot-logo-light.png', 'webpilot-logo-dark.png']) {
    const inProject = path.join(process.cwd(), 'resources', 'assets', asset);
    const inInstall = path.join(installRoot, 'resources', 'assets', asset);
    if (fs.existsSync(inProject) || fs.existsSync(inInstall)) pass(`Report asset ${asset} available`);
    else fail(`Report asset ${asset} missing`, 'Reinstall WebPilot or rerun webpilot init.');
  }

  console.log('');
  for (const check of checks) {
    const icon = check.ok ? chalk.green('✔') : check.required ? chalk.red('✘') : chalk.yellow('⚠');
    console.log(`  ${icon} ${check.label}`);
    if (!check.ok && check.fix) console.log(`    ${chalk.dim('→')} ${check.fix}`);
  }

  const failures = checks.filter((check) => !check.ok && check.required);
  const warnings = checks.filter((check) => !check.ok && !check.required);
  console.log(
    `\n${failures.length === 0 ? chalk.green('WebPilot doctor passed') : chalk.red('WebPilot doctor found blockers')}` +
      chalk.dim(` (${failures.length} blocker${failures.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'})`)
  );
  if (failures.length > 0) process.exitCode = 1;
  console.log('');
  } finally {
    if (options.json) {
      console.log = originalLog;
      const failures = checks.filter((check) => !check.ok && check.required);
      const warnings = checks.filter((check) => !check.ok && !check.required);
      console.log(
        JSON.stringify(
          {
            ok: failures.length === 0,
            blockers: failures.length,
            warnings: warnings.length,
            checks,
          },
          null,
          2
        )
      );
    }
  }
  return checks;
}

/**
 * COMMAND: init
 */
program
  .command('init')
  .argument('[directory]', 'Directory to initialize as a WebPilot project', '.')
  .option('-f, --force', 'Overwrite starter files that WebPilot owns')
  .option('-y, --yes', 'Use defaults and skip the interactive wizard')
  .option('--project-name <name>', 'Project name to write into the WebPilot profile')
  .option('--llm-provider <provider>', 'LLM provider: google, openai, anthropic, azure, aws, gcp, ollama')
  .option('--llm-model <model>', 'LLM model or Azure deployment name')
  .option('--target <target>', 'Automation target: web, api, web-api')
  .option('--language <language>', 'Generated automation language: typescript, python, java, csharp')
  .option('--tool <tool>', 'Automation tool: playwright, selenium, cypress, webdriverio')
  .option('--pattern <pattern>', 'Framework pattern: simple, pom, screenplay, bdd')
  .option('--test-runner <runner>', 'Test runner to record in the project profile')
  .description('Scaffold a brand new WebPilot AI QE project')
  .action(async (directory: string, options: {
    force?: boolean;
    yes?: boolean;
    projectName?: string;
    llmProvider?: InitProvider;
    llmModel?: string;
    target?: InitTarget;
    language?: InitLanguage;
    tool?: InitTool;
    pattern?: InitPattern;
    testRunner?: string;
  }) => {
    const profile = await resolveInitProfile(directory, options);
    const spinner = ora(`Scaffolding ${profile.language}/${profile.automationTool} WebPilot project...`).start();
    try {
      const projectRoot = path.resolve(process.cwd(), directory);
      const installRoot = findCliInstallRoot();
      const cliPackageVersion = (() => {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, 'package.json'), 'utf8'));
          return typeof pkg.version === 'string' ? pkg.version : '1.0.3';
        } catch {
          return '1.0.3';
        }
      })();
      const dirs = [
        'resources/config/environments',
        'resources/prompts',
        'tests/web',
        'tests/api',
        'runtime/reports/html',
        'runtime/reports/data/summaries',
        'runtime/reports/data/execution-history',
        'runtime/reports/data/llm-usage',
        'runtime/reports/data/api',
        'runtime/reports/data/logs',
        'runtime/reports/markdown',
        'runtime/reports/junit',
        'runtime/reports/videos',
        'runtime/reports/traces',
        'runtime/artifacts',
        'runtime/healing-cache',
        'runtime/reports/assets',
        'runtime/site-knowledge',
        ...(isFullTypeScriptPlaywright(profile)
          ? [
              'packages/test-framework/apis',
              'packages/test-framework/config',
              'packages/test-framework/core',
              'packages/test-framework/data',
              'packages/test-framework/pages',
              'packages/test-framework/tests',
            ]
          : [])
      ];

      fs.mkdirSync(projectRoot, { recursive: true });
      dirs.forEach(d => fs.mkdirSync(path.join(projectRoot, d), { recursive: true }));

      const copyMissingTree = (source: string, destination: string) => {
        if (!fs.existsSync(source)) return;
        fs.mkdirSync(destination, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
          const sourcePath = path.join(source, entry.name);
          const destinationPath = path.join(destination, entry.name);
          if (entry.isDirectory()) {
            copyMissingTree(sourcePath, destinationPath);
          } else if (!fs.existsSync(destinationPath)) {
            fs.copyFileSync(sourcePath, destinationPath);
          }
        }
      };

      copyMissingTree(
        path.join(installRoot, 'resources', 'config'),
        path.join(projectRoot, 'resources', 'config')
      );
      copyMissingTree(
        path.join(installRoot, 'resources', 'prompts'),
        path.join(projectRoot, 'resources', 'prompts')
      );
      writeProjectProfileConfig(projectRoot, profile);
      writeLlmProfile(projectRoot, profile);
      const writeProjectFile = (relativePath: string, content: string) => {
        const filePath = path.join(projectRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (options.force || !fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content.trimEnd() + '\n', 'utf8');
        }
      };

      const copyProjectFile = (source: string, relativeDestination: string) => {
        const destination = path.join(projectRoot, relativeDestination);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (fs.existsSync(source) && (options.force || !fs.existsSync(destination))) {
          fs.copyFileSync(source, destination);
        }
      };

      copyProjectFile(path.join(installRoot, '.env.example'), '.env.example');

      writeProjectFile('.gitignore', `node_modules/
.env
.venv/
runtime/
test-results/
playwright-report/
*.log
`);

      const packageScripts = isFullTypeScriptPlaywright(profile)
        ? `"test:web": "webpilot run tests/web/automationexercise_smoke.txt --env qa --headed --report",`
        : `"webpilot:run": "webpilot run tests/web/automationexercise_smoke.txt --env qa --headed --report",
    "test:generated": "echo \\"Generated-code runner for ${profile.language}/${profile.automationTool} is scaffolded; install its dependencies before running.\\"",`;

      writeProjectFile('package.json', `{
  "name": "${profile.projectName}",
  "private": true,
  "scripts": {
    "setup": "webpilot setup",
    "doctor": "webpilot doctor",
    ${packageScripts}
    "report": "webpilot report --html"
  },
  "devDependencies": {
    "@qubiqlabs/webpilot": "^${cliPackageVersion}"
  }
}`);

      writeProjectFile(
        'tests/web/automationexercise_smoke.txt',
        TestTemplateRegistry.render('web-smoke', { name: 'AutomationExercise smoke' })
      );

      writeProjectFile(
        'tests/web/checkout_flow.txt',
        TestTemplateRegistry.render('checkout-flow', { name: 'Checkout flow' })
      );

      writeProjectFile(
        'tests/api/petstore_smoke.txt',
        TestTemplateRegistry.render('api-smoke', { name: 'Petstore smoke' })
      );

      const runScript = isFullTypeScriptPlaywright(profile) ? 'npm run test:web' : 'npm run webpilot:run';

      writeProjectFile('README.md', `# ${profile.projectName}

This project was scaffolded with WebPilot.

## Project Profile

- LLM provider: ${profile.llmProvider}
- LLM model/deployment: ${profile.llmModel}
- Target: ${profile.target}
- Language: ${profile.language}
- Automation tool: ${profile.automationTool}
- Test runner: ${profile.testRunner}
- Framework pattern: ${profile.frameworkPattern}

## Setup

\`\`\`bash
npm install
npm run setup
cp .env.example .env
\`\`\`

Add your LLM provider credentials to \`.env\`, then check the project:

\`\`\`bash
npm run doctor
\`\`\`

## Run the sample

\`\`\`bash
${runScript}
open runtime/reports/html/index.html
\`\`\`

The WebPilot natural-language runner is available for discovery and reports. Generated-code scaffolds for non-TypeScript profiles are starter templates while codegen support is expanded.
`);

      const assetsSource = path.join(installRoot, 'resources', 'assets');
      for (const asset of ['webpilot-logo.png', 'webpilot-logo-light.png', 'webpilot-logo-dark.png']) {
        copyProjectFile(path.join(assetsSource, asset), path.join('resources', 'assets', asset));
      }

      if (!isFullTypeScriptPlaywright(profile)) {
        if (profile.language === 'python' && profile.automationTool === 'playwright') {
          writeProjectFile('pyproject.toml', `[project]
name = "${profile.projectName}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "pytest>=8.0.0",
  "pytest-playwright>=0.5.0"
]

[tool.pytest.ini_options]
testpaths = ["tests/generated"]
`);
          writeProjectFile('tests/generated/test_automationexercise_smoke.py', `from playwright.sync_api import Page


def test_automationexercise_smoke(page: Page):
    page.goto("https://automationexercise.com/")
    assert "Automation Exercise" in page.title()
`);
        } else if (profile.language === 'typescript' && profile.automationTool === 'cypress') {
          writeProjectFile('cypress.config.ts', `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'https://automationexercise.com',
    specPattern: 'cypress/e2e/**/*.cy.ts',
  },
});
`);
          writeProjectFile('cypress/e2e/automationexercise_smoke.cy.ts', `describe('AutomationExercise smoke', () => {
  it('opens the home page', () => {
    cy.visit('/');
    cy.contains('AutomationExercise').should('be.visible');
  });
});
`);
        } else if (profile.language === 'typescript' && profile.automationTool === 'webdriverio') {
          writeProjectFile('wdio.conf.ts', `export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.ts'],
  maxInstances: 1,
  capabilities: [{ browserName: 'chrome' }],
  framework: 'mocha',
  services: ['chromedriver'],
};
`);
          writeProjectFile('test/specs/automationexercise_smoke.ts', `describe('AutomationExercise smoke', () => {
  it('opens the home page', async () => {
    await browser.url('https://automationexercise.com/');
    await expect(browser).toHaveTitle(expect.stringContaining('Automation Exercise'));
  });
});
`);
        } else if (profile.language === 'java' && profile.automationTool === 'selenium') {
          writeProjectFile('pom.xml', `<project xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.webpilot</groupId>
  <artifactId>${profile.projectName}</artifactId>
  <version>0.1.0</version>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>4.27.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.4</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`);
          writeProjectFile('src/test/java/io/webpilot/AutomationExerciseSmokeTest.java', `package io.webpilot;

import org.junit.jupiter.api.Test;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;

import static org.junit.jupiter.api.Assertions.assertTrue;

class AutomationExerciseSmokeTest {
  @Test
  void opensHomePage() {
    WebDriver driver = new ChromeDriver();
    try {
      driver.get("https://automationexercise.com/");
      assertTrue(driver.getTitle().contains("Automation Exercise"));
    } finally {
      driver.quit();
    }
  }
}
`);
        } else {
          writeProjectFile('GENERATED_CODE_PROFILE.md', `# Generated Code Profile

WebPilot recorded this automation profile:

- Language: ${profile.language}
- Tool: ${profile.automationTool}
- Runner: ${profile.testRunner}
- Pattern: ${profile.frameworkPattern}

Starter templates for this combination are not fully implemented yet. WebPilot can still run natural-language discovery flows and produce universal reports.
`);
        }

        spinner.succeed(chalk.green(`WebPilot project initialized at ${projectRoot}`));
        console.log(`\n${chalk.cyan('Next steps:')}`);
        if (projectRoot !== process.cwd()) {
          console.log(`  1. ${chalk.bold(`cd ${path.relative(process.cwd(), projectRoot) || projectRoot}`)}`);
        }
        console.log(`  ${projectRoot !== process.cwd() ? '2' : '1'}. ${chalk.bold('npm install')}`);
        console.log(`  ${projectRoot !== process.cwd() ? '3' : '2'}. ${chalk.bold('npm run setup')}`);
        console.log(`  ${projectRoot !== process.cwd() ? '4' : '3'}. ${chalk.bold('cp .env.example .env')} and add provider credentials`);
        console.log(`  ${projectRoot !== process.cwd() ? '5' : '4'}. ${chalk.bold('npm run doctor')}`);
        console.log(`  ${projectRoot !== process.cwd() ? '6' : '5'}. ${chalk.bold('npm run webpilot:run')}\n`);
        return;
      }

      // Define path helper
      const writeFrameworkFile = (subdir: string, filename: string, content: string) => {
        const dirPath = path.join(projectRoot, 'packages', 'test-framework', subdir);
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
    const configPath = path.join(process.cwd(), 'resources', 'config', 'environments', \`\${env}.json\`);
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
      path.join(process.cwd(), 'packages', 'test-framework', 'data', filename),
      path.join(process.cwd(), 'data', config.environment, filename),
      path.join(process.cwd(), 'packages', 'test-framework', 'data', config.environment, filename),
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
      path.join(process.cwd(), 'packages', 'test-framework', 'data', filename),
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

      // 9. Create playwright.config.ts in packages/test-framework/
      const playConfigDest = path.join(projectRoot, 'packages', 'test-framework', 'playwright.config.ts');
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
    ['html', { open: 'never', outputFolder: '../../runtime/playwright-report' }],
    ['junit', { outputFile: '../../runtime/reports/junit/junit-results.xml' }],
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
      if (options.force || !fs.existsSync(playConfigDest)) {
        fs.writeFileSync(playConfigDest, defaultPlaywrightConfig, 'utf8');
      }

      spinner.succeed(chalk.green(`WebPilot project initialized at ${projectRoot}`));
      
      console.log(`\n${chalk.cyan('Next steps:')}`);
      if (projectRoot !== process.cwd()) {
        console.log(`  1. ${chalk.bold(`cd ${path.relative(process.cwd(), projectRoot) || projectRoot}`)}`);
      }
      console.log(`  ${projectRoot !== process.cwd() ? '2' : '1'}. ${chalk.bold('npm install')}`);
      console.log(`  ${projectRoot !== process.cwd() ? '3' : '2'}. ${chalk.bold('npm run setup')}`);
      console.log(`  ${projectRoot !== process.cwd() ? '4' : '3'}. ${chalk.bold('cp .env.example .env')} and add provider credentials`);
      console.log(`  ${projectRoot !== process.cwd() ? '5' : '4'}. ${chalk.bold('npm run doctor')}`);
      console.log(`  ${projectRoot !== process.cwd() ? '6' : '5'}. ${chalk.bold('npm run test:web')}\n`);
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
  .option('--provider <name>', 'Browser provider to validate')
  .option('--json', 'Print machine-readable doctor output')
  .action(async (options: { provider?: string; json?: boolean }) => {
    await runDoctor(options);
    return;

    console.log(`\n${chalk.magenta('=== WebPilot Doctor Diagnostic Check ===')}`);
    
    // Check paths
    const requiredDirs = ['src', 'packages', 'resources', 'tests', 'docs', 'scripts'];
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

    console.log(`\n${chalk.blue('Checking Python (WebPilot engine):')}`);
    try {
      const { execSync } = require('child_process');
      const { resolvePythonPath, hasBrowserUse } = require('../integrations/browser_use/PythonRuntime');
      const py = resolvePythonPath();
      if (!hasBrowserUse(py)) {
        console.log(`  ${chalk.yellow('⚠')} browser_use not found for ${py}`);
        console.log(`  ${chalk.dim('→')} Run: ${chalk.bold('webpilot setup')}`);
      } else {
        const installRoot = findCliInstallRoot();
        const source = execSync(
          `"${py}" -c "import browser_use; print(browser_use.__file__)"`,
          {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
              ...process.env,
              PYTHONPATH: [
                path.join(installRoot, 'packages', 'browser-use'),
                path.join(installRoot, 'src'),
              ].join(path.delimiter),
            },
          }
        ).trim();
        const vendored = source.includes(path.join('packages', 'browser-use'));
        console.log(
          `  ${vendored ? chalk.green('✔') : chalk.yellow('⚠')} browser_use source: ${source}`
        );
        if (!vendored) {
          console.log(`  ${chalk.dim('→')} Run webpilot setup to install the vendored source editable`);
        }
      }
    } catch (e: any) {
      console.log(`  ${chalk.red('✘')} Python check failed: ${e.message}`);
    }

    console.log(`\n${chalk.blue('Checking LLM config (WebPilot / codegen):')}`);
    try {
      const { execSync } = require('child_process');
      const py = require('../integrations/browser_use/PythonRuntime').resolvePythonPath();
      const installRoot = findCliInstallRoot();
      execSync(
        `"${py}" -c "from integrations.browser_use.llm_config import resolve_provider_config, validate_provider_config; p,c=resolve_provider_config(); validate_provider_config(p,c); print(f'OK provider={p} endpoint configured')"` ,
        {
          cwd: process.cwd(),
          stdio: 'pipe',
          encoding: 'utf8',
          env: {
            ...process.env,
            PYTHONPATH: [
              path.join(installRoot, 'packages', 'browser-use'),
              path.join(installRoot, 'src'),
            ].join(path.delimiter),
          },
        }
      );
      console.log(`  ${chalk.green('✔')} LLM credentials resolved for WebPilot`);
    } catch (e: any) {
      const msg = (e.stdout || e.stderr || e.message || '').toString();
      console.log(`  ${chalk.red('✘')} LLM not ready for WebPilot`);
      console.log(`  ${chalk.dim(msg.split('\\n').slice(0, 6).join('\\n'))}`);
      console.log(`  ${chalk.dim('→')} Copy .env.example to .env and set AZURE_OPENAI_* (or switch framework.activeProvider)`);
    }

    console.log(`\n${chalk.blue('Checking TypeScript LLM payload compatibility:')}`);
    try {
      const { resolveModelCapabilities, probeAzureTokenLimitField } = require('../core/llmCapabilities');
      const llm = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'resources', 'config', 'llm.json'), 'utf8'));
      const provider = (require('../core/ConfigManager').ConfigManager.getInstance().get(
        'framework.activeProvider',
        'azure'
      ) as string).toLowerCase();
      const block = llm[provider] || {};
      if (provider === 'azure' && block.endpoint && block.apiKey && block.deploymentId) {
        const caps = resolveModelCapabilities(block.deploymentId || block.model || '');
        const probe = await probeAzureTokenLimitField({
          endpoint: block.endpoint,
          deployment: block.deploymentId,
          apiKey: block.apiKey,
          apiVersion: block.apiVersion || '2024-12-01-preview',
        });
        const aligned = caps.tokenLimitField === probe.field;
        console.log(
          `  ${aligned ? chalk.green('✔') : chalk.yellow('⚠')} Deployment ${block.deploymentId}: ` +
            `expects ${probe.field} (config: ${caps.tokenLimitField} via ${caps.source})`
        );
        if (!aligned) {
          console.log(
            `  ${chalk.dim('→')} Add to resources/config/llm-models.json overrides: ` +
              `"${block.deploymentId}": { "tokenLimitField": "${probe.field}" }`
          );
        }
      } else {
        console.log(`  ${chalk.dim('○')} Skipped (active provider is not Azure or credentials missing)`);
      }
    } catch (e: any) {
      console.log(`  ${chalk.red('✘')} LLM payload probe failed: ${e.message}`);
    }

    console.log(`\n${chalk.magenta('=== Diagnostics Complete ===')}\n`);
  });

/**
 * COMMAND: setup
 */
program
  .command('setup')
  .description('Create the project Python environment and install the WebPilot browser engine')
  .action(() => {
    const spinner = ora('Preparing the WebPilot Python environment...').start();
    try {
      spinner.stop();
      const python = setupPythonVenv();
      console.log(chalk.green(`Python environment ready: ${python}`));
    } catch (error: any) {
      spinner.fail(chalk.red(`Setup failed: ${error.message}`));
      process.exitCode = 1;
    }
  });

/**
 * COMMAND: create test <name>
 */
program
  .command('create')
  .argument('<type>', 'Type of template to create: "test" or "api"')
  .argument('<name>', 'Logical name of the test asset')
  .option(
    '--template <name>',
    `Template: ${TestTemplateRegistry.list().join(', ')}`,
    undefined
  )
  .option('--base-url <url>', 'Base URL for web templates')
  .description('Generate template natural language test scripts')
  .action((type, name, options: { template?: TestTemplateKind; baseUrl?: string }) => {
    const cleanName = name.replace(/\s+/g, '_').toLowerCase();
    
    if (type === 'test') {
      const testPath = path.join(process.cwd(), 'tests', 'web', `${cleanName}.txt`);
      const templateKind = options.template || 'web-smoke';
      if (!TestTemplateRegistry.list().includes(templateKind)) {
        console.error(chalk.red(`Unsupported template: ${templateKind}`));
        console.error(chalk.dim(`Choose one of: ${TestTemplateRegistry.list().join(', ')}`));
        process.exit(1);
      }
      const template = TestTemplateRegistry.render(templateKind, {
        name,
        baseUrl: options.baseUrl,
      });
      fs.mkdirSync(path.dirname(testPath), { recursive: true });
      fs.writeFileSync(testPath, template, 'utf8');
      console.log(chalk.green(`Created Web UI template: ${testPath}`));
      console.log(
        AuthoringOutput.block(
          AuthoringOutput.createdTest(path.relative(process.cwd(), testPath), {
            runCommand: `webpilot run ${path.relative(process.cwd(), testPath)} --codegen --report`,
          })
        )
      );
    } else if (type === 'api') {
      const apiPath = path.join(process.cwd(), 'tests', 'api', `${cleanName}.txt`);
      const template = TestTemplateRegistry.render('api-smoke', { name });
      fs.mkdirSync(path.dirname(apiPath), { recursive: true });
      fs.writeFileSync(apiPath, template, 'utf8');
      console.log(chalk.green(`Created API template: ${apiPath}`));
      console.log(
        AuthoringOutput.block(
          AuthoringOutput.createdTest(path.relative(process.cwd(), apiPath), {
            runCommand: `webpilot run ${path.relative(process.cwd(), apiPath)} --report`,
          })
        )
      );
    } else {
      console.error(chalk.red(`Unsupported type: ${type}. Choose "test" or "api".`));
    }
  });

/**
 * COMMAND: import-api <swagger-url-or-file>
 */
program
  .command('import-api')
  .argument('<source>', 'OpenAPI/Swagger URL or local .json/.yaml file')
  .option('-o, --output <file>', 'Write generated NL scenario to this path')
  .option('--operations <ops>', 'Comma-separated operations, e.g. GET /pet/{petId},POST /pet')
  .description('Import OpenAPI spec and scaffold an API test script')
  .action(async (source: string, options: { output?: string; operations?: string }) => {
    try {
      const loaded = await OpenApiLoader.load(source);
      const text = OpenApiLoader.toScenarioText(loaded, source);
      const outPath =
        options.output ||
        path.join(
          process.cwd(),
          'tests',
          'api',
          `${loaded.title.replace(/\s+/g, '_').toLowerCase()}_openapi.txt`
        );
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, text, 'utf8');
      console.log(chalk.green(`Imported OpenAPI (${loaded.operations.length} operations)`));
      console.log(chalk.dim(`  Title: ${loaded.title}`));
      if (loaded.baseUrl) console.log(chalk.dim(`  Base URL: ${loaded.baseUrl}`));
      console.log(chalk.green(`  Scenario: ${outPath}`));
      if (options.operations) {
        const steps = OpenApiLoader.buildSteps(loaded, {
          operations: options.operations.split(',').map((s) => s.trim())
        });
        console.log(chalk.dim(`  Built ${steps.length} executable step(s) from --operations`));
      }
    } catch (err: any) {
      console.error(chalk.red(`import-api failed: ${err.message}`));
      process.exit(1);
    }
  });

function inferEnvironmentForTest(testFilePath: string): string {
  try {
    const yaml = require('js-yaml');
    const wpPath = path.join(process.cwd(), 'resources', 'config', 'webpilot.yaml');
    if (fs.existsSync(wpPath)) {
      const wp = yaml.load(fs.readFileSync(wpPath, 'utf8')) as { framework?: { defaultEnvironment?: string } };
      return wp?.framework?.defaultEnvironment || 'qa';
    }
  } catch {
    /* ignore */
  }

  return 'qa';
}

/**
 * COMMAND: ci
 */
const ci = program.command('ci').description('CI helpers for WebPilot workflows and artifacts');

ci
  .command('init')
  .description('Create a GitHub Actions workflow for WebPilot')
  .option('--force', 'Overwrite an existing workflow')
  .option('--provider <name>', 'Browser provider for the workflow', 'browser-use')
  .option('--test-path <path>', 'Test path used by the workflow', 'tests/web')
  .option('--node-version <version>', 'Node.js version for setup-node', '20')
  .action((options: { force?: boolean; provider?: string; testPath?: string; nodeVersion?: string }) => {
    const result = writeGithubActionsWorkflow({
      force: options.force,
      workflow: {
        provider: options.provider,
        testPath: options.testPath,
        nodeVersion: options.nodeVersion,
      },
    });
    if (result.written) {
      console.log(chalk.green(`Created ${path.relative(process.cwd(), result.path)}`));
    } else {
      console.log(chalk.yellow(result.reason));
      console.log(chalk.dim(`Existing file: ${path.relative(process.cwd(), result.path)}`));
    }
  });

ci
  .command('doctor')
  .description('Run doctor with CI-oriented defaults')
  .option('--provider <name>', 'Browser provider to validate')
  .option('--json', 'Print machine-readable doctor output', true)
  .action(async (options: { provider?: string; json?: boolean }) => {
    await runDoctor({ provider: options.provider, json: options.json !== false });
  });

ci
  .command('run')
  .argument('[paths...]', 'Paths to natural language test scripts or directories')
  .option('-e, --env <env>', 'Environment to switch to', 'qa')
  .option('--provider <name>', 'Browser provider', 'browser-use')
  .option('--parallel <workers>', 'Run parallel workers', '1')
  .option('--codegen', 'Generate deterministic code after execution', false)
  .description('Run WebPilot with CI defaults and write an artifact manifest')
  .action((paths: string[] = [], options: { env?: string; provider?: string; parallel?: string; codegen?: boolean }) => {
    const { spawnSync } = require('child_process');
    const runPaths = paths.length > 0 ? paths : ['tests/web'];
    const args = [
      __filename,
      'run',
      ...runPaths,
      '--env',
      options.env || 'qa',
      '--provider',
      options.provider || 'browser-use',
      '--parallel',
      options.parallel || '1',
      '--report',
    ];
    if (options.codegen) args.push('--codegen');

    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: process.env.CI || 'true',
        WEBPILOT_CI: '1',
      },
      stdio: 'inherit',
    });

    const manifest = writeArtifactManifest();
    console.log(chalk.green(`Artifact manifest: ${path.relative(process.cwd(), manifest.path)}`));

    if (result.error) {
      console.error(chalk.red(`CI run failed to start: ${result.error.message}`));
      process.exit(2);
    }
    process.exit(result.status ?? 1);
  });

/**
 * COMMAND: run <file>
 */
program
  .command('run')
  .argument('<paths...>', 'Paths to natural language test scripts or directories')
  .option('-e, --env <env>', 'Environment to switch to (dev, qa, prod, azure)')
  .option('--headed', 'Launch browser in visible headed mode', false)
  .option('--architecture <arch>', 'Target generated architecture: flat, pom, bdd, pom-bdd', 'pom')
  .option('--parallel <workers>', 'Run parallel workers', '1')
  .option('--provider <name>', 'Browser provider: local-playwright, browser-use, testmu')
  .option('--report', 'Automatically generate HTML report after run completes')
  .option('--knowledge-only', 'Use learned capabilities only; never invoke WebPilot discovery')
  .option('--force-discovery', 'Use WebPilot discovery for every step and refresh learned capabilities')
  .option('--codegen', 'Generate and validate Playwright code after execution', false)
  .option('--site-model-only', 'Deprecated alias for --knowledge-only')
  .option('--no-site-model', 'Deprecated alias for --force-discovery')
  .description('Run natural language scripts in fully autonomous execution mode')
  .action(async (paths: string[], options) => {
    if (options.knowledgeOnly || options.siteModelOnly) {
      process.env.WEBPILOT_KNOWLEDGE_ONLY = '1';
    }
    if (options.forceDiscovery || options.siteModel === false) {
      process.env.WEBPILOT_DISABLE_SITE_KNOWLEDGE = '1';
    }
    if (options.codegen) {
      process.env.WEBPILOT_CODEGEN = '1';
      if (!process.env.WEBPILOT_CODEGEN_MODE) {
        process.env.WEBPILOT_CODEGEN_MODE = 'deterministic';
      }
    }
    const browserProvider = BrowserProviderRegistry.resolve(options.provider);
    if (!['local-playwright', 'browser-use', 'testmu'].includes(browserProvider.name)) {
      console.error(
        chalk.red(
          `Provider "${browserProvider.name}" is configured but not executable in this product slice yet.`
        )
      );
      console.error(chalk.dim('Use local-playwright, browser-use, or testmu for webpilot run.'));
      process.exit(1);
    }
    process.env.WEBPILOT_BROWSER_PROVIDER = browserProvider.name;

    let files: string[] = [];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          const readdir = (dir: string) => {
            for (const f of fs.readdirSync(dir)) {
              const fp = path.join(dir, f);
              if (fs.statSync(fp).isDirectory()) readdir(fp);
              else if (/\.(txt|ya?ml|json)$/i.test(fp)) files.push(fp);
            }
          };
          readdir(p);
        } else if (/\.(txt|ya?ml|json)$/i.test(p)) {
          files.push(p);
        }
      }
    }
    
    files = [...new Set(files)];
    if (files.length === 0) {
      console.log(chalk.red('No test scripts found (.txt, .yaml, .json).'));
      process.exit(1);
    }

    const metadataByFile = new Map(
      files.map((file) => [
        file,
        ScenarioMetadataParser.parse(fs.readFileSync(file, 'utf8')),
      ])
    );
    const metadataCodegen = [...metadataByFile.values()].some((meta) => meta.codegen === true);
    const metadataReport = [...metadataByFile.values()].some((meta) => meta.report === true);
    if (metadataCodegen) {
      process.env.WEBPILOT_CODEGEN = '1';
      if (!process.env.WEBPILOT_CODEGEN_MODE) {
        process.env.WEBPILOT_CODEGEN_MODE = 'deterministic';
      }
    }
    if (metadataReport) {
      options.report = true;
    }

    const runEnv = options.env || inferEnvironmentForTest(files[0]);
    if (!options.env && runEnv !== 'qa') {
      Logger.info(`Auto-selected environment "${runEnv}" for this test.`);
    }
    
    const concurrency = parseInt(options.parallel, 10) || 1;
    const jobStart = Date.now();
    UsageTracker.reset();
    
    CliDisplay.printBanner({
      test: files.length > 1 ? `${files.length} tests` : files[0],
      env: runEnv,
      mode: options.headed ? 'headed' : 'headless',
      architecture: options.architecture
    });
    Logger.info(`Browser provider: ${browserProvider.name}`);
    
    Logger.info(`Starting execution of ${files.length} tests with concurrency ${concurrency}...`);
    const metadataSummary = [...metadataByFile.entries()]
      .map(([file, meta]) => `${path.basename(file)}: ${meta.format}${meta.tags.length ? ` ${meta.tags.join(' ')}` : ''}`)
      .join('; ');
    if (metadataSummary) Logger.detail(`Authoring metadata: ${metadataSummary}`);
    
    let passes = 0;
    let fails = 0;
    
    const runTest = async (file: string) => {
      const nlFile = file;
      const testName = path.basename(file, path.extname(file));

      const isApi =
        nlFile.includes('/api/') ||
        /\.(ya?ml|json)$/i.test(nlFile);
      const isUI = !isApi && nlFile.endsWith('.txt');
      let success = false;
      let stepsExecuted: number | undefined;
      const testStart = Date.now();
      
      try {
        if (isUI) {
          UsageTracker.setPhase('execution');
          const engine = new Engine({
            testFilePath: nlFile,
            env: runEnv,
            headed: options.headed,
            interactive: false,
            architecture: options.architecture as any,
            forceBrowserUse: browserProvider.name !== 'local-playwright'
          });
          const result = await engine.execute();
          success = result.success;
          stepsExecuted = result.stepsExecuted;
        } else {
          const apiEngine = new ApiEngine({
            testFilePath: nlFile,
            env: runEnv
          });
          const result = await apiEngine.execute();
          success = result.success;
          stepsExecuted = result.stepsExecuted;
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
      await generateExecutionReports({ env: runEnv });
    }

    const manifest = writeArtifactManifest();
    console.log(
      AuthoringOutput.block(
        AuthoringOutput.runComplete({
          passed: passes,
          failed: fails,
          reportPath: options.report ? 'runtime/reports/html/index.html' : undefined,
          manifestPath: path.relative(process.cwd(), manifest.path),
          codegenEnabled: Boolean(options.codegen || metadataCodegen),
        })
      )
    );
    
    process.exit(fails > 0 ? 1 : 0);
  });

/**
 * COMMAND: replay <spec>
 */
program
  .command('replay')
  .argument(
    '[paths...]',
    'Generated Playwright spec files or directories',
    ['packages/test-framework/tests']
  )
  .option('--project <name>', 'Playwright project to run', 'chromium')
  .option('--headed', 'Run the browser in headed mode', false)
  .option('--grep <pattern>', 'Only run tests matching this expression')
  .description('Replay generated Playwright tests without invoking WebPilot discovery or an LLM')
  .action((paths: string[], options) => {
    const { spawnSync } = require('child_process');
    const playwrightCli = require.resolve('@playwright/test/cli');
    const args = [
      playwrightCli,
      'test',
      ...paths,
      '--config=packages/test-framework/playwright.config.ts',
      `--project=${options.project}`,
    ];
    if (options.headed) args.push('--headed');
    if (options.grep) args.push('--grep', options.grep);

    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    if (result.error) {
      console.error(chalk.red(`Replay failed to start: ${result.error.message}`));
      process.exit(2);
    }
    process.exit(result.status ?? 1);
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
 * COMMAND: reports tidy
 */
program
  .command('reports-tidy')
  .description('Move legacy flat files from runtime/reports/ into typed subfolders')
  .action(() => {
    ensureReportDirs();
    const moved = migrateLegacyReportFiles();
    if (moved === 0) {
      console.log(chalk.green('runtime/reports/ is already tidy (only subfolders at root).'));
      return;
    }
    console.log(chalk.green(`Moved ${moved} legacy report file(s) into subfolders.`));
    console.log(chalk.dim('Open suite report: runtime/reports/html/index.html'));
  });

/**
 * COMMAND: generate
 * Build deterministic Playwright code from a saved execution trace/plan.
 */
program
  .command('generate')
  .description('Generate deterministic Playwright code from a saved execution trace')
  .option('--from <slug>', 'Scenario slug to generate from, or "latest"', 'latest')
  .option('--no-validate', 'Skip TypeScript and Playwright validation')
  .action(async (options: { from?: string; validate?: boolean }) => {
    const slug =
      options.from === 'latest'
        ? readLatestPointer()?.slug || (() => {
            throw new Error('No latest codegen trace found. Run a test with webpilot run first.');
          })()
        : options.from!;

    console.log(`\n${chalk.magenta('=== WebPilot Deterministic Codegen ===')}`);
    console.log(`  Scenario slug: ${chalk.cyan(slug)}`);

    try {
      const result = await DeterministicCodegenPipeline.runFromSlug(slug, {
        validate: options.validate !== false,
      });
      console.log(`\n${chalk.green('Generated files:')}`);
      for (const file of result.files) {
        console.log(`  - ${file.path}`);
      }
      console.log(`\n${chalk.dim('Trace:')} ${result.metadata.sourceTrace}`);
      console.log(`${chalk.dim('Plan:')} ${result.metadata.sourcePlan}`);
      console.log(`\n${DeterministicCodegenPipeline.planSummary(result.plan)}`);
      console.log(`\n${chalk.dim('Replay without LLM:')} webpilot replay ${result.plan.specPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Codegen failed: ${msg}`));
      process.exitCode = 1;
    }
  });

/**
 * COMMAND: analyze
 */
program
  .command('analyze')
  .description('Generate a consolidated Markdown analysis report for all executions')
  .option('--flakes', 'Print flake classifications for failed runs')
  .action((options: { flakes?: boolean }) => {
    if (options.flakes) {
      const { FlakeAnalyzer } = require('../core/flake/FlakeAnalyzer');
      const { listSummarySlugs, resolveSummaryPath } = require('../core/ReportPaths');
      const slugs = listSummarySlugs();
      const failed = slugs.filter((slug: string) => {
        try {
          const summary = JSON.parse(fs.readFileSync(resolveSummaryPath(slug), 'utf8'));
          return summary.status !== 'PASSED';
        } catch {
          return false;
        }
      });

      if (failed.length === 0) {
        console.log(chalk.green('No failed runs found to analyze.'));
        return;
      }

      console.log(`\n${chalk.magenta.bold('=== WebPilot Flake Analysis ===')}\n`);
      for (const slug of failed) {
        const analysis = FlakeAnalyzer.analyzeSlug(slug);
        if (!analysis) {
          console.log(`${chalk.bold(slug)}: ${chalk.yellow('unable to classify')}`);
          continue;
        }
        FlakeAnalyzer.persist(slug, analysis);
        console.log(`${chalk.bold(slug)}`);
        console.log(`  Category : ${chalk.cyan(analysis.category)} (${Math.round(analysis.confidence * 100)}%)`);
        console.log(`  Cause    : ${analysis.likelyCause}`);
        console.log(`  Fix      : ${analysis.recommendation}`);
        if (analysis.evidence.length > 0) {
          console.log(`  Evidence : ${analysis.evidence.map((item: { label: string }) => item.label).join(', ')}`);
        }
        console.log('');
      }
      return;
    }

    generateMarkdownReport();
  });

/**
 * COMMAND: graph
 * Build a repository knowledge graph (page objects, tests, methods, relationships)
 * that is fed into code generation so the model reuses existing code instead of
 * re-inventing it. Reuses the TypeScript AST and, if present, enrichment from an
 * Understand-Anything graph (.understand-anything/knowledge-graph.json).
 */
program
  .command('graph')
  .description('Build/refresh the repository knowledge graph used to ground code generation')
  .option('--json', 'Print the full graph JSON to stdout instead of a summary')
  .option('--summary', 'Print the compact prompt summary that is injected into codegen')
  .option('--out <path>', 'Write the graph JSON to a custom path')
  .action(async (options: { json?: boolean; summary?: boolean; out?: string }) => {
    const graph = await RepoKnowledgeGraph.buildAsync();
    const outPath = options.out
      ? path.resolve(process.cwd(), options.out)
      : KNOWLEDGE_GRAPH_PATH;
    RepoKnowledgeGraph.save(graph, outPath);

    if (options.json) {
      console.log(JSON.stringify(graph, null, 2));
      return;
    }
    if (options.summary) {
      console.log(RepoKnowledgeGraph.toPromptSummary(graph));
      return;
    }

    const { stats, profile, sources, notes } = graph;
    const srcParts = [
      sources.typescriptCompiler ? 'TypeScript compiler AST' : null,
      sources.symbolParser ? 'TypeScript AST' : null,
      sources.treeSitter ? 'tree-sitter' : null,
      sources.understandAnything ? 'Understand-Anything' : null,
    ].filter(Boolean);

    console.log(`\n${chalk.magenta('=== WebPilot Repository Knowledge Graph ===')}`);
    console.log(`  Profile     : ${chalk.cyan(`${profile.language}/${profile.automationTool}/${profile.frameworkPattern}`)}`);
    console.log(`  Sources     : ${srcParts.join(' + ') || 'none'}`);
    console.log(`  Files       : ${stats.files}`);
    console.log(`  Page objects: ${stats.pages}`);
    console.log(`  Tests       : ${stats.tests}`);
    console.log(`  API modules : ${stats.apis}`);
    console.log(`  Classes     : ${stats.classes}`);
    console.log(`  Functions   : ${stats.functions}`);
    console.log(`  Methods     : ${stats.methods}`);
    console.log(`  Imports     : ${stats.imports}`);
    console.log(`  External deps: ${stats.externalDependencies}`);
    console.log(`  Edges       : ${stats.edges}`);
    if (stats.importedNodes > 0 || stats.importedEdges > 0) {
      console.log(`  Imported    : ${stats.importedNodes} nodes, ${stats.importedEdges} edges`);
    }
    if (stats.enriched > 0) {
      console.log(`  Enriched    : ${chalk.green(`${stats.enriched} nodes`)} (Understand-Anything summaries)`);
    }
    for (const note of notes) console.log(`  ${chalk.yellow('⚠')} ${note}`);
    console.log(`\n  Saved to ${chalk.green(path.relative(process.cwd(), outPath))}`);
    console.log(`  Tip: ${chalk.dim('webpilot graph --summary')} shows what the model sees during codegen.\n`);
  });

/**
 * COMMAND: report
 */
program
  .command('report')
  .description('Aggregate execution results; optionally generate HTML report with AI analysis')
  .option('--html', 'Generate reports/html/index.html and per-test HTML reports')
  .option('--json', 'Print suite report JSON')
  .option('--no-ai', 'Skip LLM analysis section in HTML report')
  .option('--test <slug>', 'Limit HTML report to one test slug (e.g. automationexercise_add_to_cart)')
  .option('-e, --env <env>', 'Environment name for report header', 'qa')
  .option('--file <path>', 'Original test file path (metadata)')
  .action(async (options) => {
    if (options.json) {
      const report = collectSuiteReport({
        env: options.env,
        testSlugs: options.test ? [options.test] : undefined,
        suiteName: options.test ? `WebPilot — ${options.test}` : 'WebPilot Execution Suite',
      });
      const manifest = writeArtifactManifest();
      console.log(JSON.stringify({ report, artifactManifest: manifest.manifest }, null, 2));
      return;
    }
    if (options.html) {
      const result = await generateExecutionReports({
        env: options.env,
        skipAi: options.ai === false,
        testSlugs: options.test ? [options.test] : undefined,
        suiteName: options.test ? `WebPilot — ${options.test}` : 'WebPilot Execution Suite',
      });
      const manifest = writeArtifactManifest();
      console.log('OK', result.suiteHtmlPath);
      console.log('Manifest', manifest.path);
      return;
    }
    console.log(`\n${chalk.blue.bold('=== WebPilot Executive Quality Dashboard ===')}`);
    
    const reportsDir = path.join(process.cwd(), 'runtime', 'reports');
    if (!fs.existsSync(reportsDir)) {
      console.log(chalk.yellow('No execution report cards found inside runtime/reports yet.'));
      return;
    }

    const slugs = listSummarySlugs();
    if (slugs.length === 0) {
      console.log(chalk.yellow('No execution report cards found inside runtime/reports yet.'));
      return;
    }

    let passes = 0;
    let fails = 0;
    console.log(`\n${chalk.bold('Recent Executions:')}`);
    
    slugs.forEach((slug) => {
      try {
        const summary = JSON.parse(fs.readFileSync(resolveSummaryPath(slug), 'utf8'));
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
  .option('--proposals', 'List selector healing proposals')
  .option('--apply <proposal>', 'Apply a reviewed healing proposal JSON file')
  .option('--file <path>', 'Target generated test or page-object file for --apply')
  .description('Audit and manage selector correction maps and healing proposals')
  .action((options) => {
    const cachePath = path.join(process.cwd(), 'runtime', 'healing-cache', 'cache.json');
    if (options.clean) {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        console.log(chalk.green('Self-healing cache purged successfully.'));
      }
      return;
    }

    if (options.apply) {
      if (!options.file) {
        console.error(chalk.red('Missing --file <path>. Healing proposals are only applied to an explicit target file.'));
        process.exit(1);
      }
      const proposalPath = path.resolve(process.cwd(), options.apply);
      const targetPath = path.resolve(process.cwd(), options.file);
      if (!fs.existsSync(proposalPath)) {
        console.error(chalk.red(`Healing proposal not found: ${proposalPath}`));
        process.exit(1);
      }
      if (!fs.existsSync(targetPath)) {
        console.error(chalk.red(`Target file not found: ${targetPath}`));
        process.exit(1);
      }

      const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8')) as {
        oldSelector?: string;
        newSelector?: string;
        reasoning?: string;
      };
      if (!proposal.oldSelector || !proposal.newSelector) {
        console.error(chalk.red('Proposal must include oldSelector and newSelector.'));
        process.exit(1);
      }

      const source = fs.readFileSync(targetPath, 'utf8');
      if (!source.includes(proposal.oldSelector)) {
        console.error(chalk.red(`Target file does not contain old selector: ${proposal.oldSelector}`));
        process.exit(1);
      }

      fs.writeFileSync(targetPath, source.replace(proposal.oldSelector, proposal.newSelector), 'utf8');
      console.log(chalk.green('Applied healing proposal.'));
      console.log(`  ${chalk.red('Old:')} ${proposal.oldSelector}`);
      console.log(`  ${chalk.green('New:')} ${proposal.newSelector}`);
      if (proposal.reasoning) console.log(`  ${chalk.dim(proposal.reasoning)}`);
      return;
    }

    if (options.proposals) {
      if (!fs.existsSync(HEALING_PROPOSALS_DIR)) {
        console.log(chalk.yellow('No healing proposals found in runtime/selectors/healing-proposals.'));
        return;
      }
      const proposals = fs
        .readdirSync(HEALING_PROPOSALS_DIR)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .reverse();
      if (proposals.length === 0) {
        console.log(chalk.yellow('No healing proposals found in runtime/selectors/healing-proposals.'));
        return;
      }
      console.log(`\n${chalk.magenta('=== WebPilot Healing Proposals ===')}`);
      for (const file of proposals) {
        const proposalPath = path.join(HEALING_PROPOSALS_DIR, file);
        try {
          const proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
          console.log(`\n  ${chalk.bold(path.relative(process.cwd(), proposalPath))}`);
          console.log(`  ${chalk.red('Old:')} ${proposal.oldSelector}`);
          console.log(`  ${chalk.green('New:')} ${proposal.newSelector}`);
          console.log(`  Confidence: ${proposal.confidence}`);
        } catch {
          console.log(`\n  ${chalk.bold(path.relative(process.cwd(), proposalPath))}`);
        }
      }
      return;
    }

    if (!fs.existsSync(cachePath)) {
      console.log(chalk.yellow('No healed selectors cached in runtime/healing-cache/cache.json yet.'));
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

/**
 * COMMAND GROUP: requirements
 * Import and inspect normalized requirements (Feature 09).
 */
const requirements = program
  .command('requirements')
  .description('Import and inspect requirements for coverage analysis');

requirements
  .command('import [file]')
  .description('Import requirements from a JSON file (generic, ADO REST, or Jira REST shape)')
  .option('--file <file>', 'Path to the requirements JSON file (alternative to positional)')
  .option('--source <source>', 'Source system: ado | jira | import', 'import')
  .option('--project <project>', 'Scope: project name')
  .option('--team <team>', 'Scope: team name')
  .option('--sprint <sprint>', 'Scope: sprint/iteration')
  .option('--release <release>', 'Scope: release/version')
  .option('--epic <epic>', 'Scope: epic/feature')
  .option('--no-merge', 'Replace the stored requirement set instead of merging')
  .action((file: string | undefined, options: Record<string, string | boolean>) => {
    const { RequirementStore } = require('../core/requirements/RequirementStore');
    const sourceFile = file || (options.file as string | undefined);
    if (!sourceFile) {
      console.error(chalk.red('Provide a requirements file: webpilot requirements import <file.json> (or --file <path>).'));
      process.exitCode = 1;
      return;
    }
    try {
      const result = RequirementStore.importFromFile(sourceFile, {
        source: options.source as string,
        merge: options.merge !== false,
        scope: {
          source: options.source as string,
          project: options.project as string | undefined,
          team: options.team as string | undefined,
          sprint: options.sprint as string | undefined,
          release: options.release as string | undefined,
          epic: options.epic as string | undefined,
        },
      });
      console.log(`\n${chalk.magenta('=== WebPilot Requirements Import ===')}`);
      console.log(`  Added   : ${chalk.green(result.added)}`);
      console.log(`  Updated : ${chalk.cyan(result.updated)}`);
      console.log(`  Total   : ${chalk.bold(result.set.requirements.length)}`);
      const withoutAc = result.set.requirements.filter(
        (r: { acceptanceCriteria: unknown[] }) => r.acceptanceCriteria.length === 0
      ).length;
      if (withoutAc > 0) {
        console.log(
          chalk.yellow(`  Note    : ${withoutAc} requirement(s) have no acceptance criteria; title is used as a single criterion.`)
        );
      }
      console.log(`\n${chalk.dim('Next:')} webpilot coverage generate`);
    } catch (err) {
      console.error(chalk.red(`Import failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  });

requirements
  .command('list')
  .description('List imported requirements and their acceptance-criteria counts')
  .action(() => {
    const { RequirementStore } = require('../core/requirements/RequirementStore');
    const set = RequirementStore.load();
    if (!set || set.requirements.length === 0) {
      console.log(chalk.yellow('No requirements imported yet. Run: webpilot requirements import <file.json>'));
      return;
    }
    console.log(`\n${chalk.magenta('=== WebPilot Requirements ===')} (${set.requirements.length})\n`);
    for (const req of set.requirements) {
      const pr = req.priority ? chalk.dim(`[${req.priority}]`) : '';
      console.log(`  ${chalk.bold(req.id)} ${pr} ${req.title}`);
      console.log(`    ${chalk.dim(`${req.acceptanceCriteria.length} acceptance criteria · ${req.source}`)}`);
    }
  });

requirements
  .command('sync [source]')
  .description('Guided sync from official ADO/Jira MCP servers')
  .option('--source <source>', 'Source system: ado | jira')
  .option('--project <project>', 'Scope: project name/key')
  .option('--team <team>', 'Scope: ADO team/area path')
  .option('--sprint <sprint>', 'Scope: sprint/iteration')
  .option('--release <release>', 'Scope: release/fixVersion')
  .option('--epic <epic>', 'Scope: ADO parent id or Jira epic key')
  .option('--backlog', 'Include backlog/open requirements for the project')
  .option('--dry-run', 'Build and print the WIQL/JQL query without calling MCP')
  .option('--no-merge', 'Replace the stored requirement set instead of merging')
  .action(async (sourceArg: string | undefined, options: Record<string, string | boolean>) => {
    const { RequirementSyncService } = require('../core/requirements/RequirementSyncService');
    const selectedSource = String(options.source || sourceArg || '').toLowerCase();
    const source =
      selectedSource === 'ado' || selectedSource === 'jira'
        ? selectedSource
        : (
            await inquirer.prompt([
              {
                type: 'list',
                name: 'source',
                message: 'Where should WebPilot sync requirements from?',
                choices: [
                  { name: 'Azure DevOps (official ADO MCP)', value: 'ado' },
                  { name: 'Jira (official Atlassian/Jira MCP)', value: 'jira' },
                ],
              },
            ])
          ).source;

    const hasScope =
      options.project || options.team || options.sprint || options.release || options.epic || options.backlog;
    let scope: {
      project?: string;
      team?: string;
      sprint?: string;
      release?: string;
      epic?: string;
      backlog?: boolean;
    } = {
      project: options.project as string | undefined,
      team: options.team as string | undefined,
      sprint: options.sprint as string | undefined,
      release: options.release as string | undefined,
      epic: options.epic as string | undefined,
      backlog: Boolean(options.backlog),
    };

    if (!hasScope) {
      const answers = (await inquirer.prompt([
        {
          type: 'input',
          name: 'project',
          message: source === 'ado' ? 'ADO project name (optional):' : 'Jira project key/name (optional):',
        },
        {
          type: 'list',
          name: 'scopeKind',
          message: 'Which requirement scope should WebPilot pull?',
          choices: [
            { name: 'Project backlog / open requirements', value: 'backlog' },
            { name: 'Team / area path', value: 'team' },
            { name: 'Sprint / iteration', value: 'sprint' },
            { name: 'Release / fixVersion', value: 'release' },
            { name: 'Epic / feature', value: 'epic' },
          ],
        },
        {
          type: 'input',
          name: 'scopeValue',
          message: 'Scope value (leave blank for project backlog):',
          when: (answers: { scopeKind: string }) => answers.scopeKind !== 'backlog',
        },
      ])) as { project?: string; scopeKind: string; scopeValue?: string };
      scope = {
        project: answers.project || undefined,
        backlog: answers.scopeKind === 'backlog',
        team: answers.scopeKind === 'team' ? answers.scopeValue || undefined : undefined,
        sprint: answers.scopeKind === 'sprint' ? answers.scopeValue || undefined : undefined,
        release: answers.scopeKind === 'release' ? answers.scopeValue || undefined : undefined,
        epic: answers.scopeKind === 'epic' ? answers.scopeValue || undefined : undefined,
      };
    }

    console.log(`\n${chalk.magenta('=== WebPilot Requirements Sync ===')}`);
    console.log(`  Source : ${chalk.cyan(source.toUpperCase())}`);
    console.log(`  Scope  : ${chalk.dim(JSON.stringify(scope))}`);

    try {
      const result = await RequirementSyncService.sync({
        source,
        scope,
        merge: options.merge !== false,
        dryRun: Boolean(options.dryRun),
      });
      if (result.dryRun) {
        console.log(`\n${chalk.bold('Generated query:')}\n${result.query}\n`);
        console.log(chalk.dim('Configure requirements.mcp in webpilot.yaml, then run without --dry-run to sync.'));
        return;
      }
      console.log(`  Tool   : ${chalk.cyan(result.toolName || 'auto')}`);
      console.log(`  Pulled : ${chalk.bold(result.imported)}`);
      console.log(`  Added  : ${chalk.green(result.added)}`);
      console.log(`  Updated: ${chalk.cyan(result.updated)}`);
      console.log(`  Total  : ${chalk.bold(result.total)}`);
      console.log(`\n${chalk.dim('Next:')} webpilot coverage generate`);
    } catch (err) {
      console.error(chalk.red(`Requirements sync failed: ${err instanceof Error ? err.message : String(err)}`));
      console.error(chalk.dim('Tip: run `webpilot requirements sync --source ado --project <name> --dry-run` to validate scope/query without calling MCP.'));
      process.exitCode = 1;
    }
  });

/**
 * COMMAND GROUP: coverage
 * AI-assisted, criterion-level coverage with reconciliation of existing maps.
 */
const coverage = program
  .command('coverage')
  .description('Generate and inspect requirement coverage');

function printCoverageSummary(report: {
  summary: { requirements: number; covered: number; partial: number; uncovered: number; coveragePct: number; highRisk: number };
}): void {
  const s = report.summary;
  console.log(`  Requirements : ${chalk.bold(s.requirements)}`);
  console.log(`  Covered      : ${chalk.green(s.covered)}`);
  console.log(`  Partial      : ${chalk.yellow(s.partial)}`);
  console.log(`  Uncovered    : ${chalk.red(s.uncovered)}`);
  console.log(`  Coverage     : ${chalk.bold(`${s.coveragePct}%`)}`);
  console.log(`  High risk    : ${s.highRisk > 0 ? chalk.red(s.highRisk) : chalk.green(0)}`);
}

function statusColor(status: string): string {
  if (status === 'covered') return chalk.green(status);
  if (status === 'partial') return chalk.yellow(status);
  return chalk.red(status);
}

coverage
  .command('generate', { isDefault: true })
  .description('Reconcile mappings, compute coverage, and propose new mappings')
  .option('--no-proposals', 'Do not write proposed mappings into requirement-map.yaml')
  .option('--json', 'Print the full coverage report as JSON')
  .action((options: { proposals?: boolean; json?: boolean }) => {
    const { CoverageService } = require('../core/requirements/CoverageService');
    const { RequirementMap } = require('../core/requirements/RequirementMap');
    try {
      const result = CoverageService.generate({ writeProposals: options.proposals !== false });
      if (options.json) {
        console.log(JSON.stringify(result.coverage, null, 2));
        return;
      }
      console.log(`\n${chalk.magenta('=== WebPilot Coverage ===')}\n`);
      printCoverageSummary(result.coverage);
      const r = result.reconcile.summary;
      console.log(`\n${chalk.magenta('Reconciliation of existing mappings:')}`);
      console.log(
        `  valid ${chalk.green(r.valid)} · stale ${chalk.yellow(r.stale)} · broken ${chalk.red(r.broken)} · ` +
          `orphan ${chalk.red(r.orphan)} · conflict ${chalk.red(r.conflict)} · low-quality ${chalk.yellow(r['low-quality'])}`
      );
      if (result.proposalsWritten > 0) {
        console.log(
          `\n${chalk.cyan(`${result.proposalsWritten} mapping proposal(s)`)} written to ${RequirementMap.path()}.`
        );
        console.log(`${chalk.dim('Confirm them:')} webpilot coverage apply-mapping --all`);
      }
      console.log(`\n${chalk.dim('Inspect gaps:')} webpilot coverage show --gaps`);
    } catch (err) {
      console.error(chalk.red(`Coverage failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  });

coverage
  .command('show')
  .description('Show the most recently generated coverage report')
  .option('--gaps', 'Show only requirements that are not fully covered')
  .option('--json', 'Print the report as JSON')
  .action((options: { gaps?: boolean; json?: boolean }) => {
    const { CoverageService } = require('../core/requirements/CoverageService');
    const report = CoverageService.loadCoverage();
    if (!report) {
      console.log(chalk.yellow('No coverage report found. Run: webpilot coverage generate'));
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`\n${chalk.magenta('=== WebPilot Coverage ===')}\n`);
    printCoverageSummary(report);
    console.log('');
    const rows = options.gaps
      ? report.requirements.filter((r: { status: string }) => r.status !== 'covered')
      : report.requirements;
    for (const req of rows) {
      console.log(
        `  ${chalk.bold(req.requirementId)} ${req.priority ? chalk.dim(`[${req.priority}]`) : ''} ` +
          `${statusColor(req.status)} ${chalk.dim(`(${Math.round(req.confidence * 100)}%)`)} ${req.title}`
      );
      if (options.gaps) {
        for (const gap of req.gaps) console.log(`      ${chalk.red('gap:')} ${gap}`);
      }
    }
  });

coverage
  .command('reconcile')
  .description('Validate existing tags/mappings against current requirements and tests')
  .option('--json', 'Print findings as JSON')
  .action((options: { json?: boolean }) => {
    const { RequirementStore } = require('../core/requirements/RequirementStore');
    const { TestInventory } = require('../core/requirements/TestInventory');
    const { RequirementMap } = require('../core/requirements/RequirementMap');
    const { CoverageMatcher } = require('../core/requirements/CoverageMatcher');
    const set = RequirementStore.load();
    if (!set) {
      console.log(chalk.yellow('No requirements imported yet. Run: webpilot requirements import <file.json>'));
      return;
    }
    const report = CoverageMatcher.reconcile(set, TestInventory.collect(), RequirementMap.load());
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`\n${chalk.magenta('=== WebPilot Mapping Reconciliation ===')}\n`);
    const s = report.summary;
    console.log(
      `  valid ${chalk.green(s.valid)} · stale ${chalk.yellow(s.stale)} · broken ${chalk.red(s.broken)} · ` +
        `orphan ${chalk.red(s.orphan)} · conflict ${chalk.red(s.conflict)} · low-quality ${chalk.yellow(s['low-quality'])}\n`
    );
    for (const f of report.findings) {
      if (f.status === 'valid') continue;
      console.log(`  ${chalk.bold(f.status.toUpperCase())} ${f.requirementId} → ${f.testPath}`);
      console.log(`    ${chalk.dim(f.detail)}`);
      if (f.suggestion) console.log(`    ${chalk.cyan('fix:')} ${f.suggestion}`);
    }
    if (report.findings.every((f: { status: string }) => f.status === 'valid')) {
      console.log(chalk.green('  All existing mappings are valid.'));
    }
  });

coverage
  .command('apply-mapping')
  .description('Promote proposed mappings to confirmed')
  .option('--requirement <id>', 'Only confirm mappings for this requirement id')
  .option('--all', 'Confirm all proposed mappings')
  .action((options: { requirement?: string; all?: boolean }) => {
    if (!options.all && !options.requirement) {
      console.error(chalk.red('Specify --all or --requirement <id>.'));
      process.exitCode = 1;
      return;
    }
    const { CoverageService } = require('../core/requirements/CoverageService');
    const confirmed = CoverageService.confirmMappings(options.requirement);
    if (confirmed === 0) {
      console.log(chalk.yellow('No proposed mappings to confirm.'));
      return;
    }
    console.log(chalk.green(`Confirmed ${confirmed} mapping(s).`));
    console.log(`${chalk.dim('Re-run coverage to reflect confirmations:')} webpilot coverage generate`);
  });

/**
 * COMMAND GROUP: regression
 * Recommend a regression pack from coverage + flake signals.
 */
const regression = program
  .command('regression')
  .description('Recommend and manage regression packs');

regression
  .command('recommend', { isDefault: true })
  .description('Build a regression pack from coverage, priority, and flake signals')
  .option('--name <name>', 'Pack name', 'default')
  .option('--no-partial', 'Exclude partially covered requirements')
  .option('--json', 'Print the pack as JSON')
  .action((options: { name?: string; partial?: boolean; json?: boolean }) => {
    const { CoverageService } = require('../core/requirements/CoverageService');
    const { TestInventory } = require('../core/requirements/TestInventory');
    const { RegressionPackManager } = require('../core/regression/RegressionPackManager');
    const report = CoverageService.loadCoverage();
    if (!report) {
      console.log(chalk.yellow('No coverage report found. Run: webpilot coverage generate'));
      return;
    }
    const pack = RegressionPackManager.recommend(report, TestInventory.collect(), {
      name: options.name,
      includePartial: options.partial !== false,
    });
    RegressionPackManager.save(pack);
    if (options.json) {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }
    console.log(`\n${chalk.magenta('=== WebPilot Regression Pack ===')} ${chalk.dim(`(${pack.name})`)}\n`);
    console.log(`  Tests        : ${chalk.bold(pack.summary.tests)}`);
    console.log(`  High priority: ${chalk.cyan(pack.summary.highPriority)}`);
    console.log(`  Quarantined  : ${pack.summary.quarantined > 0 ? chalk.yellow(pack.summary.quarantined) : 0}\n`);
    for (const t of pack.tests) {
      console.log(
        `  ${chalk.bold(t.weight.toFixed(2))} ${t.path} ${chalk.dim(`(${t.reason})`)}` +
          (t.flakeScore > 0 ? chalk.yellow(` flake ${t.flakeScore}`) : '')
      );
    }
    if (pack.quarantine.length > 0) {
      console.log(`\n${chalk.yellow('Quarantined (stabilize before including):')}`);
      for (const q of pack.quarantine) {
        console.log(`  ${q.path} ${chalk.dim(`flake ${q.flakeScore}`)}`);
      }
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
