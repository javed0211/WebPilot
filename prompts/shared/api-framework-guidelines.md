# WebPilot API automation guidelines

## Stack

- Python + Playwright `APIRequestContext`
- `pytest` and the shared `api_client` fixture
- `BaseAPI` provides HTTP helpers and assertions.

## Generated layout

| Artifact | Path |
|---|---|
| API client | `framework/apis/<name>_api.py` |
| Pytest test | `framework/tests/api/test_<slug>.py` |

Run API tests:

```bash
python -m pytest framework/tests/api -m api
```
