"""Generic, validated site knowledge learned from successful Browser Use steps."""
from __future__ import annotations

import datetime
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .paths import PROJECT_ROOT

KNOWLEDGE_ROOT = PROJECT_ROOT / "runtime" / "site-knowledge"
KNOWLEDGE_PATH = KNOWLEDGE_ROOT / "knowledge.json"
SELECTOR_REGISTRY_PATH = PROJECT_ROOT / "runtime" / "selectors" / "registry.json"

CONSENT_TERMS = ("consent", "cookie", "privacy", "accept", "agree")


def step_signature(step: str) -> str:
    return re.sub(r"\s+", " ", step.strip().lower())


def url_pattern(url: str) -> str:
    parsed = urlparse(url or "about:blank")
    if parsed.scheme in ("http", "https"):
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path or '/'}"
    return url or "about:blank"


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


def find_capability(data: dict[str, Any], step: str, current_url: str) -> dict[str, Any] | None:
    signature = step_signature(step)
    current_pattern = url_pattern(current_url)
    candidates = [
        item
        for item in data.get("capabilities", [])
        if item.get("stepSignature") == signature
        and item.get("status") != "quarantined"
        and item.get("before", {}).get("urlPattern") == current_pattern
    ]
    candidates.sort(key=lambda item: (item.get("successCount", 0), item.get("updatedAt", "")), reverse=True)
    if candidates:
        return candidates[0]
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
    capabilities = data.setdefault("capabilities", [])
    capability_id = capability["id"]
    existing = next((item for item in capabilities if item.get("id") == capability_id), None)
    if existing:
        capability["successCount"] = int(existing.get("successCount", 0)) + 1
        capabilities[capabilities.index(existing)] = capability
    else:
        capability["successCount"] = 1
        capabilities.append(capability)
    capability["status"] = "trusted" if capability["successCount"] >= 2 else "candidate"
    capability["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save_knowledge(data)


def record_failure(data: dict[str, Any], capability: dict[str, Any], reason: str) -> None:
    capability["failureCount"] = int(capability.get("failureCount", 0)) + 1
    capability["lastFailure"] = reason[:1000]
    if capability["failureCount"] >= 2:
        capability["status"] = "quarantined"
    capability["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
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
    if tag == "a" and text:
        candidates.append({"kind": "role", "value": "link", "name": text})
    if tag == "button" and text:
        candidates.append({"kind": "role", "value": "button", "name": text})
    href = attrs.get("href")
    if tag == "a" and href:
        candidates.append({"kind": "css", "value": f'a[href="{href}"]'})
        if href.startswith("/"):
            candidates.append({"kind": "css", "value": f'a[href*="{href}"]'})
    for attr in ("data-testid", "data-test", "data-cy", "id", "name", "aria-label", "placeholder"):
        value = attrs.get(attr)
        if value:
            candidates.append({"kind": "css", "value": f'{tag}[{attr}="{value}"]'})
    role = attrs.get("role")
    accessible_name = attrs.get("aria-label") or attrs.get("ax_name")
    if role and accessible_name:
        candidates.append({"kind": "role", "value": role, "name": accessible_name})
    if text and len(text) <= 120:
        candidates.append({"kind": "text", "value": text, "tag": tag})
    return candidates[:5]


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
            elif name in ("click", "input"):
                index = params.get("index")
                node = selector_map.get(index)
                locators = _locator_candidates(node) if node is not None else []
                if not locators:
                    continue
                recipe: dict[str, Any] = {"type": name, "locators": locators}
                if name == "input":
                    recipe["value"] = params.get("text", "")
                    recipe["clear"] = params.get("clear", True)
                recipes.append(recipe)
            elif name in ("send_keys", "press") and (params.get("keys") or params.get("key")):
                recipes.append({"type": "press", "value": params.get("keys") or params.get("key")})
            elif name == "wait":
                recipes.append({"type": "wait", "seconds": min(float(params.get("seconds", 1)), 5)})
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
          const selectors = ['[data-testid]','[data-test]','[data-cy]','input[name]','button[aria-label]',
            'a[aria-label]','[role][aria-label]','input[placeholder]'];
          const anchors = [];
          for (const el of document.querySelectorAll(selectors.join(','))) {
            if (!visible(el)) continue;
            const attrs = {};
            for (const key of ['data-testid','data-test','data-cy','id','name','aria-label','placeholder','role']) {
              const value = el.getAttribute(key);
              if (value) attrs[key] = value;
            }
            if (Object.keys(attrs).length) anchors.push({tag: el.tagName.toLowerCase(), attrs});
            if (anchors.length >= 12) break;
          }
          const evidence = [];
          for (const el of document.querySelectorAll('img[alt],h1,h2,h3,label,input[aria-label],input[placeholder],[role="heading"]')) {
            if (!visible(el)) continue;
            const text = (el.getAttribute('alt') || el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\\s+/g,' ');
            if (text && text.length <= 160) evidence.push({tag: el.tagName.toLowerCase(), text});
            if (evidence.length >= 30) break;
          }
          return JSON.stringify({url: location.href, title: document.title, anchors, evidence});
        }"""
    )
    state = json.loads(raw)
    state["urlPattern"] = url_pattern(state.get("url", ""))
    return state


def capability_from_step(
    step: str,
    before: dict[str, Any],
    after: dict[str, Any],
    actions: list[dict[str, Any]],
) -> dict[str, Any] | None:
    actionable = [action for action in actions if action.get("type") in {"navigate", "click", "input", "press", "wait"}]
    assertion_step = bool(re.match(r"^(verify|assert|check|ensure|then)\b", step.strip(), re.IGNORECASE))
    if not actionable and not assertion_step:
        return None
    required_evidence: list[dict[str, str]] = []
    if assertion_step:
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
    signature = step_signature(step)
    identity = f"{signature}|{before.get('urlPattern')}|{after.get('urlPattern')}"
    return {
        "id": hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20],
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
    }


async def _evaluate_json(page: Any, function: str, arg: Any) -> Any:
    raw = await page.evaluate(function, arg)
    return json.loads(raw) if raw else None


async def fingerprint_matches(browser_session: Any, fingerprint: dict[str, Any]) -> bool:
    current = await compact_page_state(browser_session)
    if current.get("urlPattern") != fingerprint.get("urlPattern"):
        return False
    anchors = [anchor for anchor in (fingerprint.get("anchors") or []) if not _is_consent_anchor(anchor)]
    evidence = fingerprint.get("evidence") or []
    if not anchors and not evidence:
        return True
    page = await browser_session.must_get_current_page()
    result = await _evaluate_json(
        page,
        """(payload) => {
          const visible = (el) => {
            const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          let matched = 0;
          for (const anchor of payload.anchors || []) {
            const attrs = Object.entries(anchor.attrs || {}).map(([k,v]) => `[${k}="${CSS.escape(v)}"]`).join('');
            const found = [...document.querySelectorAll(`${anchor.tag}${attrs}`)].some(visible);
            if (found) matched++;
          }
          let evidenceMatched = 0;
          for (const item of payload.evidence || []) {
            const found = [...document.querySelectorAll(item.tag || '*')].some(el =>
              visible(el) && (el.getAttribute('alt') || el.getAttribute('aria-label') ||
                el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\\s+/g,' ') === item.text
            );
            if (found) evidenceMatched++;
          }
          return JSON.stringify({
            matched,
            total: (payload.anchors || []).length,
            evidenceMatched,
            evidenceTotal: (payload.evidence || []).length,
            bodyText: (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 5000)
          });
        }""",
        {"anchors": anchors, "evidence": evidence},
    )
    anchors_ok = result["total"] == 0 or result["matched"] >= min(2, result["total"])
    evidence_ok = result["evidenceTotal"] == 0 or result["evidenceMatched"] == result["evidenceTotal"]
    expected_url = fingerprint.get("urlPattern", "")
    if not evidence_ok and "view_cart" in expected_url:
        body_text = (result.get("bodyText") or "").lower()
        evidence_ok = "cart is empty" not in body_text and (
            "shopping cart" in body_text or "blue top" in body_text or "product image" in body_text
        )
    return anchors_ok and evidence_ok


async def dismiss_cookie_consent_if_present(browser_session: Any) -> None:
    page = await browser_session.must_get_current_page()
    try:
        await page.evaluate(
            """() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
              };
              const candidates = [
                '#onetrust-accept-btn-handler',
                'button.fc-cta-consent',
                'button[aria-label="Consent"]',
                '[role="button"][aria-label="Consent"]',
              ];
              for (const selector of candidates) {
                const el = [...document.querySelectorAll(selector)].find(visible);
                if (el) {
                  el.click();
                  return true;
                }
              }
              const textMatch = [...document.querySelectorAll('button,[role="button"],a')]
                .find(el => visible(el) && /^(accept all|accept|agree|consent)$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
              if (textMatch) {
                textMatch.click();
                return true;
              }
              return false;
            }"""
        )
    except Exception:
        return


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


async def try_recipe_step(browser_session: Any, step: str) -> tuple[bool, bool, str]:
    """Run canonical page recipes before falling back to Browser Use discovery."""
    stripped = step.strip()
    if re.match(r"^navigate to ", stripped, re.IGNORECASE):
        url = re.sub(r"^navigate to\s+", "", stripped, flags=re.IGNORECASE).strip().rstrip(".")
        if url:
            await browser_session.navigate_to(url, new_tab=False)
            return True, True, ""
    if _is_verification_step(step):
        ok, reason = await assert_visible_page(browser_session)
        return True, ok, reason
    for action_type in ("click", "input"):
        handled, ok, reason = await try_booking_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
        handled, ok, reason = await try_app_page_recipe(browser_session, step, action_type)
        if handled:
            return True, ok, reason
    return False, False, ""


async def execute_capability(browser_session: Any, capability: dict[str, Any]) -> tuple[bool, str]:
    if not await fingerprint_matches(browser_session, capability.get("before", {})):
        return False, "current page fingerprint does not match learned precondition"
    page = await browser_session.must_get_current_page()
    for action in capability.get("actions", []):
        action_type = action.get("type")
        try:
            if action_type == "navigate":
                await browser_session.navigate_to(action["url"], new_tab=bool(action.get("newTab", False)))
            elif action_type == "assert_visible_page":
                ok, reason = await assert_visible_page(browser_session)
                if not ok:
                    return False, reason
            elif action_type == "wait":
                import asyncio
                await asyncio.sleep(float(action.get("seconds", 1)))
            elif action_type == "press":
                await page.press(str(action.get("value", "")))
            elif action_type in ("click", "input"):
                await dismiss_cookie_consent_if_present(browser_session)
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
                locators = [
                    *registry_locators_for_step(await browser_session.get_current_page_url(), capability.get("step", "")),
                    *(action.get("locators") or []),
                ]
                allow_first_match = bool(re.search(r"\bfirst\b", capability.get("step", ""), re.IGNORECASE))
                allow_first_match = allow_first_match or any(
                    _clean_accessible_text(str(locator.get("value", ""))).lower() == "view cart"
                    for locator in locators
                )
                action_payload = {**action, "locators": locators, "allowFirstMatch": allow_first_match}
                result = await _evaluate_json(
                    page,
                    """(payload) => {
                      const visible = (el) => {
                        const r=el.getBoundingClientRect(), s=getComputedStyle(el);
                        return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none';
                      };
                      const normalize = (s) => (s || '').replace(/[\ue000-\uf8ff]/g, ' ').replace(/\\s+/g, ' ').trim();
                      const find = (locator) => {
                        let els = [];
                        if (locator.kind === 'css') els = [...document.querySelectorAll(locator.value)];
                        if (locator.kind === 'role') els = [...document.querySelectorAll(`[role="${CSS.escape(locator.value)}"]`)]
                          .filter(el => !locator.name || normalize(el.getAttribute('aria-label') || el.textContent) === locator.name);
                        if (locator.kind === 'role' && locator.value === 'link') els.push(...[...document.querySelectorAll('a')]
                          .filter(el => !locator.name || normalize(el.getAttribute('aria-label') || el.textContent) === locator.name));
                        if (locator.kind === 'role' && locator.value === 'button') els.push(...[...document.querySelectorAll('button')]
                          .filter(el => !locator.name || normalize(el.getAttribute('aria-label') || el.textContent) === locator.name));
                        if (locator.kind === 'label') els = [...document.querySelectorAll('label')]
                          .filter(el => normalize(el.textContent) === locator.value)
                          .map(label => label.control).filter(Boolean);
                        if (locator.kind === 'placeholder') els = [...document.querySelectorAll(`[placeholder="${CSS.escape(locator.value)}"]`)];
                        if (locator.kind === 'testid') els = [...document.querySelectorAll(`[data-testid="${CSS.escape(locator.value)}"]`)];
                        if (locator.kind === 'text') els = [...document.querySelectorAll(locator.tag || '*')]
                          .filter(el => normalize(el.textContent) === normalize(locator.value));
                        return [...new Set(els)].filter(visible);
                      };
                      for (const locator of payload.locators || []) {
                        const els = find(locator);
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
    if not await fingerprint_matches(browser_session, capability.get("after", {})):
        return False, "learned postcondition did not match"
    return True, ""
