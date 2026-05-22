import { APIResponse } from '@playwright/test';
import { BaseAPI } from '@core/BaseAPI';

/**
 * Generated API client — Petstore single GET
 * @generated WebPilot
 */
export class PetstoreSingleGetApi {
  constructor(private readonly client: BaseAPI) {}

  async getApibaseurlpetfindbystatusstatusavaila(): Promise<APIResponse> {
    const response = await this.client.get('{{apiBaseUrl}}/pet/findByStatus?status=available');
    await this.client.assertStatus(response, 200);
    return response;
  }
}
