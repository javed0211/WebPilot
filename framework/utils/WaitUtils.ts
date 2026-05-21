import { Page } from '@playwright/test';

export class WaitUtils {
  /**
   * Pause execution for a set number of milliseconds
   */
  public static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Poll a custom condition function until it returns true or times out
   */
  public static async waitForCondition(
    condition: () => Promise<boolean> | boolean,
    timeout = 10000,
    pollInterval = 500
  ): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return true;
      }
      await this.sleep(pollInterval);
    }
    throw new Error(`Condition was not met within the timeout of ${timeout}ms.`);
  }

  /**
   * Wait for network idle state (no active network requests for at least 500ms)
   */
  public static async waitForNetworkIdle(page: Page, timeout = 10000): Promise<void> {
    console.log(`[WaitUtils] Waiting for network idle...`);
    await page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait until the number of elements matching the selector equals the target count
   */
  public static async waitForElementCount(
    page: Page,
    selector: string,
    expectedCount: number,
    timeout = 10000
  ): Promise<void> {
    console.log(`[WaitUtils] Waiting for element count of "${selector}" to be ${expectedCount}`);
    await this.waitForCondition(async () => {
      const count = await page.locator(selector).count();
      return count === expectedCount;
    }, timeout);
  }
}
