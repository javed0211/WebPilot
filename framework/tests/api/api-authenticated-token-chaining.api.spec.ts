import { test } from '@core/fixtures';
import { ApiAuthenticatedTokenChainingApi } from '../../apis/ApiAuthenticatedTokenChainingApi';

test.describe('API: API Authenticated Token Chaining', () => {
  test('API Authenticated Token Chaining', async ({ apiClient }) => {
    const api = new ApiAuthenticatedTokenChainingApi(apiClient);
    await api.postApibaseurlauthlogin({"username":"emilys","password":"emilyspass"});
    await api.getApibaseurlauthme();
  });
});
