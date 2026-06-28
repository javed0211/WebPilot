import chalk from 'chalk';

const indent = chalk.dim('  ');

/**
 * Minimal terminal logger for WebPilot CLI and engine output.
 */
export class Logger {
  public static info(message: string): void {
    console.log(`${indent}${chalk.cyan('○')} ${message}`);
  }

  public static success(message: string): void {
    console.log(`${indent}${chalk.green('✓')} ${chalk.green(message)}`);
  }

  public static warn(message: string): void {
    console.log(`${indent}${chalk.yellow('!')} ${chalk.yellow(message)}`);
  }

  public static error(message: string, err?: Error): void {
    console.error(`${indent}${chalk.red('✗')} ${chalk.red.bold(message)}`);
    if (err?.stack) {
      console.error(chalk.red.dim(err.stack.split('\n').map((l) => `     ${l}`).join('\n')));
    }
  }

  public static detail(message: string): void {
    console.log(`${indent}${chalk.dim('·')} ${chalk.dim(message)}`);
  }

  public static ai(message: string): void {
    console.log(`${indent}${chalk.magenta('◆')} ${message}`);
  }

  public static step(stepNum: number, total: number, message: string): void {
    console.log('');
    console.log(`${indent}${chalk.bold.white(`Step ${stepNum}/${total}`)} ${chalk.dim('—')} ${message}`);
  }
}
