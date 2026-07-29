"""Origin-gated site rulebooks for discovery hints + learning distillation."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .paths import INSTALL_ROOT, PROJECT_ROOT, RUNTIME_ROOT

RULEBOOKS_ROOT = PROJECT_ROOT / "resources" / "rulebooks"
INSTALL_RULEBOOKS_ROOT = INSTALL_ROOT / "resources" / "rulebooks"
LEARNED_RULEBOOKS_ROOT = RUNTIME_ROOT / "rulebooks"

_SITE_PACK_META_RE = re.compile(r"^sitePack\s*:\s*(\S+)\s*$", re.I | re.M)
_DATA_ID_RE = re.compile(r"data-id[=\"'\\:\s]+([A-Za-z0-9_.\-:]+)", re.I)
_ARIA_RE = re.compile(r"aria-label[=\"'\\:\s]+([^\"'\\]]+)", re.I)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _rulebook_dirs() -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for root in (RULEBOOKS_ROOT, INSTALL_RULEBOOKS_ROOT):
        if not root.is_dir():
            continue
        resolved = root.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        out.append(resolved)
    return out


def list_pack_ids() -> list[str]:
    ids: set[str] = set()
    for root in _rulebook_dirs():
        for child in root.iterdir():
            if child.is_dir() and (child / "manifest.json").is_file():
                ids.add(child.name)
    return sorted(ids)


def _load_manifest(pack_id: str) -> dict[str, Any] | None:
    for root in _rulebook_dirs():
        path = root / pack_id / "manifest.json"
        if path.is_file():
            try:
                data = json.loads(_read_text(path))
            except json.JSONDecodeError:
                return None
            if isinstance(data, dict):
                data.setdefault("id", pack_id)
                return data
    return None


def _seed_path(pack_id: str) -> Path | None:
    for root in _rulebook_dirs():
        path = root / pack_id / "seed.md"
        if path.is_file():
            return path
    return None


def _learned_path(pack_id: str) -> Path:
    return LEARNED_RULEBOOKS_ROOT / pack_id / "learned.md"


def hostname_from_url(url: str | None) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "https://" + raw
    try:
        host = (urlparse(raw).hostname or "").lower().strip(".")
    except Exception:
        return ""
    if host.startswith("www."):
        return host[4:]
    return host


def parse_site_pack_override(text: str | None) -> str | None:
    """Read optional `sitePack: dynamics365` metadata from a scenario file."""
    if not text:
        return None
    match = _SITE_PACK_META_RE.search(text)
    if not match:
        return None
    pack = match.group(1).strip().strip("\"'").lower()
    return pack or None


def rulebooks_config() -> dict[str, Any]:
    """Read intelligentRunner.rulebooks from webpilot.yaml (best-effort)."""
    defaults = {"enabled": True, "autoLearn": True, "minSuccessCount": 2}
    try:
        import yaml

        cfg_path = PROJECT_ROOT / "resources" / "config" / "webpilot.yaml"
        if not cfg_path.is_file():
            cfg_path = INSTALL_ROOT / "resources" / "config" / "webpilot.yaml"
        if not cfg_path.is_file():
            return defaults
        raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        block = ((raw.get("intelligentRunner") or {}).get("rulebooks") or {})
        if not isinstance(block, dict):
            return defaults
        return {
            "enabled": bool(block.get("enabled", True)),
            "autoLearn": bool(block.get("autoLearn", True)),
            "minSuccessCount": int(block.get("minSuccessCount", 2) or 2),
        }
    except Exception:
        return defaults


def _origin_matches(host: str, manifest: dict[str, Any]) -> bool:
    if not host:
        return False
    origins = [str(o).lower().strip(".") for o in (manifest.get("origins") or []) if o]
    if host in origins or f"www.{host}" in origins:
        return True
    for origin in origins:
        if host == origin or host.endswith("." + origin):
            return True
    for suffix in manifest.get("originSuffixes") or []:
        s = str(suffix).lower()
        if not s:
            continue
        bare = s[1:] if s.startswith(".") else s
        if host == bare or host.endswith("." + bare) or host.endswith(bare):
            return True
    return False


def resolve_active_packs(
    *,
    url: str | None = None,
    site_pack: str | None = None,
) -> list[str]:
    """Return pack ids to inject: always generic + matched specialized packs."""
    host = hostname_from_url(url)
    override = (site_pack or "").strip().lower() or None
    packs: list[tuple[int, str]] = []

    for pack_id in list_pack_ids():
        manifest = _load_manifest(pack_id)
        if not manifest:
            continue
        always = bool(manifest.get("always"))
        priority = int(manifest.get("priority") or 0)
        if always:
            packs.append((priority, pack_id))
            continue
        if override and override == pack_id:
            packs.append((priority, pack_id))
            continue
        if override:
            # Explicit pack requested — skip other specialized packs.
            continue
        if _origin_matches(host, manifest):
            packs.append((priority, pack_id))

    packs.sort(key=lambda t: t[0])
    seen: set[str] = set()
    ordered: list[str] = []
    for _, pack_id in packs:
        if pack_id in seen:
            continue
        seen.add(pack_id)
        ordered.append(pack_id)
    if "generic" not in seen and _load_manifest("generic"):
        ordered.insert(0, "generic")
    return ordered


def load_pack_markdown(pack_id: str) -> str:
    parts: list[str] = []
    seed = _seed_path(pack_id)
    if seed:
        body = _read_text(seed).strip()
        if body:
            parts.append(body)
    learned = _learned_path(pack_id)
    if learned.is_file():
        body = _read_text(learned).strip()
        if body:
            parts.append("## Learned hints (from site-knowledge)\n\n" + body)
    return "\n\n".join(parts).strip()


@dataclass
class IntentAlias:
    """One NL/act intent with patterns and optional locator templates."""

    id: str
    nl_patterns: list[str] = field(default_factory=list)
    act_patterns: list[str] = field(default_factory=list)
    negative_act: list[str] = field(default_factory=list)
    locator_templates: list[dict[str, Any]] = field(default_factory=list)
    flags: dict[str, Any] = field(default_factory=dict)
    also_binds_optional: list[str] = field(default_factory=list)
    secret_families: list[str] = field(default_factory=list)
    testid_tokens: list[str] = field(default_factory=list)
    ground: dict[str, Any] | None = None
    search_page_bridges: list[dict[str, Any]] = field(default_factory=list)
    href_hints: list[str] = field(default_factory=list)
    score_bonus: int = 10

    def nl_matches(self, text: str) -> bool:
        return _any_pattern(self.nl_patterns, text)

    def act_matches(self, text: str) -> bool:
        if _any_pattern(self.negative_act, text):
            return False
        return _any_pattern(self.act_patterns, text)


@dataclass
class SiteVocab:
    """Merged structured vocabulary for compact NL↔act alignment."""

    schema_version: int = 1
    pack_ids: list[str] = field(default_factory=list)
    aliases: dict[str, IntentAlias] = field(default_factory=dict)
    optional_intents: list[str] = field(default_factory=list)
    exclusive_pairs: list[tuple[str, str]] = field(default_factory=list)
    url_tokens: dict[str, dict[str, Any]] = field(default_factory=dict)
    css_probes: dict[str, list[str]] = field(default_factory=dict)
    implies: dict[str, list[str]] = field(default_factory=dict)
    displayed_rules: dict[str, Any] = field(default_factory=dict)
    score_weights: dict[str, int] = field(default_factory=dict)

    def weight(self, key: str, default: int) -> int:
        try:
            return int(self.score_weights.get(key, default))
        except (TypeError, ValueError):
            return default

    def intents_for_nl(self, text: str) -> list[str]:
        return [i for i, alias in self.aliases.items() if alias.nl_matches(text)]

    def intents_for_act(self, text: str) -> list[str]:
        return [i for i, alias in self.aliases.items() if alias.act_matches(text)]

    def is_optional_intent(self, intent_id: str) -> bool:
        alias = self.aliases.get(intent_id)
        if intent_id in self.optional_intents:
            return True
        return bool(alias and alias.flags.get("optional"))

    def exclusive_conflict(self, intent_a: str, intent_b: str) -> bool:
        for left, right in self.exclusive_pairs:
            if (left == intent_a and right == intent_b) or (left == intent_b and right == intent_a):
                return True
        return False

    def css_probe_match(self, selector: str) -> list[str]:
        """Return probe keys whose patterns appear in the selector string."""
        sel = (selector or "").strip()
        if not sel:
            return []
        hits: list[str] = []
        for key, patterns in self.css_probes.items():
            for pat in patterns:
                try:
                    if re.search(pat, sel, re.I) or pat.lower() in sel.lower():
                        hits.append(key)
                        break
                except re.error:
                    if pat.lower() in sel.lower():
                        hits.append(key)
                        break
        return hits


def _any_pattern(patterns: list[str], text: str) -> bool:
    raw = text or ""
    if not raw or not patterns:
        return False
    for pat in patterns:
        try:
            if re.search(pat, raw):
                return True
        except re.error:
            if pat.lower() in raw.lower():
                return True
    return False


def _vocab_path(pack_id: str) -> Path | None:
    for root in _rulebook_dirs():
        path = root / pack_id / "vocab.json"
        if path.is_file():
            return path
    return None


def _load_pack_vocab_raw(pack_id: str) -> dict[str, Any] | None:
    path = _vocab_path(pack_id)
    if not path:
        return None
    try:
        data = json.loads(_read_text(path))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _intent_from_raw(intent_id: str, raw: dict[str, Any]) -> IntentAlias:
    return IntentAlias(
        id=intent_id,
        nl_patterns=[str(p) for p in (raw.get("nl_patterns") or []) if p],
        act_patterns=[str(p) for p in (raw.get("act_patterns") or []) if p],
        negative_act=[str(p) for p in (raw.get("negative_act") or []) if p],
        locator_templates=[
            dict(t) for t in (raw.get("locator_templates") or []) if isinstance(t, dict)
        ],
        flags=dict(raw.get("flags") or {}),
        also_binds_optional=[str(x) for x in (raw.get("also_binds_optional") or []) if x],
        secret_families=[str(x) for x in (raw.get("secret_families") or []) if x],
        testid_tokens=[str(x) for x in (raw.get("testid_tokens") or []) if x],
        ground=dict(raw["ground"]) if isinstance(raw.get("ground"), dict) else None,
        search_page_bridges=[
            dict(b) for b in (raw.get("search_page_bridges") or []) if isinstance(b, dict)
        ],
        href_hints=[str(x) for x in (raw.get("href_hints") or []) if x],
        score_bonus=int(raw.get("score_bonus") or 10),
    )


def _merge_vocab(base: SiteVocab, raw: dict[str, Any], pack_id: str) -> SiteVocab:
    base.pack_ids.append(pack_id)
    base.schema_version = max(base.schema_version, int(raw.get("schemaVersion") or 1))
    for intent_id, intent_raw in (raw.get("aliases") or {}).items():
        if not isinstance(intent_raw, dict):
            continue
        incoming = _intent_from_raw(str(intent_id), intent_raw)
        existing = base.aliases.get(incoming.id)
        if existing is None:
            base.aliases[incoming.id] = incoming
            continue
        # Later packs override / extend.
        existing.nl_patterns = list(dict.fromkeys(existing.nl_patterns + incoming.nl_patterns))
        existing.act_patterns = list(dict.fromkeys(existing.act_patterns + incoming.act_patterns))
        existing.negative_act = list(dict.fromkeys(existing.negative_act + incoming.negative_act))
        existing.locator_templates = existing.locator_templates + [
            t for t in incoming.locator_templates if t not in existing.locator_templates
        ]
        existing.flags = {**existing.flags, **incoming.flags}
        existing.also_binds_optional = list(
            dict.fromkeys(existing.also_binds_optional + incoming.also_binds_optional)
        )
        existing.secret_families = list(
            dict.fromkeys(existing.secret_families + incoming.secret_families)
        )
        existing.testid_tokens = list(
            dict.fromkeys(existing.testid_tokens + incoming.testid_tokens)
        )
        if incoming.ground:
            existing.ground = {**(existing.ground or {}), **incoming.ground}
        existing.search_page_bridges = existing.search_page_bridges + incoming.search_page_bridges
        existing.href_hints = list(dict.fromkeys(existing.href_hints + incoming.href_hints))
        existing.score_bonus = max(existing.score_bonus, incoming.score_bonus)

    for intent in raw.get("optional_intents") or []:
        s = str(intent)
        if s and s not in base.optional_intents:
            base.optional_intents.append(s)

    for pair in raw.get("exclusive_pairs") or []:
        if isinstance(pair, (list, tuple)) and len(pair) >= 2:
            left, right = str(pair[0]), str(pair[1])
            if (left, right) not in base.exclusive_pairs and (right, left) not in base.exclusive_pairs:
                base.exclusive_pairs.append((left, right))

    for key, val in (raw.get("url_tokens") or {}).items():
        if isinstance(val, dict):
            base.url_tokens[str(key)] = {**(base.url_tokens.get(str(key)) or {}), **val}

    for key, patterns in (raw.get("css_probes") or {}).items():
        prev = list(base.css_probes.get(str(key)) or [])
        for pat in patterns or []:
            s = str(pat)
            if s and s not in prev:
                prev.append(s)
        base.css_probes[str(key)] = prev

    for key, vals in (raw.get("implies") or {}).items():
        prev = list(base.implies.get(str(key)) or [])
        for v in vals or []:
            s = str(v)
            if s and s not in prev:
                prev.append(s)
        base.implies[str(key)] = prev

    if isinstance(raw.get("displayed_rules"), dict):
        base.displayed_rules = {**base.displayed_rules, **raw["displayed_rules"]}
    if isinstance(raw.get("score_weights"), dict):
        for k, v in raw["score_weights"].items():
            try:
                base.score_weights[str(k)] = int(v)
            except (TypeError, ValueError):
                continue
    return base


def load_site_vocab(
    *,
    url: str | None = None,
    site_pack: str | None = None,
    pack_ids: list[str] | None = None,
) -> SiteVocab:
    """
    Load and merge vocab.json from active rulebook packs (generic → specialized).

    When no URL/site_pack is given, still loads generic + digital so offline
    compact fixtures (AE/Wiki/Amazon-shaped tests) keep working without heuristics.
    """
    if pack_ids is None:
        active = resolve_active_packs(url=url, site_pack=site_pack)
        # Offline / URL-less compact builds: include digital vocab by default.
        if not url and not site_pack and "digital" not in active and _load_manifest("digital"):
            active = list(active) + ["digital"]
        pack_ids = active

    vocab = SiteVocab(
        score_weights={
            "intent_match": 10,
            "exclusive_conflict": -20,
            "overlay_to_optional_nl": 12,
            "secret_family": 8,
            "bind_min": 3,
            "soft_min": 3,
            "hard_min": 8,
        }
    )
    for pack_id in pack_ids or []:
        raw = _load_pack_vocab_raw(pack_id)
        if raw:
            _merge_vocab(vocab, raw, pack_id)
    return vocab


def build_rulebook_hints(
    *,
    url: str | None = None,
    site_pack: str | None = None,
    enabled: bool | None = None,
) -> tuple[str, list[str]]:
    """Compose markdown hints + list of active pack ids."""
    cfg = rulebooks_config()
    if enabled is None:
        enabled = bool(cfg.get("enabled", True))
    if not enabled:
        return "", []
    if os.environ.get("WEBPILOT_RULEBOOKS", "1").strip().lower() in ("0", "false", "off", "no"):
        return "", []

    active = resolve_active_packs(url=url, site_pack=site_pack)
    sections: list[str] = []
    for pack_id in active:
        body = load_pack_markdown(pack_id)
        if not body:
            continue
        manifest = _load_manifest(pack_id) or {}
        title = str(manifest.get("title") or pack_id)
        sections.append(f"### Rulebook: {title} (`{pack_id}`)\n\n{body}")
    if not sections:
        return "", active
    header = (
        "=== SITE RULEBOOKS (origin-gated; ignore packs that do not match this app) ===\n"
        f"Active packs: {', '.join(active)}"
    )
    return header + "\n\n" + "\n\n".join(sections), active


def compose_discovery_rules(
    base_rules: str,
    *,
    url: str | None = None,
    site_pack: str | None = None,
) -> tuple[str, list[str]]:
    """Append matched rulebooks onto discovery-native / step rules."""
    hints, active = build_rulebook_hints(url=url, site_pack=site_pack)
    base = (base_rules or "").rstrip()
    if not hints:
        return base, active
    return f"{base}\n\n{hints}", active


def infer_pack_for_origin(origin_or_url: str) -> str:
    """Best specialized pack for an origin; falls back to digital then generic."""
    host = hostname_from_url(origin_or_url)
    specialized = [p for p in resolve_active_packs(url=origin_or_url) if p != "generic"]
    if specialized:
        best = specialized[0]
        best_pri = -1
        for pack_id in specialized:
            pri = int((_load_manifest(pack_id) or {}).get("priority") or 0)
            if pri >= best_pri:
                best_pri = pri
                best = pack_id
        return best
    if host and not any(
        host.endswith(s) for s in ("dynamics.com", "salesforce.com", "force.com", "service-now.com")
    ):
        if _load_manifest("digital"):
            return "digital"
    return "generic"


def _locator_blobs(capability: dict[str, Any]) -> list[str]:
    blobs: list[str] = []
    for action in capability.get("actions") or []:
        if not isinstance(action, dict):
            continue
        for key in ("selector", "css", "xpath", "role", "name", "label", "placeholder"):
            val = action.get(key)
            if val:
                blobs.append(str(val))
        for loc in action.get("locators") or action.get("selectorCandidates") or []:
            if isinstance(loc, dict):
                blobs.append(json.dumps(loc))
            elif loc:
                blobs.append(str(loc))
    return blobs


def distill_hints_from_capabilities(
    capabilities: list[dict[str, Any]],
    *,
    min_success_count: int = 2,
    limit: int = 40,
) -> list[str]:
    """Extract durable name / data-id hints from high-trust capabilities."""
    scores: dict[str, int] = {}
    for cap in capabilities or []:
        if not isinstance(cap, dict):
            continue
        if str(cap.get("status") or "").lower() == "quarantined":
            continue
        success = int(cap.get("successCount") or 0)
        if success < min_success_count:
            continue
        weight = max(1, success)
        step = str(cap.get("step") or cap.get("nlStep") or "").strip()
        for blob in _locator_blobs(cap):
            for match in _DATA_ID_RE.finditer(blob):
                token = match.group(1).strip()
                if 3 < len(token) <= 120:
                    key = f"data-id≈`{token}`"
                    scores[key] = scores.get(key, 0) + weight
            for match in _ARIA_RE.finditer(blob):
                token = match.group(1).strip()
                if 2 < len(token) <= 80:
                    key = f'aria-label≈"{token}"'
                    scores[key] = scores.get(key, 0) + weight
            try:
                loc = json.loads(blob) if blob.startswith("{") else None
            except json.JSONDecodeError:
                loc = None
            if isinstance(loc, dict):
                kind = str(loc.get("kind") or "").lower()
                name = str(loc.get("name") or loc.get("value") or "").strip()
                if kind in {"role", "label", "placeholder", "testid"} and name and len(name) <= 80:
                    key = f"{kind}:{name}"
                    scores[key] = scores.get(key, 0) + weight
        for token in re.findall(r"[A-Za-z][A-Za-z0-9_/-]{2,}", step):
            lowered = token.lower()
            if lowered in {
                "the", "and", "with", "from", "into", "click", "enter", "verify",
                "navigate", "select", "open", "page", "button", "field", "visible",
            }:
                continue
            if token[:1].isupper() or lowered in {
                "lookup", "quick", "find", "command", "sitemap", "waffle", "account",
            }:
                key = f"vocab:{token}"
                scores[key] = scores.get(key, 0) + max(1, weight // 2)

    ranked = sorted(scores.items(), key=lambda t: (-t[1], t[0]))[:limit]
    lines: list[str] = []
    for key, score in ranked:
        if key.startswith("vocab:"):
            lines.append(f"- Seen in successful steps: **{key[6:]}** (trust {score})")
        else:
            lines.append(f"- Prefer `{key}` (trust {score})")
    return lines


def update_rulebook_from_capabilities(
    origin_or_url: str,
    capabilities: list[dict[str, Any]],
    *,
    pack_id: str | None = None,
) -> Path | None:
    """Write/merge learned.md for the pack matching this origin."""
    cfg = rulebooks_config()
    if not cfg.get("enabled", True) or not cfg.get("autoLearn", True):
        return None
    if os.environ.get("WEBPILOT_RULEBOOKS_LEARN", "1").strip().lower() in ("0", "false", "off", "no"):
        return None

    pack = (pack_id or infer_pack_for_origin(origin_or_url)).strip() or "generic"
    lines = distill_hints_from_capabilities(
        capabilities,
        min_success_count=int(cfg.get("minSuccessCount") or 2),
    )
    if not lines:
        return None

    host = hostname_from_url(origin_or_url) or origin_or_url
    out = _learned_path(pack)
    out.parent.mkdir(parents=True, exist_ok=True)

    existing = _read_text(out)
    block_header = f"### Origin `{host}`"
    new_block = block_header + "\n\n" + "\n".join(lines) + "\n"

    if block_header in existing:
        pattern = re.compile(
            rf"{re.escape(block_header)}.*?(?=^### Origin |\Z)",
            re.S | re.M,
        )
        merged = pattern.sub(new_block + "\n", existing)
    else:
        header = (
            "# Auto-learned rulebook hints\n\n"
            "Generated from site-knowledge. Seed rules stay in `seed.md`.\n\n"
        )
        merged = (existing if existing.strip() else header) + new_block + "\n"

    out.write_text(merged.strip() + "\n", encoding="utf-8")
    return out


def update_rulebooks_from_knowledge_repo(knowledge_repo: Any) -> list[Path]:
    """Distill all page stores in a KnowledgeRepository into learned rulebooks."""
    updated: list[Path] = []
    try:
        pages_dir = Path(
            getattr(knowledge_repo, "pages_dir", None)
            or (RUNTIME_ROOT / "site-knowledge" / "pages")
        )
        if not pages_dir.is_dir():
            return updated
        for path in sorted(pages_dir.glob("*.json")):
            try:
                store = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            origin = str(store.get("origin") or path.stem.replace("_", "."))
            caps = store.get("capabilities") or []
            if not isinstance(caps, list) or not caps:
                continue
            written = update_rulebook_from_capabilities(origin, caps)
            if written:
                updated.append(written)
    except Exception:
        return updated
    return updated
