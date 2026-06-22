import pytest

from framework.apis.petstore_single_get_api import PetstoreSingleGetApi
from framework.core.base_api import BaseAPI


@pytest.mark.api
def test_petstore_single_get(api_client: BaseAPI) -> None:
    PetstoreSingleGetApi(api_client).find_available_pets()
