from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import validate
from playwright.sync_api import APIRequestContext, APIResponse


def get_nested_property(value: Any, path: str) -> Any:
    current = value
    for part in path.replace("[", ".").replace("]", "").split("."):
        if not part:
            continue
        if isinstance(current, list):
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


class BaseAPI:
    def __init__(self, request_context: APIRequestContext) -> None:
        self.request_context = request_context

    def get(self, url: str, **options: Any) -> APIResponse:
        return self.request_context.get(url, **options)

    def post(self, url: str, data: Any = None, **options: Any) -> APIResponse:
        return self.request_context.post(url, data=data, **options)

    def put(self, url: str, data: Any = None, **options: Any) -> APIResponse:
        return self.request_context.put(url, data=data, **options)

    def patch(self, url: str, data: Any = None, **options: Any) -> APIResponse:
        return self.request_context.patch(url, data=data, **options)

    def delete(self, url: str, **options: Any) -> APIResponse:
        return self.request_context.delete(url, **options)

    def head(self, url: str, **options: Any) -> APIResponse:
        return self.request_context.head(url, **options)

    def request(self, method: str, url: str, **options: Any) -> APIResponse:
        return self.request_context.fetch(url, method=method, **options)

    @staticmethod
    def assert_status(response: APIResponse, expected_status: int) -> None:
        assert response.status == expected_status

    @staticmethod
    def assert_body_contains(response: APIResponse, text: str) -> None:
        assert text in response.text()

    @staticmethod
    def assert_json_path_exists(payload: Any, json_path: str) -> None:
        assert get_nested_property(payload, json_path) is not None

    @staticmethod
    def assert_json_path_equals(payload: Any, json_path: str, expected: Any) -> None:
        assert get_nested_property(payload, json_path) == expected

    @staticmethod
    def validate_schema(response: APIResponse, schema: dict[str, Any]) -> None:
        validate(instance=response.json(), schema=schema)

    @staticmethod
    def save_response_body(response: APIResponse, file_path: str | Path) -> None:
        Path(file_path).write_text(response.text(), encoding="utf-8")
