import { test } from '@core/fixtures';
import { PetstoreSingleGetApi } from '../../apis/PetstoreSingleGetApi';

test.describe('API: Petstore single GET', () => {
  test('Petstore single GET', async ({ apiClient }) => {
    const api = new PetstoreSingleGetApi(apiClient);
    await api.getApibaseurlpetfindbystatusstatusavaila();
  });
});
