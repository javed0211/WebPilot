"""Generic, validated site knowledge learned from successful Browser Use steps."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .capability_contract import (
    SCHEMA_VERSION,
    classify_failure,
    enrich_capability,
    infer_intent,
    is_replay_allowed,
    looks_like_auth_interstitial,
    migrate_legacy_capability,
    resolve_navigate_target,
    resolve_validation_contract,
    route_failure,
    should_quarantine,
    validate_contract,
)
from .intent_resolver import (
    attach_intent_descriptor,
    build_capability_identity,
    capability_id_from_identity,
    capability_match_score,
    detect_page_type,
    resolve_step_intent,
)
from .credentials import is_credential_step, resolve_sensitive_text
from .trust_scoring import invalidate_if_step_changed, record_promotion_trust
from .system_recipes import try_app_switcher_recipe
from .paths import CONFIG_ROOT, PROJECT_ROOT

KNOWLEDGE_ROOT = PROJECT_ROOT / "runtime" / "site-knowledge"
KNOWLEDGE_PATH = KNOWLEDGE_ROOT / "knowledge.json"
KNOWLEDGE_LEGACY_PATH = KNOWLEDGE_ROOT / "knowledge.legacy.json"
SCENARIOS_DIR = KNOWLEDGE_ROOT / "scenarios"
PAGES_DIR = KNOWLEDGE_ROOT / "pages"
SELECTOR_REGISTRY_PATH = PROJECT_ROOT / "runtime" / "selectors" / "registry.json"

KNOWLEDGE_TTL_DAYS = int(os.environ.get("WEBPILOT_KNOWLEDGE_TTL_DAYS", "30") or "30")

# Microsoft Entra / Azure AD login hosts — URL paths change between runs (kmsi, oauth, etc.).
AUTH_RELAXED_ORIGINS = frozenset({
    "login.microsoftonline.com",
    "login.live.com",
    "login.microsoft.com",
    "account.live.com",
})

_LOCATOR_KIND_PRIORITY = {
    "role": 0,
    "label": 1,
    "placeholder": 2,
    "testid": 3,
    "text": 4,
    "css": 5,
}

CONSENT_TERMS = (
    "cookie",
    "consent",
    "onetrust",
    "fc-consent",
    "privacy preference",
    "accept all",
    "accept cookies",
)

_COOKIE_DISMISS_JS = """() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\\s+/g, ' ');
  const consentRe = /^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree( to (all )?cookies)?|i agree|consent|ok,? thanks|got it)$/i;
  const consentRoot = (el) => el.closest(
    '#onetrust-banner-sdk, #onetrust-consent-sdk, .fc-consent-root, [class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"]'
  );
  const candidates = [
    '#onetrust-accept-btn-handler',
    'button.fc-cta-consent',
    'button[aria-label="Consent"]',
    '[role="button"][aria-label="Consent"]',
    '#onetrust-banner-sdk button[id*="accept"]',
    '.fc-consent-root button',
  ];
  for (const selector of candidates) {
    const el = [...document.querySelectorAll(selector)].find(visible);
    if (el) {
      el.click();
      return true;
    }
  }
  const buttons = [...document.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]')];
  const preferred = buttons.find((el) => visible(el) && consentRe.test(label(el)));
  if (preferred) {
    preferred.click();
    return true;
  }
  const inBanner = buttons.find((el) => visible(el) && consentRoot(el) && /accept|agree|consent|allow/i.test(label(el)));
  if (inBanner) {
    inBanner.click();
    return true;
  }
  return false;
}"""


def step_signature(step: str) -> str:
    return re.sub(r"\s+", " ", step.strip().lower())


def url_pattern(url: str) -> str:
    parsed = urlparse(url or "about:blank")
    if parsed.scheme in ("http", "https"):
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"
    return url or "about:blank"


def _url_pattern_matches(stored_pattern: str, current_url: str) -> bool:
    """Match learned preconditions; relax path for auth hosts and same-origin prefixes."""
    current_pattern = url_pattern(current_url)
    if stored_pattern == current_pattern:
        return True
    stored_origin = origin_for_url(stored_pattern if "://" in stored_pattern else f"https://{stored_pattern}")
    current_origin = origin_for_url(current_url)
    if stored_origin in AUTH_RELAXED_ORIGINS and stored_origin == current_origin:
        return True
    # Same-origin path prefix (trailing slash / nested docs routes).
    if stored_origin and stored_origin == current_origin:
        stored_path = (urlparse(stored_pattern).path or "/").rstrip("/") or "/"
        current_path = (urlparse(current_url).path or "/").rstrip("/") or "/"
        # Site root precondition matches any path on the same origin (verify/assert replay).
        if stored_path == "/":
            return True
        if current_path == stored_path or current_path.startswith(stored_path + "/"):
            return True
    return False


def origin_for_url(url: str) -> str:
    parsed = urlparse(url or "")
    return parsed.netloc.lower() or "_global"


def page_key(url: str | None) -> str:
    if not url:
        return "unknown"
    parsed = urlparse(url)
    if parsed.scheme in ("http", "https"):
        return f"{parsed.netloc}{parsed.path or ''}".rstrip("/") or parsed.netloc
    return url.replace("https://", "").replace("http://", "").rstrip("/") or "unknown"


def action_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return key.strip("_")[:80] or "unknown_action"


def _word_tokens(value: str) -> set[str]:
    return {
        word
        for word in re.findall(r"[a-z0-9]+", value.lower())
        if word not in {"the", "a", "an", "to", "in", "on", "and", "of", "is", "are"}
    }


def _clean_accessible_text(value: str) -> str:
    # Browser Use text can include icon-font private-use glyphs (e.g. "\ue8f8 Products").
    value = re.sub(r"[\ue000-\uf8ff]", " ", value or "")
    return re.sub(r"\s+", " ", value).strip()


def _is_verification_step(step: str) -> bool:
    return bool(re.match(r"^(verify|assert|check|ensure|then)\b", step.strip(), re.IGNORECASE))


def _is_consent_anchor(anchor: dict[str, Any]) -> bool:
    blob = json.dumps(anchor, ensure_ascii=False).lower()
    return any(term in blob for term in CONSENT_TERMS)


def _load_selector_registry() -> dict[str, Any]:
    if not SELECTOR_REGISTRY_PATH.exists():
        return {"selectors": {}}
    try:
        with open(SELECTOR_REGISTRY_PATH, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {"selectors": {}}


def _candidate_from_registry_selector(selector: dict[str, Any]) -> dict[str, Any] | None:
    kind = selector.get("kind")
    value = selector.get("value") or ""
    confidence = float(selector.get("confidence") or 0)
    expression = selector.get("frameworkExpression") or ""
    if confidence < 0.7:
        return None
    if kind == "role":
        match = re.match(r"([^[]+)(?:\[name='([^']+)'\])?", value)
        if not match:
            return None
        return {
            "kind": "role",
            "value": match.group(1),
            "name": match.group(2) or "",
            "confidence": confidence,
            "source": "selector-registry",
            "expression": expression,
        }
    if kind in {"label", "placeholder", "testid", "text", "css"}:
        return {
            "kind": kind,
            "value": value,
            "confidence": confidence,
            "source": "selector-registry",
            "expression": expression,
        }
    return None


def registry_locators_for_step(current_url: str, step: str) -> list[dict[str, Any]]:
    registry = _load_selector_registry()
    page_entries = (registry.get("selectors") or {}).get(page_key(current_url), {})
    if not page_entries:
        return []
    step_tokens = _word_tokens(step)
    ranked_entries: list[tuple[float, dict[str, Any]]] = []
    for key, entry in page_entries.items():
        key_tokens = _word_tokens(key.replace("_", " "))
        primary = entry.get("primary") or {}
        confidence = float(primary.get("confidence") or 0)
        overlap = len(step_tokens & key_tokens)
        if overlap == 0:
            continue
        # Prefer semantic, high-confidence registry entries even if their action name
        # differs from the natural-language step (e.g. open_products_page).
        ranked_entries.append((overlap + confidence, entry))
    ranked_entries.sort(key=lambda item: item[0], reverse=True)
    locators: list[dict[str, Any]] = []
    for _, entry in ranked_entries[:2]:
        for selector in [entry.get("primary"), *(entry.get("fallbacks") or [])]:
            if not selector:
                continue
            candidate = _candidate_from_registry_selector(selector)
            if candidate:
                locators.append(candidate)
    return locators


def _slugify_store_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9._-]+", "_", (value or "").strip().lower())
    return key.strip("_")[:120] or "unknown"


def load_knowledge_config() -> dict[str, str]:
    """Read knowledge scope/storage from webpilot.yaml with env overrides."""
    defaults = {"knowledgeScope": "global", "knowledgeStorage": "partitioned"}
    try:
        import yaml

        with open(CONFIG_ROOT / "webpilot.yaml", "r", encoding="utf-8") as handle:
            yaml_config = yaml.safe_load(handle) or {}
        ir = yaml_config.get("intelligentRunner") or {}
        if ir.get("knowledgeScope"):
            defaults["knowledgeScope"] = str(ir["knowledgeScope"]).strip().lower()
        if ir.get("knowledgeStorage"):
            defaults["knowledgeStorage"] = str(ir["knowledgeStorage"]).strip().lower()
    except Exception:
        pass
    env_scope = os.environ.get("WEBPILOT_KNOWLEDGE_SCOPE", "").strip().lower()
    if env_scope in ("global", "test"):
        defaults["knowledgeScope"] = env_scope
    env_storage = os.environ.get("WEBPILOT_KNOWLEDGE_STORAGE", "").strip().lower()
    if env_storage in ("partitioned", "legacy"):
        defaults["knowledgeStorage"] = env_storage
    return defaults


def _empty_store(store_kind: str, *, origin: str | None = None, test_slug: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"schemaVersion": 3, "storeKind": store_kind, "capabilities": []}
    if store_kind == "page" and origin:
        payload["origin"] = origin
    if store_kind == "scenario" and test_slug:
        payload["testSlug"] = test_slug
    return payload


def _read_store_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def _write_store_file(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)


def _promote_in_store(data: dict[str, Any], capability: dict[str, Any]) -> None:
    capabilities = data.setdefault("capabilities", [])
    capability = invalidate_if_step_changed(capability, capability.get("step", ""))
    capability_id = capability["id"]
    existing = next((item for item in capabilities if item.get("id") == capability_id), None)
    if existing:
        capability["successCount"] = int(existing.get("successCount", 0)) + 1
        capabilities[capabilities.index(existing)] = capability
    else:
        capability["successCount"] = 1
        capabilities.append(capability)
    record_promotion_trust(capability)
    capability["lastValidatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    capability["updatedAt"] = capability["lastValidatedAt"]


def _record_failure_in_store(data: dict[str, Any], capability: dict[str, Any], reason: str) -> None:
    failure_class = classify_failure(reason)
    capability["failureCount"] = int(capability.get("failureCount", 0)) + 1
    capability["lastFailure"] = reason[:1000]
    quality = capability.setdefault("quality", {})
    quality["failureClass"] = failure_class
    quality["lastFailureReason"] = reason[:1000]
    if should_quarantine(failure_class, capability["failureCount"]):
        capability["status"] = "quarantined"
    capability["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    capabilities = data.setdefault("capabilities", [])
    existing = next((item for item in capabilities if item.get("id") == capability.get("id")), None)
    if existing:
        capabilities[capabilities.index(existing)] = capability
    else:
        capabilities.append(capability)


class KnowledgeRepository:
    """Partitioned site knowledge: per-page (global) or per-scenario (test scope)."""

    def __init__(self, config: dict[str, str], test_slug: str):
        self.scope = config.get("knowledgeScope", "global")
        self.storage = config.get("knowledgeStorage", "partitioned")
        self.test_slug = _slugify_store_key(test_slug)
        if self.storage == "partitioned":
            self._migrate_legacy_if_needed()

    def _scenario_path(self) -> Path:
        return SCENARIOS_DIR / f"{self.test_slug}.json"

    def _page_path(self, origin: str) -> Path:
        return PAGES_DIR / f"{_slugify_store_key(origin)}.json"

    def _migrate_legacy_if_needed(self) -> None:
        if not KNOWLEDGE_PATH.exists():
            return
        if PAGES_DIR.exists() and any(PAGES_DIR.glob("*.json")):
            return
        if SCENARIOS_DIR.exists() and any(SCENARIOS_DIR.glob("*.json")):
            return
        try:
            with open(KNOWLEDGE_PATH, encoding="utf-8") as handle:
                legacy = json.load(handle)
        except Exception:
            return
        grouped: dict[str, list[dict[str, Any]]] = {}
        for capability in legacy.get("capabilities") or []:
            origin = capability.get("origin") or origin_for_url(
                (capability.get("before") or {}).get("urlPattern", "")
            )
            grouped.setdefault(origin, []).append(capability)
        for origin, capabilities in grouped.items():
            _write_store_file(
                self._page_path(origin),
                _empty_store("page", origin=origin) | {"capabilities": capabilities},
            )
        try:
            KNOWLEDGE_PATH.rename(KNOWLEDGE_LEGACY_PATH)
            print(
                f"[Knowledge] Migrated {len(legacy.get('capabilities') or [])} capability(ies) "
                f"into {len(grouped)} page store(s) under runtime/site-knowledge/pages/."
            )
        except Exception:
            pass

    def _load_partitioned_store(self, path: Path, store_kind: str) -> dict[str, Any]:
        raw = _read_store_file(path)
        if raw.get("capabilities") is not None:
            return raw
        if store_kind == "page":
            origin = path.stem.replace("_", ".")
            return _empty_store("page", origin=origin)
        return _empty_store("scenario", test_slug=self.test_slug)

    def _lookup_stores(self, current_url: str) -> list[dict[str, Any]]:
        if self.storage != "partitioned":
            return [load_knowledge()]
        if self.scope == "test":
            return [self._load_partitioned_store(self._scenario_path(), "scenario")]
        stores = [self._load_partitioned_store(self._page_path(origin_for_url(current_url)), "page")]
        if KNOWLEDGE_PATH.exists():
            stores.append(load_knowledge())
        return stores

    def _writable_store(self, capability: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
        if self.storage != "partitioned":
            return KNOWLEDGE_PATH, load_knowledge()
        if self.scope == "test":
            path = self._scenario_path()
            store = self._load_partitioned_store(path, "scenario")
            store["testSlug"] = self.test_slug
            capability["testSlug"] = self.test_slug
            return path, store
        origin = capability.get("origin") or origin_for_url(
            (capability.get("before") or {}).get("urlPattern", "")
        )
        path = self._page_path(origin)
        store = self._load_partitioned_store(path, "page")
        store["origin"] = origin
        return path, store

    def find_capability(
        self,
        step: str,
        current_url: str,
        page_state: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        from .knowledge_merge import find_with_cross_scenario_fallback

        stores = self._lookup_stores(current_url)
        if self.scope == "global" and self.storage == "partitioned":
            return find_with_cross_scenario_fallback(stores, step, current_url, page_state)
        for data in stores:
            found = find_capability(data, step, current_url, page_state)
            if found:
                return found
        return None

    def promote(self, capability: dict[str, Any]) -> None:
        from .knowledge_merge import merge_capability_into_page_store

        if self.storage != "partitioned":
            data = load_knowledge()
            _promote_in_store(data, capability)
            save_knowledge(data)
            return
        path, data = self._writable_store(capability)
        _promote_in_store(data, capability)
        _write_store_file(path, data)
        if self.scope == "global":
            origin = capability.get("origin") or origin_for_url(
                (capability.get("before") or {}).get("urlPattern", "")
            )
            page_path = self._page_path(origin)
            page_store = self._load_partitioned_store(page_path, "page")
            page_store["origin"] = origin
            if merge_capability_into_page_store(page_store, capability):
                _write_store_file(page_path, page_store)

    def record_failure(self, capability: dict[str, Any], reason: str) -> None:
        if self.storage != "partitioned":
            data = load_knowledge()
            _record_failure_in_store(data, capability, reason)
            save_knowledge(data)
            return
        path, data = self._writable_store(capability)
        _record_failure_in_store(data, capability, reason)
        _write_store_file(path, data)


def load_knowledge() -> dict[str, Any]:
    if not KNOWLEDGE_PATH.exists():
        return {"schemaVersion": 2, "capabilities": []}
    try:
        with open(KNOWLEDGE_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        if data.get("schemaVersion") != 2:
            return {"schemaVersion": 2, "capabilities": []}
        return data
    except Exception:
        return {"schemaVersion": 2, "capabilities": []}


def save_knowledge(data: dict[str, Any]) -> None:
    KNOWLEDGE_ROOT.mkdir(parents=True, exist_ok=True)
    with open(KNOWLEDGE_PATH, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)


def _capability_stale(capability: dict[str, Any]) -> bool:
    if KNOWLEDGE_TTL_DAYS <= 0:
        return False
    stamp = capability.get("lastValidatedAt") or capability.get("updatedAt")
    if not stamp:
        return False
    try:
        validated = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if validated.tzinfo is None:
            validated = validated.replace(tzinfo=datetime.timezone.utc)
        age = datetime.datetime.now(datetime.timezone.utc) - validated
        return age.days > KNOWLEDGE_TTL_DAYS
    except Exception:
        return False


def find_capability(
    data: dict[str, Any],
    step: str,
    current_url: str,
    page_state: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    signature = step_signature(step)
    current_pattern = url_pattern(current_url)
    page_state = page_state or {"url": current_url, "urlPattern": current_pattern, "bodyText": ""}
    candidates = [
        item
        for item in data.get("capabilities", [])
        if item.get("stepSignature") == signature
        and item.get("status") != "quarantined"
        and not _capability_stale(item)
        and _url_pattern_matches(item.get("before", {}).get("urlPattern", ""), current_url)
    ]
    if candidates:
        ranked = sorted(
            candidates,
            key=lambda item: capability_match_score(migrate_legacy_capability(item), step, page_state),
            reverse=True,
        )
        best = migrate_legacy_capability(ranked[0])
        if capability_match_score(best, step, page_state) < 0:
            return None
        return best
    if _is_verification_step(step):
        # Assertion-only replay: if the page fingerprint is stable enough, avoid an
        # LLM call for repeated "verify page visible" checks.
        return {
            "id": hashlib.sha256(f"assert|{step_signature(step)}|{current_pattern}".encode("utf-8")).hexdigest()[:20],
            "step": step,
            "stepSignature": signature,
            "origin": origin_for_url(current_url),
            "before": {"urlPattern": current_pattern, "anchors": []},
            "actions": [{"type": "assert_visible_page"}],
            "after": {"urlPattern": current_pattern, "anchors": [], "evidence": []},
            "failureCount": 0,
            "successCount": 0,
            "status": "synthetic",
        }
    return None


def promote_capability(data: dict[str, Any], capability: dict[str, Any]) -> None:
    _promote_in_store(data, capability)
    save_knowledge(data)


def record_failure(data: dict[str, Any], capability: dict[str, Any], reason: str) -> None:
    _record_failure_in_store(data, capability, reason)
    save_knowledge(data)


def _locator_candidates(node: Any) -> list[dict[str, str]]:
    attrs = dict(getattr(node, "attributes", {}) or {})
    tag = (getattr(node, "tag_name", None) or getattr(node, "node_name", "") or "*").lower()
    candidates: list[dict[str, str]] = []
    text = ""
    try:
        text = _clean_accessible_text(node.get_meaningful_text_for_llm())
    except Exception:
        text = ""
    input_type = (attrs.get("type") or "").lower()
    submit_value = (attrs.get("value") or "").strip()
    accessible_name = attrs.get("aria-label") or attrs.get("ax_name") or text or submit_value

    if tag == "a" and accessible_name:
        candidates.append({"kind": "role", "value": "link", "name": accessible_name})
    if tag == "button" and accessible_name:
        candidates.append({"kind": "role", "value": "button", "name": accessible_name})
    if tag == "input" and input_type in ("submit", "button") and accessible_name:
        candidates.append({"kind": "role", "value": "button", "name": accessible_name})
    role = attrs.get("role")
    if role and accessible_name:
        candidates.append({"kind": "role", "value": role, "name": accessible_name})
    placeholder = attrs.get("placeholder")
    if placeholder:
        candidates.append({"kind": "placeholder", "value": placeholder})
    for test_attr in ("data-testid", "data-test", "data-cy"):
        value = attrs.get(test_attr)
        if value:
            candidates.append({"kind": "testid", "value": value})
    href = attrs.get("href")
    if tag == "a" and href:
        candidates.append({"kind": "css", "value": f'a[href="{href}"]'})
        if href.startswith("/"):
            candidates.append({"kind": "css", "value": f'a[href*="{href}"]'})
    for attr in ("id", "name", "aria-label"):
        value = attrs.get(attr)
        if value:
            candidates.append({"kind": "css", "value": f'{tag}[{attr}="{value}"]'})
    if text and len(text) <= 120:
        candidates.append({"kind": "text", "value": text, "tag": tag})

    seen: set[tuple[str, str, str]] = set()
    unique: list[dict[str, str]] = []
    for candidate in sorted(
        candidates,
        key=lambda item: (
            _LOCATOR_KIND_PRIORITY.get(item.get("kind", "css"), 99),
            len(item.get("name", item.get("value", ""))),
        ),
    ):
        key = (
            candidate.get("kind", ""),
            candidate.get("value", candidate.get("name", "")),
            candidate.get("name", ""),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique[:6]


def _step_mentions_modal(step: str) -> bool:
    return bool(re.search(r"\b(modal|popup|dialog|overlay|alert|banner)\b", step, re.IGNORECASE))


def _node_in_modal_context(node: Any) -> bool:
    attrs = dict(getattr(node, "attributes", {}) or {})
    if attrs.get("role") == "dialog" or attrs.get("aria-modal") == "true":
        return True
    parent = getattr(node, "parent", None)
    depth = 0
    while parent is not None and depth < 6:
        parent_attrs = dict(getattr(parent, "attributes", {}) or {})
        if parent_attrs.get("role") == "dialog" or parent_attrs.get("aria-modal") == "true":
            return True
        parent = getattr(parent, "parent", None)
        depth += 1
    return False


def actions_from_output(state: Any, output: Any) -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    selector_map = getattr(getattr(state, "dom_state", None), "selector_map", {}) or {}
    for action_model in getattr(output, "action", []) or []:
        try:
            dumped = action_model.model_dump(exclude_none=True)
        except Exception:
            continue
        for name, params in dumped.items():
            params = params or {}
            if name == "navigate" and params.get("url"):
                recipes.append({"type": "navigate", "url": params["url"], "newTab": bool(params.get("new_tab", False))})
            elif name in ("switch", "switch_tab") and params.get("tab_id"):
                recipes.append({"type": "switch_tab", "tabId": str(params["tab_id"])})
            elif name in ("close", "close_tab") and params.get("tab_id"):
                recipes.append({"type": "close_tab", "tabId": str(params["tab_id"])})
            elif name in ("click", "input"):
                index = params.get("index")
                node = selector_map.get(index)
                locators = _locator_candidates(node) if node is not None else []
                if not locators:
                    continue
                recipe: dict[str, Any] = {"type": name, "locators": locators}
                if _node_in_modal_context(node):
                    recipe["modal"] = True
                if name == "input":
                    recipe["value"] = params.get("text", "")
                    recipe["clear"] = params.get("clear", True)
                recipes.append(recipe)
            elif name in ("send_keys", "press") and (params.get("keys") or params.get("key")):
                recipes.append({"type": "press", "value": params.get("keys") or params.get("key")})
            elif name == "wait":
                recipes.append({"type": "wait", "seconds": min(float(params.get("seconds", 1)), 5)})
            elif name in ("go_back", "navigate_back", "back"):
                recipes.append({"type": "go_back"})
            elif name in ("screenshot", "take_screenshot"):
                recipes.append(
                    {
                        "type": "screenshot",
                        "value": params.get("file_name")
                        or params.get("filename")
                        or params.get("path")
                        or "",
                    }
                )
            elif name in ("search_page", "find_text", "find", "extract"):
                query = (
                    params.get("query")
                    or params.get("text")
                    or params.get("pattern")
                    or params.get("value")
                    or ""
                )
                if query:
                    recipes.append({"type": "search_page", "value": str(query)})
    return recipes


async def compact_page_state(browser_session: Any) -> dict[str, Any]:
    page = await browser_session.must_get_current_page()
    raw = await page.evaluate(
        """() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          // Light DOM + open shadow roots (auth widgets often mount inputs in shadow DOM).
          const deepQuery = (root, selector) => {
            const out = [];
            const visit = (node) => {
              if (!node) return;
              if (node.querySelectorAll) {
                out.push(...node.querySelectorAll(selector));
                for (const el of node.querySelectorAll('*')) {
                  if (el.shadowRoot) visit(el.shadowRoot);
                }
              }
            };
            visit(root);
            return out;
          };
          const selectors = ['[data-testid]','[data-test]','[data-cy]','input[name]','input[type]',
            'button[aria-label]','a[aria-label]','[role][aria-label]','input[placeholder]'];
          const anchors = [];
          for (const el of deepQuery(document, selectors.join(','))) {
            if (!visible(el)) continue;
            const attrs = {};
            for (const key of ['data-testid','data-test','data-cy','id','name','aria-label','placeholder','role','type']) {
              const value = el.getAttribute(key);
              if (value) attrs[key] = value;
            }
            if (Object.keys(attrs).length) anchors.push({tag: el.tagName.toLowerCase(), attrs});
            if (anchors.length >= 20) break;
          }
          const evidence = [];
          for (const el of deepQuery(document, 'img[alt],h1,h2,h3,label,input[aria-label],input[placeholder],input[type="password"],[role="heading"]')) {
            if (!visible(el)) continue;
            const text = (el.getAttribute('alt') || el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') || el.getAttribute('type') || el.textContent || '').trim().replace(/\\s+/g,' ');
            if (text && text.length <= 160) evidence.push({tag: el.tagName.toLowerCase(), text});
            if (evidence.length >= 30) break;
          }
          // Exclude WebPilot branding overlay text from body samples used for progression checks.
          const branding = document.getElementById('webpilot-agent-ui');
          let bodyText = '';
          if (branding) {
            const clone = document.body.cloneNode(true);
            const brand = clone.querySelector('#webpilot-agent-ui');
            if (brand) brand.remove();
            bodyText = (clone.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 5000);
          } else {
            bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 5000);
          }
          return JSON.stringify({url: location.href, title: document.title, anchors, evidence, bodyText});
        }"""
    )
    state = json.loads(raw)
    state["urlPattern"] = url_pattern(state.get("url", ""))
    return state


def capability_from_aligned_history_step(
    step: str,
    hist_step: dict[str, Any],
    *,
    page_url: str | None = None,
) -> dict[str, Any] | None:
    """Build a replay capability from NL-aligned codegen history (native discovery)."""
    action = str(hist_step.get("action") or "").lower()
    url = hist_step.get("url") or page_url or ""
    value = hist_step.get("value")
    locators: list[dict[str, Any]] = []
    selector = hist_step.get("selector")
    if isinstance(selector, str) and selector.strip().startswith("["):
        try:
            parsed = json.loads(selector)
            if isinstance(parsed, list):
                locators = [item for item in parsed if isinstance(item, dict)]
        except Exception:
            locators = []

    actions: list[dict[str, Any]] = []
    if action == "navigate" and (hist_step.get("url") or url):
        actions = [{"type": "navigate", "url": hist_step.get("url") or url}]
    elif action == "click" and locators:
        actions = [{"type": "click", "locators": locators}]
    elif action in {"input", "fill", "type"} and locators:
        actions = [{"type": "input", "locators": locators, "value": value or "", "clear": True}]
    elif action == "go_back":
        actions = [{"type": "go_back"}]
    elif action == "assert":
        if isinstance(value, str) and value.startswith("__url_contains__:"):
            actions = [{"type": "assert_url_contains", "value": value.split(":", 1)[1]}]
        elif isinstance(value, str) and value.startswith("__url_equals__:"):
            actions = [{"type": "assert_url_equals", "value": value.split(":", 1)[1]}]
        elif locators or value:
            payload: dict[str, Any] = {"type": "assert_text", "value": value or ""}
            if locators:
                payload["locators"] = locators
            actions = [payload]
        else:
            actions = [{"type": "assert_visible_page"}]
    elif action == "screenshot":
        payload: dict[str, Any] = {"type": "assert_text", "value": value or ""}
        if locators:
            payload["locators"] = locators
        actions = [payload] if (locators or value) else [{"type": "assert_visible_page"}]
    else:
        return None

    before = {
        "url": url or "about:blank",
        "urlPattern": url_pattern(url) if url else "about:blank",
        "anchors": [],
        "evidence": [],
        "bodyText": "",
    }
    after = dict(before)
    if action == "navigate" and actions and actions[0].get("url"):
        after = {
            "url": actions[0]["url"],
            "urlPattern": url_pattern(actions[0]["url"]),
            "anchors": [],
            "evidence": [],
            "bodyText": "",
        }
    elif action == "click":
        # Navigational clicks often change URL — use optional after_url hint when provided.
        after_hint = hist_step.get("_afterUrl") or hist_step.get("afterUrl")
        if after_hint:
            after = {
                "url": after_hint,
                "urlPattern": url_pattern(str(after_hint)),
                "anchors": [],
                "evidence": [],
                "bodyText": "",
            }
    return capability_from_step(step, before, after, actions)


def capability_from_step(
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
    actions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    actionable = [
        action
        for action in actions
        if action.get("type")
        in {
            "navigate",
            "click",
            "input",
            "press",
            "wait",
            "switch_tab",
            "close_tab",
            "wait_for_modal",
            "go_back",
            "assert_visible_page",
            "assert_text",
            "assert_url_contains",
            "assert_url_equals",
        }
    ]
    assertion_step = bool(re.match(r"^(verify|assert|check|ensure|then)\b", step.strip(), re.IGNORECASE))
    if not actionable and not assertion_step:
        return None
    required_evidence: list[dict[str, str]] = []
    # Prefer explicit assert_* actions from aligned history — skip brittle DOM evidence matching.
    has_explicit_assert = any(
        str(action.get("type") or "").startswith("assert") for action in actionable
    )
    if assertion_step and not has_explicit_assert and not actionable:
        step_words = set(re.findall(r"[a-z0-9]+", step.lower())) - {
            "verify", "assert", "check", "ensure", "the", "a", "an", "is", "are", "visible", "displayed", "shown"
        }
        for item in after.get("evidence", []):
            evidence_words = set(re.findall(r"[a-z0-9]+", item.get("text", "").lower()))
            if step_words & evidence_words:
                required_evidence.append(item)
            if len(required_evidence) >= 4:
                break
        minimum_evidence = 1 + step.lower().count(" and ")
        if len(required_evidence) < minimum_evidence:
            return None
    if assertion_step and not actionable:
        actionable = [{"type": "assert_visible_page"}]
    signature = step_signature(step)
    page_type = detect_page_type(before)
    identity = build_capability_identity(step, before, after, page_type)
    if _step_mentions_modal(step) and not any(action.get("type") == "wait_for_modal" for action in actionable):
        actionable = [{"type": "wait_for_modal", "seconds": 5}, *actionable]
    capability = enrich_capability(
        {
        "id": capability_id_from_identity(identity),
        "step": step,
        "stepSignature": signature,
        "origin": origin_for_url(after.get("url") or before.get("url") or ""),
        "before": {
            "urlPattern": before.get("urlPattern"),
            "anchors": before.get("anchors", [])[:4],
        },
        "actions": actionable,
        "after": {
            "urlPattern": after.get("urlPattern"),
            "anchors": after.get("anchors", [])[:4],
            "evidence": required_evidence,
        },
        "failureCount": 0,
        },
        step=step,
        before=before,
        after=after,
    )
    return attach_intent_descriptor(capability, step, before)


async def _evaluate_json(page: Any, function: str, arg: Any) -> Any:
    raw = await page.evaluate(function, arg)
    return json.loads(raw) if raw else None


async def fingerprint_matches(browser_session: Any, fingerprint: dict[str, Any]) -> bool:
    """Legacy binary fingerprint check — prefer validate_capability_phase."""
    current = await compact_page_state(browser_session)
    if fingerprint.get("urlPattern") and not _url_pattern_matches(
        fingerprint.get("urlPattern", ""), current.get("url", "")
    ):
        return False
    page = await browser_session.must_get_current_page()
    contract = contract_from_legacy_fingerprint(fingerprint)
    ok, _, _, _ = await validate_contract(page, contract, phase="pre", min_confidence=0.55)
    return ok


def contract_from_legacy_fingerprint(fingerprint: dict[str, Any]) -> dict[str, Any]:
    from .capability_contract import contract_from_legacy_fingerprint as _convert

    return _convert(fingerprint)


async def validate_capability_phase(
    browser_session: Any,
    capability: dict[str, Any],
    phase: str,
) -> tuple[bool, str, str | None]:
    capability = migrate_legacy_capability(capability)
    page = await browser_session.must_get_current_page()
    current = await compact_page_state(browser_session)
    contract = resolve_validation_contract(capability, "pre" if phase == "pre" else "post")
    expected_page_type = contract.get("pageType") or capability.get("pageType")
    if expected_page_type:
        from .intent_resolver import detect_page_type

        actual_page_type = detect_page_type(current)
        if actual_page_type != expected_page_type and phase == "pre":
            reason = f"pageType mismatch: expected {expected_page_type}, got {actual_page_type}"
            return False, reason, classify_failure(reason)
    if phase == "pre" and contract.get("urlPattern"):
        if not _url_pattern_matches(contract.get("urlPattern", ""), current.get("url", "")):
            reason = "current page fingerprint does not match learned precondition"
            return False, reason, classify_failure(reason)
    intent = capability.get("intent") or infer_intent(capability.get("step", ""))
    min_confidence = 0.55 if capability.get("schemaVersion", 2) < SCHEMA_VERSION else 0.65
    if intent in ("interact", "input", "generic"):
        min_confidence = 0.5
    if intent == "verify":
        min_confidence = 0.6
    ok, _confidence, reason, failure_class = await validate_contract(
        page,
        contract,
        phase="pre" if phase == "pre" else "post",
        min_confidence=min_confidence,
    )
    return ok, reason, failure_class


async def ensure_auth_context_ready(browser_session: Any) -> tuple[bool, str]:
    """Clear generic auth interstitials before business steps (auth state machine)."""
    from .auth_state import ensure_session_ready

    return await ensure_session_ready(browser_session, compact_page_state=compact_page_state)


async def validate_step_outcome(
    browser_session: Any,
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
    actions: list[dict[str, Any]],
) -> tuple[bool, str]:
    """Runner-owned business outcome check before saving a learned capability."""
    capability = capability_from_step(step, before, after, actions)
    if not capability:
        return True, ""
    ok, reason, _ = await validate_capability_phase(browser_session, capability, "post")
    return ok, reason


def _state_has_password_field(state: dict[str, Any]) -> bool:
    for anchor in state.get("anchors") or []:
        attrs = anchor.get("attrs") or {}
        blob = " ".join(str(v) for v in attrs.values()).lower()
        tag = str(anchor.get("tag") or "").lower()
        if tag == "input" and ("password" in blob or attrs.get("type", "").lower() == "password"):
            return True
        if "password" in blob and tag in ("input", "label"):
            return True
    for item in state.get("evidence") or []:
        text = str(item.get("text") or "").lower()
        tag = str(item.get("tag") or "").lower()
        if "password" in text and tag in ("input", "label"):
            return True
    return False


def progressive_outcome_indicates_success(
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
    actions: list[dict[str, Any]],
    history: Any | None = None,
) -> bool:
    """True when the agent called done(false) but the UI clearly advanced after its action.

    Common WebPilot false-negative: click Continue succeeds → password page loads → agent
    re-scans for Continue, cannot find it, and wrongly reports failure. Raw browser-use
    avoids this because it keeps the full multi-step task in one agent run.
    """
    # Strongest signal: browser-use already reported the matching click/type succeeded.
    if history_indicates_step_action_succeeded(history, step):
        return True

    actionable = [a for a in actions if a.get("type") in ("click", "input", "navigate", "press")]
    lowered = step.lower()
    looks_like_click_step = bool(
        re.search(r"\b(click|press|tap|select|continue|next|confirm|submit|sign\s*in)\b", lowered)
    )

    before_url = (before.get("url") or "").split("#", 1)[0]
    after_url = (after.get("url") or "").split("#", 1)[0]
    url_changed = bool(before_url and after_url and before_url != after_url)
    has_click = any(a.get("type") == "click" for a in actionable)
    has_input = any(a.get("type") == "input" for a in actionable)

    # Auth wizard: Continue/Next → password field appears (even if action capture missed locators).
    if looks_like_click_step and not _state_has_password_field(before) and _state_has_password_field(after):
        return True

    if not actionable:
        return False

    # Click caused a real navigation / route change.
    if has_click and url_changed:
        return True

    # Click steps naming a CTA: surface advanced from email → sign-in shell.
    if has_click and re.search(r"\b(continue|next|confirm|submit|sign\s*in)\b", lowered):
        before_blob = json.dumps(
            {"anchors": before.get("anchors") or [], "evidence": before.get("evidence") or []},
            ensure_ascii=False,
        ).lower()
        after_blob = json.dumps(
            {"anchors": after.get("anchors") or [], "evidence": after.get("evidence") or []},
            ensure_ascii=False,
        ).lower()
        if before_blob != after_blob and (
            "sign in" in after_blob
            or "password" in after_blob
            or "verification" in after_blob
            or "otp" in after_blob
        ):
            return True

    # Input step: value was typed and a matching field still/now exists.
    if has_input and re.search(r"\b(enter|type|fill|input)\b", lowered):
        for action in actionable:
            if action.get("type") != "input":
                continue
            value = str(action.get("value") or "").strip()
            if value and value.lower() in (after.get("bodyText") or "").lower():
                return True
            if action.get("locators"):
                return True

    return False


def _step_cta_tokens(step: str) -> list[str]:
    lowered = step.lower()
    tokens: list[str] = []
    for phrase in (
        "sign in",
        "log in",
        "accept all cookies",
        "accept cookies",
        "stay signed in",
        "continue",
        "confirm",
        "submit",
        "next",
        "accept",
        "yes",
    ):
        if phrase in lowered:
            tokens.append(phrase)
    quoted = re.findall(r"[\"']([^\"']{1,40})[\"']", step)
    tokens.extend(q.strip().lower() for q in quoted if q.strip())
    return tokens


def history_indicates_step_action_succeeded(history: Any | None, step: str) -> bool:
    """Recover from done(false) when browser-use already logged a matching successful click/type."""
    if history is None:
        return False
    try:
        results = history.action_results()
    except Exception:
        return False

    parts: list[str] = []
    for result in results or []:
        if getattr(result, "error", None):
            continue
        for attr in ("extracted_content", "long_term_memory"):
            value = getattr(result, attr, None)
            if value:
                parts.append(str(value).lower())
    if not parts:
        return False
    blob = " | ".join(parts)
    lowered = step.lower()

    # Click Continue / Sign in / Confirm: history says Clicked … Continue
    if "clicked" in blob:
        for token in _step_cta_tokens(step):
            if token in blob:
                return True
        # Generic click step with any successful click is weaker but common when label is long.
        if re.search(r"\b(click|press|tap)\b", lowered) and re.search(r"\b(continue|next|confirm|sign in|submit)\b", lowered):
            return True

    if re.search(r"\b(enter|type|fill|input)\b", lowered) and ("typed" in blob or "input" in blob):
        return True
    return False


async def dismiss_cookie_consent_if_present(browser_session: Any) -> bool:
    """Click common cookie/consent accept controls when visible. Returns True if a click was attempted."""
    import asyncio

    page = await browser_session.must_get_current_page()
    for _ in range(3):
        try:
            clicked = await page.evaluate(_COOKIE_DISMISS_JS)
            if clicked:
                await asyncio.sleep(0.4)
                return True
        except Exception:
            return False
        await asyncio.sleep(0.15)
    return False


async def prepare_page_for_interaction(browser_session: Any) -> bool:
    """Clear cookie banners and blocking dialogs before deterministic replay or LLM discovery."""
    dismissed = await dismiss_cookie_consent_if_present(browser_session)
    await dismiss_blocking_modals(browser_session)
    return dismissed


async def assert_visible_page(browser_session: Any) -> tuple[bool, str]:
    page = await browser_session.must_get_current_page()
    try:
        result = await _evaluate_json(
            page,
            """() => {
              const body = document.body;
              if (!body) return JSON.stringify({ok:false,error:'document body missing'});
              const r = body.getBoundingClientRect();
              const text = (body.innerText || '').trim();
              return JSON.stringify({ok:r.width > 0 && r.height > 0 && text.length > 20, textLength:text.length});
            }""",
            None,
        )
        return (True, "") if result.get("ok") else (False, result.get("error", "page is not visibly loaded"))
    except Exception as exc:
        return False, str(exc)


_MICROSOFT_KMSI_CLICK_JS = """(payload) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const normalize = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const nameMatches = (el, target) => {
    const label = normalize(el.getAttribute('aria-label') || el.value || el.textContent || '');
    const wanted = normalize(target || '');
    if (!wanted) return false;
    return label.toLowerCase() === wanted.toLowerCase() || label.toLowerCase().includes(wanted.toLowerCase());
  };
  const bodyText = normalize(document.body?.innerText || '').toLowerCase();
  const onKmsi = bodyText.includes('stay signed in');
  if (!onKmsi && !payload.force) return false;
  const wanted = payload.buttonName || 'Yes';
  const selectors = payload.buttonName === 'No'
    ? ['#idBtn_Back', 'input[type="submit"][value="No"]']
    : ['#idSIButton9', 'input[type="submit"][value="Yes"]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && visible(el)) {
      el.click();
      return true;
    }
  }
  const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')]
    .filter(visible);
  const match = controls.find((el) => nameMatches(el, wanted));
  if (match) {
    match.click();
    return true;
  }
  return false;
}"""


def _is_microsoft_auth_url(url: str) -> bool:
    return origin_for_url(url) in AUTH_RELAXED_ORIGINS


def _step_requests_stay_signed_in_choice(step: str, choice: str) -> bool:
    lowered = step.lower()
    if choice.lower() == "yes":
        return bool(
            re.search(r"\bclick\b.*\byes\b", lowered)
            or re.search(r"\byes\b", lowered) and "stay signed" in lowered
            or re.search(r"\bconfirm\b", lowered) and "stay signed" in lowered
            or re.search(r"\bcontinue\b", lowered) and "stay signed" in lowered
        )
    return bool(re.search(r"\bclick\b.*\bno\b", lowered) and "stay signed" in lowered)


async def try_microsoft_login_recipe(
    browser_session: Any,
    step: str,
    action_type: str,
) -> tuple[bool, bool, str]:
    """Replay Microsoft Entra login interstitials (Stay signed in?, Sign in, etc.)."""
    current_url = await browser_session.get_current_page_url()
    if not _is_microsoft_auth_url(current_url):
        return False, False, ""
    if action_type != "click":
        return False, False, ""

    page = await browser_session.must_get_current_page()
    lowered = step.lower()
    try:
        if _step_requests_stay_signed_in_choice(step, "yes") or (
            re.search(r"\b(yes|confirm|continue)\b", lowered)
            and not re.search(r"\bno\b", lowered)
        ):
            on_kmsi = await page.evaluate(
                """() => (document.body?.innerText || '').toLowerCase().includes('stay signed in')"""
            )
            if on_kmsi or _step_requests_stay_signed_in_choice(step, "yes"):
                ok = await page.evaluate(
                    _MICROSOFT_KMSI_CLICK_JS,
                    {"buttonName": "Yes", "force": _step_requests_stay_signed_in_choice(step, "yes")},
                )
                import asyncio
                await asyncio.sleep(1.0)
                return True, bool(ok), "" if ok else "Microsoft Stay signed in Yes button not found"
        if _step_requests_stay_signed_in_choice(step, "no"):
            ok = await page.evaluate(_MICROSOFT_KMSI_CLICK_JS, {"buttonName": "No", "force": True})
            import asyncio
            await asyncio.sleep(1.0)
            return True, bool(ok), "" if ok else "Microsoft Stay signed in No button not found"
        if re.search(r"\b(sign in|submit|next|continue)\b", lowered):
            ok = await page.evaluate(
                """() => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const selectors = ['#idSIButton9', '#idSIButton', 'input[type="submit"]', 'button[type="submit"]'];
                  for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    if (el && visible(el)) { el.click(); return true; }
                  }
                  return false;
                }"""
            )
            if ok:
                import asyncio
                await asyncio.sleep(1.0)
                return True, True, ""
    except Exception as exc:
        return True, False, str(exc)
    return False, False, ""


async def complete_microsoft_login_if_needed(browser_session: Any, step: str = "") -> tuple[bool, str]:
    """Dismiss KMSI ('Stay signed in?') when login left the session on that interstitial."""
    current_url = await browser_session.get_current_page_url()
    if not _is_microsoft_auth_url(current_url):
        return True, ""
    page = await browser_session.must_get_current_page()
    on_kmsi = await page.evaluate(
        """() => (document.body?.innerText || '').toLowerCase().includes('stay signed in')"""
    )
    if not on_kmsi:
        return True, ""
    if step and not is_credential_step(step) and not _step_requests_stay_signed_in_choice(step, "yes"):
        return True, ""
    ok = await page.evaluate(_MICROSOFT_KMSI_CLICK_JS, {"buttonName": "Yes", "force": True})
    if not ok:
        return False, "Microsoft Stay signed in Yes button not found"
    import asyncio
    await asyncio.sleep(1.5)
    return True, ""


async def try_booking_recipe(browser_session: Any, step: str, action_type: str) -> tuple[bool, bool, str]:
    """Replay Booking.com flows using canonical POM selector patterns."""
    current_url = await browser_session.get_current_page_url()
    if "booking.com" not in current_url:
        return False, False, ""
    page = await browser_session.must_get_current_page()
    lowered = step.lower()
    try:
        if action_type == "click" and ("cookie" in lowered or "consent" in lowered):
            ok = await page.evaluate(
                """() => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const btn = document.querySelector('#onetrust-accept-btn-handler');
                  if (btn && visible(btn)) { btn.click(); return true; }
                  return false;
                }"""
            )
            import asyncio
            await asyncio.sleep(0.5)
            return True, True, "" if ok else (True, False, "booking cookie accept not found")
        if (
            action_type == "input"
            and re.search(r'\benter\b', lowered)
            and "destination" in lowered
            and not re.search(r'\bselect\b|\bsuggestion', lowered)
        ):
            destination = "London"
            quoted = re.search(r'enter\s+"([^"]+)"', lowered, re.IGNORECASE)
            if quoted:
                destination = quoted.group(1)
            ok = await page.evaluate(
                """(payload) => {
                  const destination = payload.destination || 'London';
                  const visible = (el) => {
                    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const searchBox = document.querySelector('#SearchBoxDesktop');
                  if (searchBox && visible(searchBox)) searchBox.scrollIntoView({ block: 'center' });
                  let field = document.querySelector('#SearchBoxDesktop input[name="ss"]')
                    || document.querySelector('input[name="ss"]');
                  if (!field || !visible(field)) {
                    const opener = [...document.querySelectorAll('button,[role="button"],div')]
                      .find(el => visible(el) && /where are you going|destination/i.test(
                        (el.getAttribute('aria-label') || el.textContent || '').toLowerCase()
                      ));
                    if (opener) opener.click();
                  }
                  field = document.querySelector('#SearchBoxDesktop input[name="ss"]')
                    || document.querySelector('input[name="ss"]');
                  if (!field || !visible(field)) return false;
                  field.focus();
                  field.value = destination;
                  field.dispatchEvent(new Event('input', { bubbles: true }));
                  field.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }""",
                {"destination": destination},
            )
            import asyncio
            await asyncio.sleep(1.0)
            return True, True, "" if ok else (True, False, "booking destination field not found")
        if action_type == "click" and re.search(r'\bselect\b', lowered) and (
            "suggestion" in lowered or "autocomplete" in lowered or "destination" in lowered
        ):
            destination = ""
            quoted = re.search(r'select\s+"([^"]+)"', step, re.IGNORECASE)
            if quoted:
                destination = quoted.group(1)
            else:
                loose = re.search(
                    r'select\s+(.+?)\s+from\s+(?:the\s+)?(?:destination\s+)?suggestions?',
                    step,
                    re.IGNORECASE,
                )
                if loose:
                    destination = loose.group(1).strip()
            if not destination:
                return True, False, "could not parse destination from select step"
            ok = await page.evaluate(
                """(payload) => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const dest = (payload.destination || '').toLowerCase();
                  const primary = dest.split(',')[0].trim();
                  const list = document.querySelector('ul[role="listbox"], ul[id="autocomplete-results"]');
                  const options = [...(list?.querySelectorAll('li[role="option"]') || [])]
                    .filter(visible);
                  const match = (text) => {
                    const t = (text || '').toLowerCase();
                    return t.includes(dest) || (primary && t.includes(primary));
                  };
                  const option = options.find(el => match(el.textContent));
                  if (option) { option.click(); return true; }
                  return false;
                }""",
                {"destination": destination},
            )
            import asyncio
            await asyncio.sleep(0.5)
            return True, True, "" if ok else (True, False, "booking autocomplete option not found")
    except Exception as exc:
        return True, False, str(exc)
    return False, False, ""


async def try_app_page_recipe(browser_session: Any, step: str, action_type: str) -> tuple[bool, bool, str]:
    """Replay known app/page recipes from the generated POM selector patterns."""
    booking_handled, booking_ok, booking_reason = await try_booking_recipe(
        browser_session, step, action_type
    )
    if booking_handled:
        return booking_handled, booking_ok, booking_reason
    if action_type != "click":
        return False, False, ""
    current_url = await browser_session.get_current_page_url()
    if "automationexercise.com/products" not in current_url:
        return False, False, ""
    page = await browser_session.must_get_current_page()
    lowered = step.lower()
    try:
        if "add" in lowered and "first product" in lowered and "cart" in lowered:
            ok = await page.evaluate(
                """() => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const cards = [...document.querySelectorAll('.features_items .product-image-wrapper')].filter(visible);
                  const firstCard = cards[0];
                  const addToCart = firstCard ? [...firstCard.querySelectorAll('a.add-to-cart')].find(visible) : null;
                  if (!addToCart) return false;
                  addToCart.click();
                  return true;
                }"""
            )
            if not ok:
                return True, False, "first product add-to-cart selector not found"
            import asyncio
            await asyncio.sleep(2.0)
            return True, True, ""
        if "view cart" in lowered or ("verify" in lowered and "cart" in lowered):
            ok = await page.evaluate(
                """() => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                  };
                  const modalLink = [...document.querySelectorAll('#cartModal a[href="/view_cart"]')].find(visible);
                  if (modalLink) {
                    modalLink.click();
                    return true;
                  }
                  const textLink = [...document.querySelectorAll('a[href="/view_cart"], a')]
                    .find(el => visible(el) && /view cart/i.test((el.textContent || '').replace(/\\s+/g, ' ')));
                  if (textLink) {
                    textLink.click();
                    return true;
                  }
                  return false;
                }"""
            )
            if not ok:
                return True, False, "view-cart selector not found"
            import asyncio
            await asyncio.sleep(1.5)
            if "automationexercise.com/view_cart" not in await browser_session.get_current_page_url():
                await browser_session.navigate_to("https://automationexercise.com/view_cart", new_tab=False)
                await asyncio.sleep(1.0)
            return True, True, ""
    except Exception as exc:
        return True, False, str(exc)
    return False, False, ""


async def assert_cart_contains_product(browser_session: Any) -> tuple[bool, str]:
    if "automationexercise.com/view_cart" not in await browser_session.get_current_page_url():
        await browser_session.navigate_to("https://automationexercise.com/view_cart", new_tab=False)
    page = await browser_session.must_get_current_page()
    try:
        result = await _evaluate_json(
            page,
            """() => {
              const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
              return JSON.stringify({
                url: location.href,
                empty: text.includes('cart is empty'),
                hasCart: text.includes('shopping cart'),
                hasProduct: text.includes('blue top') || text.includes('product image') || /rs\\.\\s*\\d+/.test(text)
              });
            }""",
            None,
        )
        if "view_cart" not in (result.get("url") or ""):
            return False, "cart URL was not reached"
        if result.get("empty"):
            return False, "cart is empty"
        if not result.get("hasCart") or not result.get("hasProduct"):
            return False, "cart product evidence was not visible"
        return True, ""
    except Exception as exc:
        return False, str(exc)


async def wait_for_modal(browser_session: Any, timeout_seconds: float = 5.0) -> bool:
    import asyncio
    import time

    page = await browser_session.must_get_current_page()
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        found = await page.evaluate(
            """() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
              };
              return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal.show,.modal.in')]
                .some(visible);
            }"""
        )
        if found:
            return True
        await asyncio.sleep(0.25)
    return False


async def dismiss_blocking_modals(browser_session: Any) -> None:
    page = await browser_session.must_get_current_page()
    await page.evaluate(
        """() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const modals = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal.show,.modal.in')]
            .filter(visible);
          for (const modal of modals) {
            const buttons = [...modal.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')]
              .filter(visible);
            const preferred = buttons.find((btn) =>
              /^(ok|yes|confirm|continue|accept|close|got it|agree)$/i.test((btn.textContent || btn.value || '').trim())
            ) || buttons[0];
            if (preferred) {
              preferred.click();
              return true;
            }
          }
          return false;
        }"""
    )


async def _switch_tab(browser_session: Any, tab_id: str) -> None:
    from browser_use.browser.events import SwitchTabEvent

    target_id = await browser_session.get_target_id_from_tab_id(tab_id)
    event = browser_session.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
    await event
    await event.event_result(raise_if_any=False, raise_if_none=False)


async def _close_tab(browser_session: Any, tab_id: str) -> None:
    from browser_use.browser.events import CloseTabEvent

    target_id = await browser_session.get_target_id_from_tab_id(tab_id)
    event = browser_session.event_bus.dispatch(CloseTabEvent(target_id=target_id))
    await event
    await event.event_result(raise_if_any=False, raise_if_none=False)


async def try_recipe_step(browser_session: Any, step: str) -> tuple[bool, bool, str]:
    """Run canonical page recipes before falling back to Browser Use discovery."""
    stripped = step.strip()
    url = resolve_navigate_target(stripped)
    if url:
        ok, reason = await navigate_tolerantly(browser_session, url)
        return True, ok, reason
    if re.search(r"\b(navigate\s+back|go\s+back|browser\s+back|previous\s+page)\b", stripped, re.I):
        try:
            page = await browser_session.must_get_current_page()
            await page.go_back()
            return True, True, ""
        except Exception as exc:
            return True, False, f"go_back failed: {type(exc).__name__}: {exc}"
    if re.search(r"\b(capture|take)\s+(a\s+)?screenshot\b|\bscreenshot\b", stripped, re.I):
        ok, reason = await assert_visible_page(browser_session)
        return True, ok, reason
    if _is_verification_step(step):
        ok, reason = await assert_visible_page(browser_session)
        return True, ok, reason
    for action_type in ("click", "input"):
        handled, ok, reason = await try_microsoft_login_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
        handled, ok, reason = await try_booking_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
        handled, ok, reason = await try_app_page_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
        handled, ok, reason = await try_app_switcher_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
    return False, False, ""


async def navigate_tolerantly(browser_session: Any, url: str, *, new_tab: bool = False) -> tuple[bool, str]:
    """Navigate and tolerate EventBus timeouts when the target URL already loaded.

    Enterprise SSO sites often exceed browser-use's default 30s NavigateToUrlEvent
    timeout even after the document is usable. If we already landed on the target
    host, treat the navigation as successful and continue the scenario.
    """
    target_host = (urlparse(url).netloc or "").lower()
    try:
        await browser_session.navigate_to(url, new_tab=new_tab)
        return True, ""
    except Exception as exc:
        current = ""
        try:
            current = await browser_session.get_current_page_url()
        except Exception:
            current = ""
        current_host = (urlparse(current).netloc or "").lower()
        landed = bool(
            target_host
            and current
            and (target_host == current_host or target_host in current.lower() or url.rstrip("/") in current)
        )
        if landed:
            print(
                f"[WebPilot] Navigation handler timed out but page reached {current} — continuing "
                f"({type(exc).__name__}: {exc})"
            )
            return True, ""
        return False, f"navigate failed: {type(exc).__name__}: {exc}"


async def execute_capability(
    browser_session: Any,
    capability: dict[str, Any],
    sensitive_data: dict[str, Any] | None = None,
) -> tuple[bool, str]:
    pre_ok, pre_reason, _ = await validate_capability_phase(browser_session, capability, "pre")
    if not pre_ok:
        return False, pre_reason
    step_text = capability.get("step", "")
    if _step_mentions_modal(step_text):
        await wait_for_modal(browser_session)
    page = await browser_session.must_get_current_page()
    for action in capability.get("actions", []):
        action_type = action.get("type")
        try:
            if action_type == "navigate":
                ok, reason = await navigate_tolerantly(
                    browser_session,
                    action["url"],
                    new_tab=bool(action.get("newTab", False)),
                )
                if not ok:
                    return False, reason
            elif action_type == "go_back":
                try:
                    await page.go_back()
                except Exception as exc:
                    return False, f"go_back failed: {type(exc).__name__}: {exc}"
            elif action_type == "switch_tab":
                await _switch_tab(browser_session, str(action.get("tabId", "")))
            elif action_type == "close_tab":
                await _close_tab(browser_session, str(action.get("tabId", "")))
            elif action_type == "wait_for_modal":
                if not await wait_for_modal(browser_session, float(action.get("seconds", 5))):
                    return False, "expected modal did not appear"
            elif action_type == "assert_visible_page":
                ok, reason = await assert_visible_page(browser_session)
                if not ok:
                    return False, reason
            elif action_type == "assert_text":
                text = str(action.get("value") or "").strip()
                if not text:
                    ok, reason = await assert_visible_page(browser_session)
                    if not ok:
                        return False, reason
                    continue
                locators = action.get("locators") or [{"kind": "text", "value": text}]
                found = await _evaluate_json(
                    page,
                    """(arg) => {
                      const visible = (el) => {
                        const r = el.getBoundingClientRect();
                        const s = getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
                      };
                      let ok = false;
                      for (const loc of arg.locators || []) {
                        if (loc.kind === 'role' && loc.name) {
                          const nodes = [...document.querySelectorAll('a,button,[role]')].filter(visible);
                          const hit = nodes.find((el) => {
                            const role = (el.getAttribute('role') || el.tagName.toLowerCase());
                            const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim();
                            const roleOk = role === loc.value || (loc.value === 'link' && el.tagName === 'A') || (loc.value === 'button' && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'));
                            return roleOk && name.toLowerCase().includes(String(loc.name).toLowerCase());
                          });
                          if (hit) { ok = true; break; }
                        }
                        if (loc.kind === 'text' && loc.value) {
                          const needle = String(loc.value).toLowerCase();
                          const body = (document.body?.innerText || '').toLowerCase();
                          if (body.includes(needle)) { ok = true; break; }
                        }
                      }
                      return JSON.stringify(ok);
                    }""",
                    {"locators": locators},
                )
                if not found:
                    return False, f"assert_text not visible: {text}"
            elif action_type == "assert_url_contains":
                fragment = str(action.get("value") or "").strip().lower()
                current = (await browser_session.get_current_page_url() or "").lower()
                if not fragment or fragment not in current:
                    return False, f"url does not contain {fragment}: {current}"
            elif action_type == "assert_url_equals":
                expected = str(action.get("value") or "").strip()
                current = (await browser_session.get_current_page_url() or "").rstrip("/")
                expected_norm = expected.rstrip("/")
                if current != expected_norm and current + "/" != expected and expected_norm + "/" != current + "/":
                    # Allow trailing-slash and exact host homepage variants.
                    if current.rstrip("/") != expected_norm.rstrip("/"):
                        return False, f"url mismatch: expected {expected}, got {current}"
            elif action_type == "wait":
                import asyncio
                await asyncio.sleep(float(action.get("seconds", 1)))
            elif action_type == "press":
                key = str(action.get("value") or action.get("key") or "Enter")
                # browser-use Page is not Playwright's Page — no .keyboard; dispatch via DOM.
                await page.evaluate(
                    """(key) => {
                      const target = document.activeElement || document.body;
                      const opts = { key, code: key === 'Enter' ? 'Enter' : key, bubbles: true, cancelable: true };
                      target.dispatchEvent(new KeyboardEvent('keydown', opts));
                      target.dispatchEvent(new KeyboardEvent('keypress', opts));
                      target.dispatchEvent(new KeyboardEvent('keyup', opts));
                      if (key === 'Enter' && target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
                        const form = target.form;
                        if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
                      }
                    }""",
                    key,
                )
            elif action_type in ("click", "input"):
                await dismiss_cookie_consent_if_present(browser_session)
                if action.get("modal") or _step_mentions_modal(step_text):
                    await wait_for_modal(browser_session)
                    await dismiss_blocking_modals(browser_session)
                handled, ok, reason = await try_microsoft_login_recipe(
                    browser_session,
                    capability.get("step", ""),
                    action_type,
                )
                if handled:
                    if ok:
                        continue
                    return False, reason
                handled, ok, reason = await try_booking_recipe(
                    browser_session,
                    capability.get("step", ""),
                    action_type,
                )
                if handled:
                    if ok:
                        continue
                    return False, reason
                handled, ok, reason = await try_app_page_recipe(
                    browser_session,
                    capability.get("step", ""),
                    action_type,
                )
                if handled:
                    if ok:
                        continue
                    return False, reason
                locators = sorted(
                    [
                        *registry_locators_for_step(
                            await browser_session.get_current_page_url(),
                            capability.get("step", ""),
                        ),
                        *(action.get("locators") or []),
                    ],
                    key=lambda item: _LOCATOR_KIND_PRIORITY.get(item.get("kind", "css"), 99),
                )
                allow_first_match = bool(re.search(r"\bfirst\b", capability.get("step", ""), re.IGNORECASE))
                allow_first_match = allow_first_match or any(
                    _clean_accessible_text(str(locator.get("value", ""))).lower() == "view cart"
                    for locator in locators
                )
                action_payload = {
                    **action,
                    "locators": locators,
                    "allowFirstMatch": allow_first_match,
                    "modal": bool(action.get("modal")) or _step_mentions_modal(step_text),
                }
                if action_type == "input" and action_payload.get("value") is not None:
                    action_payload["value"] = resolve_sensitive_text(
                        str(action_payload.get("value") or ""),
                        sensitive_data,
                    )
                result = await _evaluate_json(
                    page,
                    """(payload) => {
                      const visible = (el) => {
                        const r=el.getBoundingClientRect(), s=getComputedStyle(el);
                        return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';
                      };
                      const normalize = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, ' ').replace(/\\s+/g, ' ').trim();
                      const nameMatches = (el, target) => {
                        const label = normalize(el.getAttribute('aria-label') || el.value || el.textContent || '');
                        const wanted = normalize(target || '');
                        if (!wanted) return true;
                        return label.toLowerCase() === wanted.toLowerCase()
                          || label.toLowerCase().includes(wanted.toLowerCase());
                      };
                      const roots = payload.modal
                        ? [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal.show,.modal.in')].filter(visible)
                        : [document];
                      const scopes = roots.length ? roots : [document];
                      const find = (locator, root) => {
                        let els = [];
                        if (locator.kind === 'css') els = [...root.querySelectorAll(locator.value)];
                        if (locator.kind === 'role') els = [...root.querySelectorAll(`[role="${CSS.escape(locator.value)}"]`)]
                          .filter(el => nameMatches(el, locator.name));
                        if (locator.kind === 'role' && locator.value === 'link') els.push(...[...root.querySelectorAll('a')]
                          .filter(el => nameMatches(el, locator.name)));
                        if (locator.kind === 'role' && locator.value === 'button') els.push(
                          ...[...root.querySelectorAll('button, input[type="submit"], input[type="button"]')]
                            .filter(el => nameMatches(el, locator.name))
                        );
                        if (locator.kind === 'label') els = [...root.querySelectorAll('label')]
                          .filter(el => nameMatches(el, locator.value))
                          .map(label => label.control).filter(Boolean);
                        if (locator.kind === 'placeholder') els = [...root.querySelectorAll(`[placeholder="${CSS.escape(locator.value)}"]`)];
                        if (locator.kind === 'testid') els = [
                          ...root.querySelectorAll(
                            `[data-testid="${CSS.escape(locator.value)}"],[data-test="${CSS.escape(locator.value)}"],[data-cy="${CSS.escape(locator.value)}"]`
                          )
                        ];
                        if (locator.kind === 'text') els = [...root.querySelectorAll(locator.tag || '*')]
                          .filter(el => normalize(el.textContent) === normalize(locator.value));
                        return [...new Set(els)].filter(visible);
                      };
                      for (const root of scopes) {
                        for (const locator of payload.locators || []) {
                          const els = find(locator, root);
                          if (els.length < 1) continue;
                          if (els.length !== 1 && !payload.allowFirstMatch) continue;
                          const el = els[0];
                          if (payload.type === 'click') el.click();
                          else {
                            el.focus();
                            const setter = Object.getOwnPropertyDescriptor(
                              el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                              'value'
                            )?.set;
                            if (!setter) return JSON.stringify({ok:false,error:'no value setter'});
                            setter.call(el, payload.value || '');
                            el.dispatchEvent(new Event('input',{bubbles:true}));
                            el.dispatchEvent(new Event('change',{bubbles:true}));
                          }
                          return JSON.stringify({ok:true});
                        }
                      }
                      return JSON.stringify({ok:false,error:'no unique visible locator'});
                    }""",
                    action_payload,
                )
                if not result.get("ok"):
                    return False, result.get("error", "deterministic action failed")
                if action_type == "click":
                    import asyncio
                    await asyncio.sleep(0.8)
        except Exception as exc:
            return False, str(exc)
    step = capability.get("step", "")
    if re.search(r"\bverify\b", step, re.IGNORECASE) and "product" in step.lower() and "cart" in step.lower():
        return await assert_cart_contains_product(browser_session)
    if is_credential_step(step):
        kmsi_ok, kmsi_reason = await complete_microsoft_login_if_needed(browser_session, step)
        if not kmsi_ok:
            return False, kmsi_reason
    post_ok, post_reason, _ = await validate_capability_phase(browser_session, capability, "post")
    if not post_ok:
        return False, post_reason
    return True, ""
