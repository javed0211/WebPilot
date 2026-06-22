from playwright.sync_api import APIResponse

from framework.core.base_api import BaseAPI


class ApiAuthenticatedTokenChainingApi:
    def __init__(self, client: BaseAPI) -> None:
        self.client = client

    def login(self, body: dict) -> APIResponse:
        return self.client.post("/auth/login", body)

    def current_user(self) -> APIResponse:
        response = self.client.get("/auth/me")
        self.client.assert_status(response, 200)
        return response
