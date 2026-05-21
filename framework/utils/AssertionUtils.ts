import { Page, expect } from '@playwright/test';
import { Logger } from '@utils/Logger';

export class AssertionUtils {
  /**
   * Assert a boolean condition is true
   */
  public static assertTrue(value: boolean, message: string): void {
    Logger.info(`Asserting: ${message}`);
    try {
      expect(value).toBe(true);
      Logger.success(`Assertion Passed: ${message}`);
    } catch (err: any) {
      Logger.error(`Assertion Failed: ${message}`, err);
      throw err;
    }
  }

  /**
   * Assert two values are equal
   */
  public static assertEquals<T>(actual: T, expected: T, message: string): void {
    Logger.info(`Asserting equality: ${message} (Expected: ${expected}, Got: ${actual})`);
    try {
      expect(actual as any).toEqual(expected);
      Logger.success(`Assertion Passed: ${message}`);
    } catch (err: any) {
      Logger.error(`Assertion Failed: ${message}`, err);
      throw err;
    }
  }

  /**
   * Assert an element is visible in the viewport
   */
  public static async assertElementVisible(page: Page, selector: string, message: string): Promise<void> {
    Logger.info(`Asserting element visibility: ${message} ("${selector}")`);
    try {
      const locator = page.locator(selector);
      await expect(locator).toBeVisible();
      Logger.success(`Assertion Passed: ${message}`);
    } catch (err: any) {
      Logger.error(`Assertion Failed: ${message}`, err);
      throw err;
    }
  }

  /**
   * Assert element contains specific text
   */
  public static async assertElementText(page: Page, selector: string, expectedText: string, message: string): Promise<void> {
    Logger.info(`Asserting element contains text: ${message} ("${selector}" -> "${expectedText}")`);
    try {
      const locator = page.locator(selector);
      await expect(locator).toContainText(expectedText);
      Logger.success(`Assertion Passed: ${message}`);
    } catch (err: any) {
      Logger.error(`Assertion Failed: ${message}`, err);
      throw err;
    }
  }
}
