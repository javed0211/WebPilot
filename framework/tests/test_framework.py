from framework.config.config_manager import config
from framework.data.data_loader import DataLoader
from framework.utils.assertion_utils import AssertionUtils
from framework.utils.wait_utils import WaitUtils


def test_load_environment_configuration() -> None:
    assert config["environment"]
    assert config["baseUrl"].startswith("http")
    assert config["variables"]["timeout"] == 30_000


def test_load_json_data() -> None:
    users = DataLoader.load_json("test-users.json")
    assert len(users) == 2
    assert users[0]["role"] == "admin"


def test_wait_and_assertion_helpers() -> None:
    counter = {"value": 0}

    def condition() -> bool:
        counter["value"] += 1
        return counter["value"] >= 3

    assert WaitUtils.wait_for_condition(condition, timeout=1_000, poll_interval=10)
    AssertionUtils.assert_true(True, "truthiness helper")
    AssertionUtils.assert_equals(100, 100, "equality helper")
