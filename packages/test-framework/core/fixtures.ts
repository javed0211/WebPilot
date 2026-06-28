import { test as base, expect } from '@playwright/test';
import { config } from '@config/ConfigManager';
import { BaseAPI } from '@core/BaseAPI';

// Define the custom fixtures type
export type WebPilotFixtures = {
  apiClient: BaseAPI;
};

// Extend standard playwright test to inject custom fixtures
export const test = base.extend<WebPilotFixtures>({
  apiClient: async ({ playwright }, use) => {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // If an authorization token is present in the environment/config, automatically inject it
    if (process.env.AUTH_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.AUTH_TOKEN}`;
    }

    const requestContext = await playwright.request.newContext({
      baseURL: config.apiBaseUrl || undefined,
      extraHTTPHeaders: headers
    });

    const client = new BaseAPI(requestContext);
    await use(client);
    
    // Clean up request context after execution
    await requestContext.dispose();
  }
});

export { expect };
