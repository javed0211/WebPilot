import chalk from 'chalk';
import { PhaseUsage, UsageSnapshot } from './UsageTracker';

const BOX_WIDTH = 52;

function boxLine(content: string): string {
  const inner = content.length > BOX_WIDTH - 4 ? content.slice(0, BOX_WIDTH - 7) + '...' : content;
  const pad = ' '.repeat(Math.max(0, BOX_WIDTH - 4 - inner.length));
  return chalk.cyan(`│ `) + chalk.white(inner) + pad + chalk.cyan(` │`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(usd: number, totalTokens = 0): string {
  if (usd === 0 && totalTokens > 0) {
    return chalk.yellow('$0.00 (tokens recorded, cost unpriced)');
  }
  if (usd === 0) return chalk.dim('$0.00 (local / no billing)');
  if (usd < 0.01) return chalk.green(`~$${usd.toFixed(4)} USD`);
  return chalk.green(`~$${usd.toFixed(2)} USD`);
}

export interface BannerOptions {
  test: string;
  env: string;
  mode?: string;
  architecture?: string;
}

export interface JobSummaryOptions {
  test: string;
  success: boolean;
  durationMs: number;
  usage: UsageSnapshot;
  stepsExecuted?: number;
  extra?: string;
}

export class CliDisplay {
  public static printBanner(opts: BannerOptions): void {
    const top = chalk.cyan('┌' + '─'.repeat(BOX_WIDTH - 2) + '┐');
    const bottom = chalk.cyan('└' + '─'.repeat(BOX_WIDTH - 2) + '┘');

    console.log('');
    console.log(top);
    console.log(boxLine(''));
    console.log(
      chalk.cyan('│ ') +
        chalk.bold.magenta('WebPilot') +
        chalk.dim(' · ') +
        chalk.white('AI-Native QE') +
        ' '.repeat(Math.max(0, BOX_WIDTH - 4 - 28)) +
        chalk.cyan(' │')
    );
    console.log(boxLine(''));
    console.log(bottom);
    console.log('');

    const rows: [string, string][] = [
      ['Test', opts.test],
      ['Env', opts.env]
    ];
    if (opts.mode) rows.push(['Mode', opts.mode]);
    if (opts.architecture) rows.push(['Arch', opts.architecture]);

    for (const [label, value] of rows) {
      console.log(`  ${chalk.dim(label.padEnd(6))} ${chalk.white(value)}`);
    }
    console.log(chalk.dim('  ' + '─'.repeat(46)));
    console.log('');
  }

  public static printJobSummary(opts: JobSummaryOptions): void {
    const { usage } = opts;
    const statusLabel = opts.success ? chalk.green.bold('PASSED') : chalk.red.bold('FAILED');
    const top = chalk.cyan('┌' + '─'.repeat(BOX_WIDTH - 2) + '┐');
    const bottom = chalk.cyan('└' + '─'.repeat(BOX_WIDTH - 2) + '┘');

    console.log('');
    console.log(top);
    console.log(
      chalk.cyan('│ ') +
        chalk.bold.white('Job summary') +
        ' '.repeat(Math.max(0, BOX_WIDTH - 4 - 13)) +
        chalk.cyan(' │')
    );
    console.log(bottom);
    console.log('');

    console.log(`  ${chalk.dim('Test'.padEnd(10))} ${chalk.white(opts.test)}`);
    console.log(`  ${chalk.dim('Status'.padEnd(10))} ${statusLabel}`);
    console.log(`  ${chalk.dim('Duration'.padEnd(10))} ${formatDuration(opts.durationMs)}`);
    if (opts.stepsExecuted !== undefined) {
      console.log(`  ${chalk.dim('Steps'.padEnd(10))} ${opts.stepsExecuted}`);
    }
    if (opts.extra) {
      console.log(`  ${chalk.dim('Note'.padEnd(10))} ${chalk.dim(opts.extra)}`);
    }

    console.log('');
    console.log(chalk.dim('  LLM usage'));
    console.log(`  ${chalk.dim('Calls'.padEnd(10))} ${usage.llmCalls}`);
    console.log(
      `  ${chalk.dim('Tokens'.padEnd(10))} ${formatTokens(usage.totalTokens)}` +
        chalk.dim(`  (in ${formatTokens(usage.promptTokens)} · out ${formatTokens(usage.completionTokens)})`)
    );
    console.log(
      `  ${chalk.dim('Est. cost'.padEnd(10))} ${formatCost(usage.estimatedCostUsd, usage.totalTokens)}`
    );

    const phaseRows: Array<[string, PhaseUsage]> = Object.entries(usage.phases).filter(
      ([, phase]) => phase.promptTokens + phase.completionTokens > 0
    ) as Array<[string, PhaseUsage]>;
    if (phaseRows.length > 1) {
      console.log('');
      console.log(chalk.dim('  By phase'));
      for (const [phase, data] of phaseRows) {
        const phaseTotal = data.promptTokens + data.completionTokens;
        console.log(
          `  ${chalk.dim(phase.padEnd(10))} ${formatTokens(phaseTotal)}` +
            chalk.dim(`  (${data.llmCalls} call${data.llmCalls === 1 ? '' : 's'})`)
        );
      }
    }
    console.log('');
  }
}
