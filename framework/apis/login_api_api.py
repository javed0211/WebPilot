from playwright.sync_api import APIResponse

from framework.core.base_api import BaseAPI


class LoginApiApi:
    def __init__(self, client: BaseAPI) -> None:
        self.client = client

    def post_auth_login_0(self, body: object, headers: dict[str, str] | None = None) -> APIResponse:
        response = self.client.post('/auth/login', body, headers=headers)
        return response
    def get_auth_me_1(self, headers: dict[str, str] | None = None) -> APIResponse:
        response = self.client.get('/auth/me', headers=headers)
        self.client.assert_status(response, 200)
        return response
