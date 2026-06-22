import pytest

from framework.apis.api_authenticated_token_chaining_api import (
    ApiAuthenticatedTokenChainingApi,
)
from framework.core.base_api import BaseAPI


@pytest.mark.api
def test_api_authenticated_token_chaining(api_client: BaseAPI) -> None:
    api = ApiAuthenticatedTokenChainingApi(api_client)
    login_response = api.login({"username": "emilys", "password": "emilyspass"})
    api.client.assert_status(login_response, 200)
