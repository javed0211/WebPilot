import re

import pytest

from framework.apis.login_api_api import LoginApiApi
from framework.core.base_api import BaseAPI


def nested(value, path):
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
    return value


def interpolate(value, variables):
    if isinstance(value, str):
        return re.sub(r"{{(\w+)}}", lambda m: str(variables.get(m.group(1), m.group(0))), value)
    if isinstance(value, dict):
        return {key: interpolate(item, variables) for key, item in value.items()}
    return value


@pytest.mark.api
def test_login_api(api_client: BaseAPI) -> None:
    api = LoginApiApi(api_client)
    variables = {}
    response = api.post_auth_login_0({'username': 'emilys', 'password': 'emilyspass'})
    payload = response.json()
    variables['token'] = nested(payload, 'accessToken')
    response = api.get_auth_me_1(headers=interpolate({'Authorization': 'Bearer {{token}}'}, variables))
