import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';
import { Engine } from '../core/Engine';
import { ApiEngine } from '../core/ApiEngine';
import { OpenApiLoader } from '../core/api/OpenApiLoader';
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
      const packageRoot = path.resolve(__dirname, '..');
      const sourceFramework = path.join(packageRoot, 'framework');
      const destinationFramework = path.join(process.cwd(), 'framework');
      const copyPythonFramework = (source: string, destination: string) => {
        fs.mkdirSync(destination, { recursive: true });
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
          if (entry.name === '__pycache__') continue;
          const sourcePath = path.join(source, entry.name);
          const destinationPath = path.join(destination, entry.name);
          if (entry.isDirectory()) {
            copyPythonFramework(sourcePath, destinationPath);
          } else if (
            entry.name.endsWith('.py') ||
            entry.name.endsWith('.json')
          ) {
            if (!fs.existsSync(destinationPath)) {
              fs.copyFileSync(sourcePath, destinationPath);
            }
          }
        }
      };
      copyPythonFramework(sourceFramework, destinationFramework);
      const pytestSource = path.join(packageRoot, 'pytest.ini');
      const pytestDestination = path.join(process.cwd(), 'pytest.ini');
      if (fs.existsSync(pytestSource) && !fs.existsSync(pytestDestination)) {
        fs.copyFileSync(pytestSource, pytestDestination);
      }

      const dirs = [
        'config/environments',
        'tests/web',
        'tests/api',
        'framework/apis',
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

    console.log(`\n${chalk.blue('Checking Python (browser-use):')}`);
    try {
      const { resolvePythonPath, hasBrowserUse } = require('../core/pythonEnv');
      const py = resolvePythonPath();
      if (!hasBrowserUse(py)) {
        console.log(`  ${chalk.yellow('⚠')} browser_use not found for ${py}`);
        console.log(`  ${chalk.dim('→')} Run: ${chalk.bold('npm run setup')}`);
      } else {
        console.log(`  ${chalk.green('✔')} browser_use importable (${py})`);
      }
    } catch (e: any) {
      console.log(`  ${chalk.red('✘')} Python check failed: ${e.message}`);
    }

    console.log(`\n${chalk.blue('Checking LLM config (browser-use / codegen):')}`);
    try {
      const { execSync } = require('child_process');
      const py = require('../core/pythonEnv').resolvePythonPath();
      execSync(
        `"${py}" -c "from llm_config import get_active_provider, resolve_provider_config, validate_provider_config; p,c=resolve_provider_config(); validate_provider_config(p,c); print(f'OK provider={p} endpoint configured')"` ,
        { cwd: path.join(process.cwd(), 'core'), stdio: 'pipe', encoding: 'utf8' }
      );
      console.log(`  ${chalk.green('✔')} LLM credentials resolved for browser-use`);
    } catch (e: any) {
      const msg = (e.stdout || e.stderr || e.message || '').toString();
      console.log(`  ${chalk.red('✘')} LLM not ready for browser-use`);
      console.log(`  ${chalk.dim(msg.split('\\n').slice(0, 6).join('\\n'))}`);
      console.log(`  ${chalk.dim('→')} Copy .env.example to .env and set AZURE_OPENAI_* (or switch framework.activeProvider)`);
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

Send POST request to {{apiBaseUrl}}/auth/login
With body payload {"username": "emilys", "password": "emilyspass"}
Extract response body.accessToken into token
Send GET request to {{apiBaseUrl}}/auth/me
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
              else if (/\.(txt|ya?ml|json)$/i.test(fp)) files.push(fp);
            }
          };
          readdir(p);
        } else if (/\.(txt|ya?ml|json|py)$/i.test(p)) {
          files.push(p);
        }
      }
    }
    
    files = [...new Set(files)];
    if (files.length === 0) {
      console.log(chalk.red('No test scripts found (.txt, .yaml, .json).'));
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
      let nlFile = file;
      let testName = '';
      
      if (file.endsWith('.py')) {
        testName = path.basename(file, '.py').replace(/^test_/, '');
        const possibleTxtWeb = path.join(process.cwd(), 'tests', 'web', `${testName}.txt`);
        const possibleTxtApi = path.join(process.cwd(), 'tests', 'api', `${testName}.txt`);
        if (fs.existsSync(possibleTxtWeb)) {
          nlFile = possibleTxtWeb;
        } else if (fs.existsSync(possibleTxtApi)) {
          nlFile = possibleTxtApi;
        } else {
           Logger.error(`Could not find natural language file for ${file}`);
           fails++;
           return;
        }
      } else {
        testName = path.basename(file, path.extname(file));
      }

      const isApi =
        nlFile.includes('/api/') ||
        /\.(ya?ml|json)$/i.test(nlFile);
      const isUI = !isApi && nlFile.endsWith('.txt');
      let success = false;
      let stepsExecuted: number | undefined;
      const testStart = Date.now();
      
      const pythonTestName = testName
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
      const expectedSpecPath = path.join(
        process.cwd(),
        'framework',
        'tests',
        `test_${pythonTestName}.py`
      );
      let playPassed = false;
      let fallbackReason = '';
      
      if (fs.existsSync(expectedSpecPath)) {
        Logger.info(`[Playwright Python] Running existing test: ${expectedSpecPath}`);
        try {
          const { execFileSync } = require('child_process');
          const python = fs.existsSync(path.join(process.cwd(), '.venv', 'bin', 'python'))
            ? path.join(process.cwd(), '.venv', 'bin', 'python')
            : process.env.WEBPILOT_PYTHON || 'python3';
          const output = execFileSync(python, ['-m', 'pytest', expectedSpecPath, '-q'], {
            stdio: 'pipe',
            cwd: process.cwd(),
          });
          console.log(output.toString());
          playPassed = true;
          Logger.success(`[Playwright Python] Test ${testName} passed successfully.`);
        } catch (e: any) {
          fallbackReason = (e.stdout?.toString() || '') + '\n' + (e.stderr?.toString() || '');
          console.log(fallbackReason);
          Logger.warn(`[Playwright Python] Test ${testName} failed. Falling back to AI healing...`);
          playPassed = false;
        }
      }
      
      if (playPassed) {
        passes++;
        CliDisplay.printJobSummary({
          test: testName,
          success: true,
          durationMs: Date.now() - testStart,
          usage: UsageTracker.getSnapshot(),
          stepsExecuted: 0
        });
        return;
      }
      
      try {
        if (isUI) {
          if (!playPassed && fs.existsSync(expectedSpecPath)) {
            UsageTracker.setPhase('healing');
          } else {
            UsageTracker.setPhase('design');
          }
          const engine = new Engine({
            testFilePath: nlFile,
            env: options.env,
            headed: options.headed,
            interactive: false,
            architecture: options.architecture as any,
            fallbackReason
          });
          const result = await engine.execute();
          success = result.success;
          stepsExecuted = result.stepsExecuted;
        } else {
          const apiEngine = new ApiEngine({
            testFilePath: nlFile,
            env: options.env
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
 * COMMAND: analyze
 */
program
  .command('analyze')
  .description('Generate a consolidated Markdown analysis report for all executions')
  .action(() => {
    const { execSync } = require('child_process');
    execSync('npx ts-node core/execution_report/generateMarkdownReport.ts', { stdio: 'inherit', cwd: process.cwd() });
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
