"""Tests for page inventory + DOM locator verification."""
from __future__ import annotations

from integrations.browser_use.act_history import (
    build_act_history,
    locator_candidates_from_element,
)
from integrations.browser_use.locator_verifier import verify_locators
from integrations.browser_use.page_inventory import (
    page_key_from_url,
    upsert_inventory,
    load_inventory,
    lookup_verified_locators,
)


def test_page_key_from_url():
    assert page_key_from_url("https://github.com/microsoft/playwright/pulls")
    assert "github.com" in page_key_from_url("https://github.com/microsoft/playwright/pulls")
    assert page_key_from_url("about:blank") is None


def test_verify_actions_tab_unique_by_id():
    """Ambiguous role 'Actions' fails uniqueness; id=actions-tab proves unique."""
    target = {
        "backend_node_id": 24197,
        "node_name": "A",
        "ax_name": "Actions",
        "attributes": {
            "id": "actions-tab",
            "href": "/microsoft/playwright/actions",
            "class": "UnderlineNav-item",
        },
    }
    snapshot = {
        "elements": [
            {
                "backendNodeId": 24197,
                "tag": "a",
                "axName": "Actions",
                "attributes": {
                    "id": "actions-tab",
                    "href": "/microsoft/playwright/actions",
                },
                "ancestors": [{"tag": "nav"}],
                "xpath": "html/body/main/div/nav/ul/li/a",
            },
            {
                "backendNodeId": 99999,
                "tag": "a",
                "axName": "feat(dashboard): add a debugger actions panel",
                "attributes": {"href": "/microsoft/playwright/pull/41711"},
                "ancestors": [],
                "xpath": "html/body/main/div/div/a",
            },
        ]
    }
    candidates = locator_candidates_from_element(target)
    verified = verify_locators(candidates, target=target, snapshot=snapshot)
    assert verified
    assert verified[0]["verified"] is True
    assert verified[0]["kind"] == "css"
    assert 'id="actions-tab"' in verified[0]["value"]
    # With exact:true, unscoped role "Actions" is also unique (PR title is not exact).
    # Without exact it would collide — inventory still prefers id first.
    role_only = [
        {**c, "exact": False}
        for c in candidates
        if c.get("kind") == "role" and not c.get("scope")
    ]
    role_verified = verify_locators(role_only, target=target, snapshot=snapshot)
    assert role_verified == []


def test_verify_scoped_role_when_no_id():
    target = {
        "backend_node_id": 10,
        "node_name": "A",
        "ax_name": "Pulse",
        "attributes": {"href": "/microsoft/playwright/pulse", "class": "menu-item"},
    }
    snapshot = {
        "elements": [
            {
                "backendNodeId": 10,
                "tag": "a",
                "axName": "Pulse",
                "attributes": {"href": "/microsoft/playwright/pulse"},
                "ancestors": [{"tag": "nav"}],
                "xpath": "html/body/main/div/nav/a",
            },
            {
                "backendNodeId": 11,
                "tag": "a",
                "axName": "Pulse elsewhere",
                "attributes": {"href": "/other"},
                "ancestors": [],
                "xpath": "html/body/footer/a",
            },
        ]
    }
    candidates = locator_candidates_from_element(target)
    verified = verify_locators(candidates, target=target, snapshot=snapshot)
    assert verified
    assert verified[0].get("verified") is True
    # Prefer scoped or href unique to target
    assert verified[0]["kind"] in ("role", "css")


def test_build_act_history_marks_verified_with_snapshot():
    from types import SimpleNamespace

    class _FakeAction:
        def __init__(self, payload):
            self._payload = payload

        def model_dump(self, exclude_none=True, mode="json"):
            return dict(self._payload)

    click = _FakeAction({"click": {"index": 1}})
    element = {
        "backend_node_id": 5,
        "node_name": "A",
        "ax_name": "Actions",
        "attributes": {"id": "actions-tab", "href": "/x/actions"},
        "x_path": "html/body/nav/a",
    }
    item = SimpleNamespace(
        model_output=SimpleNamespace(action=[click]),
        state=SimpleNamespace(
            url="https://github.com/microsoft/playwright/pulls",
            title="PRs",
            interacted_element=[element],
        ),
        result=[SimpleNamespace(long_term_memory=None, extracted_content=None)],
    )
    history = SimpleNamespace(
        history=[item],
        is_successful=lambda: True,
        is_done=lambda: True,
        action_names=lambda: ["click"],
        errors=lambda: [],
        model_actions=lambda: [],
        model_dump=lambda: {},
    )
    key = page_key_from_url("https://github.com/microsoft/playwright/pulls")
    snapshots = {
        key: {
            "pageKey": key,
            "url": "https://github.com/microsoft/playwright/pulls",
            "elements": [
                {
                    "backendNodeId": 5,
                    "tag": "a",
                    "axName": "Actions",
                    "attributes": {"id": "actions-tab", "href": "/x/actions"},
                    "ancestors": [{"tag": "nav"}],
                },
                {
                    "backendNodeId": 6,
                    "tag": "a",
                    "axName": "other actions text",
                    "attributes": {"href": "/y"},
                    "ancestors": [],
                },
            ],
        }
    }
    steps = build_act_history(history, page_snapshots=snapshots)
    assert len(steps) == 1
    assert steps[0].get("locatorVerified") is True
    assert steps[0]["locators"][0].get("verified") is True
    assert 'id="actions-tab"' in steps[0]["locators"][0]["value"]


def test_inventory_upsert_and_lookup(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "integrations.browser_use.page_inventory.PAGE_INVENTORY_ROOT",
        tmp_path / "page-inventory",
    )
    url = "https://example.com/app"
    snap = {
        "schemaVersion": 1,
        "pageKey": page_key_from_url(url),
        "url": url,
        "title": "App",
        "capturedAt": "2026-01-01T00:00:00Z",
        "fingerprint": "abc",
        "elementCount": 1,
        "elements": [
            {"backendNodeId": 1, "tag": "button", "axName": "Save", "attributes": {"id": "save"}}
        ],
        "verifiedLocators": [],
    }
    path = upsert_inventory(
        snap,
        verified_locator={"kind": "css", "value": 'button[id="save"]', "verified": True},
        ax_name="Save",
    )
    assert path and path.exists()
    loaded = load_inventory(url)
    assert loaded and loaded["elementCount"] == 1
    found = lookup_verified_locators(url, "Save")
    assert found
    assert found[0]["kind"] == "css"


def test_snapshot_quality_and_reuse_policy():
    from integrations.browser_use.page_inventory import (
        inventory_reuse_policy,
        snapshot_from_heal_elements,
    )

    complete = snapshot_from_heal_elements(
        "https://example.com/q",
        "Q",
        [{"tagName": "a", "text": "A", "placeholder": "", "selector": "#a", "selectorCandidates": []}],
    )
    assert complete["snapshotQuality"] == "complete"
    assert complete["capHit"] is False
    assert inventory_reuse_policy(complete) == "prefer"

    failed = snapshot_from_heal_elements("https://example.com/empty", "E", [])
    assert failed["snapshotQuality"] == "failed"
    assert inventory_reuse_policy(failed) == "ignore"

    # Capped: many elements at the store limit
    many = [
        {
            "tagName": "a",
            "text": f"L{i}",
            "placeholder": "",
            "selector": f"#i{i}",
            "selectorCandidates": [],
        }
        for i in range(120)
    ]
    capped = snapshot_from_heal_elements("https://example.com/cap", "C", many)
    assert capped["snapshotQuality"] == "capped"
    assert capped["capHit"] is True
    assert inventory_reuse_policy(capped) == "hint"


def test_lookup_respects_failed_quality(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "integrations.browser_use.page_inventory.PAGE_INVENTORY_ROOT",
        tmp_path / "page-inventory",
    )
    url = "https://example.com/failed"
    snap = {
        "schemaVersion": 2,
        "pageKey": page_key_from_url(url),
        "url": url,
        "title": "F",
        "capturedAt": "2026-01-01T00:00:00Z",
        "fingerprint": "x",
        "elementCount": 0,
        "elements": [],
        "verifiedLocators": [],
        "snapshotQuality": "failed",
        "capHit": False,
    }
    upsert_inventory(
        snap,
        verified_locator={"kind": "role", "value": "link", "name": "X", "verified": True},
        ax_name="X",
    )
    assert lookup_verified_locators(url, "X") == []
    assert lookup_verified_locators(url, "X", min_policy="hint") == []
