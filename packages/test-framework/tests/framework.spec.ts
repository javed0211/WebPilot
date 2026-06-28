import { test, expect } from '@core/fixtures';
import { config } from '@config/ConfigManager';
import { DataLoader } from '@data/DataLoader';
import { Logger } from '@utils/Logger';
import { WaitUtils } from '@utils/WaitUtils';
import { AssertionUtils } from '@utils/AssertionUtils';

test.describe('WebPilot Framework Integrity Tests', () => {
  
  test('should load environment configuration correctly', async () => {
    await Logger.step('Verify configuration properties', async () => {
      Logger.info(`Loaded Environment: ${config.environment}`);
      Logger.info(`Loaded Base URL: ${config.baseUrl}`);
      Logger.info(`Loaded API Base URL: ${config.apiBaseUrl}`);
      
      expect(config.environment).toBeDefined();
      expect(config.baseUrl).toContain('http');
      expect(config.variables.timeout).toBe(30000);
    });
  });

  test('should load test data using DataLoader', async () => {
    await Logger.step('Load JSON test data', async () => {
      const users = DataLoader.loadJson<{ id: number; role: string; name: string }[]>('test-users.json');
      Logger.info(`Successfully loaded ${users.length} users.`);
      
      expect(users).toHaveLength(2);
      expect(users[0].role).toBe('admin');
      expect(users[1].name).toBe('Regular User');
    });
  });

  test('should execute WaitUtils sleep and polling', async () => {
    await Logger.step('Test sleep utility', async () => {
      const start = Date.now();
      await WaitUtils.sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95);
    });

    await Logger.step('Test custom polling', async () => {
      let counter = 0;
      const success = await WaitUtils.waitForCondition(async () => {
        counter++;
        return counter >= 3;
      }, 5000, 50);
      
      expect(success).toBe(true);
      expect(counter).toBe(3);
    });
  });

  test('should perform assertions using AssertionUtils', async () => {
    await Logger.step('Verify custom assertion helpers', async () => {
      AssertionUtils.assertTrue(true, 'Verify truthiness helper');
      AssertionUtils.assertEquals(100, 100, 'Verify equality helper');
    });
  });

  test('should initialize apiClient fixture with custom config', async ({ apiClient }) => {
    await Logger.step('Verify apiClient instantiation and injection', async () => {
      expect(apiClient).toBeDefined();
      Logger.success('apiClient fixture successfully validated!');
    });
  });
});
