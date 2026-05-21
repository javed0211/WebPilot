import { test } from '@playwright/test';
import chalk from 'chalk';

export class Logger {
  /**
   * Log info message to console and Playwright annotations
   */
  public static info(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.blue.bold('[INFO]')} ${chalk.gray(timestamp)} ${message}`);
    try {
      test.info().annotations.push({ type: 'info', description: message });
    } catch {
      // Ignore if outside Playwright runner context (e.g. CLI tool / unit tests)
    }
  }

  /**
   * Log success message
   */
  public static success(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.green.bold('[PASS]')} ${chalk.gray(timestamp)} ${chalk.green(message)}`);
    try {
      test.info().annotations.push({ type: 'pass', description: message });
    } catch {}
  }

  /**
   * Log warning message
   */
  public static warn(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${chalk.yellow.bold('[WARN]')} ${chalk.gray(timestamp)} ${chalk.yellow(message)}`);
    try {
      test.info().annotations.push({ type: 'warning', description: message });
    } catch {}
  }

  /**
   * Log error message
   */
  public static error(message: string, error?: Error): void {
    const timestamp = new Date().toLocaleTimeString();
    console.error(`${chalk.red.bold('[FAIL]')} ${chalk.gray(timestamp)} ${chalk.red.bold(message)}`);
    if (error?.stack) {
      console.error(chalk.red(error.stack));
    }
    try {
      test.info().annotations.push({ type: 'error', description: `${message} ${error?.message || ''}` });
    } catch {}
  }

  /**
   * Wraps an execution block with a Playwright report step and formats it in the terminal
   */
  public static async step<T>(name: string, action: () => Promise<T>): Promise<T> {
    console.log(`\n${chalk.cyan.bold('[STEP]')} ${chalk.white.bold(name)}`);
    console.log(chalk.cyan('─'.repeat(50)));

    try {
      // Run as standard playwright step if runner is active
      return await test.step(name, action);
    } catch {
      // Fallback if not inside Playwright test execution
      return await action();
    }
  }
}
