from playwright.sync_api import APIResponse

from framework.core.base_api import BaseAPI


class PetstoreSingleGetApi:
    def __init__(self, client: BaseAPI) -> None:
        self.client = client

    def find_available_pets(self) -> APIResponse:
        response = self.client.get(
            "https://petstore.swagger.io/v2/pet/findByStatus?status=available"
        )
        self.client.assert_status(response, 200)
        return response
