import { APIResponse } from '@playwright/test';
import { BaseAPI } from '@core/BaseAPI';

/**
 * Generated API client — API Authenticated Token Chaining
 * @generated WebPilot
 */
export class ApiAuthenticatedTokenChainingApi {
  constructor(private readonly client: BaseAPI) {}

  async postApibaseurlauthlogin(body: unknown): Promise<APIResponse> {
    const response = await this.client.post('/auth/login', body);
    return response;
  }

  async getApibaseurlauthme(): Promise<APIResponse> {
    const response = await this.client.get('/auth/me');
    await this.client.assertStatus(response, 200);
    return response;
  }
}
