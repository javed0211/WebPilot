# Usage

## Install

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m playwright install chromium
cp .env.example .env
.venv/bin/webpilot doctor
```

## UI test

Create `tests/web/search.txt`:

```text
@smoke
Test: Search for hotels

1. Navigate to https://www.booking.com/
2. Enter London in the destination field
3. Search
4. Verify results are displayed
```

Run it:

```bash
.venv/bin/webpilot run tests/web/search.txt --env qa
```

The first run uses browser-use and the configured LLM. A successful run generates Python Page Objects and a pytest test. Later runs execute that test directly.

## API test

```text
@api
Test: Login and current user

Send POST request to {{apiBaseUrl}}/auth/login
With body payload {"username": "emilys", "password": "emilyspass"}
Extract response body.accessToken into token
Send GET request to {{apiBaseUrl}}/auth/me
With Headers {"Authorization": "Bearer {{token}}"}
Assert status is 200
```

```bash
.venv/bin/webpilot run tests/api/login_api.txt --env qa
.venv/bin/python -m pytest framework/tests/api/test_login_api.py
```

## Reports

```bash
.venv/bin/webpilot report
.venv/bin/webpilot analyze
```
