import sys
import os

# WebPilot product policy: always disable upstream browser-use telemetry / cloud sync /
# version nags (force, do not honor a pre-set ANONYMIZED_TELEMETRY=true from the shell).
os.environ['ANONYMIZED_TELEMETRY'] = 'false'
os.environ['BROWSER_USE_VERSION_CHECK'] = 'false'
os.environ['BROWSER_USE_CLOUD_SYNC'] = 'false'
os.environ['BROWSER_USE_CLOUD'] = 'false'
# Agent progress one-liners always print via agent_progress.py.
# Full browser-use INFO dumps (Eval/Memory/Thinking) stay off unless verbose:
#   WEBPILOT_VERBOSE=1  or  BROWSER_USE_LOGGING_LEVEL=info  or  webpilot run --verbose
if os.environ.get('WEBPILOT_VERBOSE', '').strip().lower() in ('1', 'true', 'yes', 'on'):
    os.environ.setdefault('BROWSER_USE_LOGGING_LEVEL', 'info')
else:
    os.environ.setdefault('BROWSER_USE_LOGGING_LEVEL', 'result')
# First browser launch on Windows often exceeds browser-use's 30s event timeout while
# default extensions download; disable them and allow a longer launch handshake.
os.environ.setdefault('BROWSER_USE_DISABLE_EXTENSIONS', 'true')
os.environ.setdefault('TIMEOUT_BrowserStartEvent', '120')
os.environ.setdefault('TIMEOUT_BrowserLaunchEvent', '120')
# Enterprise SSO / Bupa-class sites regularly exceed the upstream 30s navigate timeout.
os.environ.setdefault('TIMEOUT_NavigateToUrlEvent', '120')
os.environ.setdefault('TIMEOUT_NavigationStartedEvent', '120')
os.environ.setdefault('TIMEOUT_NavigationCompleteEvent', '120')
os.environ.setdefault('TIMEOUT_BrowserStateRequestEvent', '90')


def _ensure_imageio_ffmpeg_exe() -> bool:
    """Point imageio at the pip-bundled ffmpeg binary (critical on Windows). Returns True when usable."""
    existing = os.environ.get('IMAGEIO_FFMPEG_EXE')
    if existing and os.path.isfile(existing):
        return True
    try:
        import imageio_ffmpeg
        from pathlib import Path

        try:
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg_exe = None
        if ffmpeg_exe and os.path.isfile(ffmpeg_exe):
            os.environ['IMAGEIO_FFMPEG_EXE'] = ffmpeg_exe
            return True
        # Fallback: scan package binaries/ (some Windows installs fail get_ffmpeg_exe).
        binaries = Path(imageio_ffmpeg.__file__).resolve().parent / 'binaries'
        if binaries.is_dir():
            for candidate in sorted(binaries.glob('ffmpeg*')):
                if candidate.is_file() and os.access(candidate, os.X_OK | os.R_OK):
                    os.environ['IMAGEIO_FFMPEG_EXE'] = str(candidate)
                    return True
                if candidate.is_file() and candidate.suffix.lower() in ('.exe', ''):
                    os.environ['IMAGEIO_FFMPEG_EXE'] = str(candidate)
                    return True
    except Exception:
        return False
    return bool(os.environ.get('IMAGEIO_FFMPEG_EXE') and os.path.isfile(os.environ['IMAGEIO_FFMPEG_EXE']))


_FFMPEG_AVAILABLE = _ensure_imageio_ffmpeg_exe()

import json
import asyncio
import re
import datetime
import yaml
import shutil
from typing import Any
from urllib.parse import urlparse

from .paths import (
    ARTIFACTS_ROOT,
    BROWSER_USE_SOURCE_ROOT,
    CONFIG_ROOT,
    PROJECT_ROOT,
    REPORTS_ROOT,
    REPORTS_TRACES_DIR,
    REPORTS_VIDEOS_DIR,
    REPORTS_SCREENSHOTS_DIR,
    TEST_FRAMEWORK_ROOT,
    ensure_report_dirs,
    execution_history_path,
    llm_usage_path,
    resolve_summary_path,
    summary_path,
    workflow_path,
)

if BROWSER_USE_SOURCE_ROOT.is_dir():
    # Prefer WebPilot's editable source tree even if an older wheel is installed.
    sys.path.insert(0, str(BROWSER_USE_SOURCE_ROOT))

from browser_use import Agent, Browser
from browser_use.tools.service import Tools
from .llm_config import (
    _load_dotenv,
    create_browser_use_llm,
    create_codegen_client,
    get_active_provider,
    resolve_provider_config,
    validate_provider_config,
)
from .execution_history import (
    append_recipe_replay_history,
    append_replay_history_from_capability,
    build_full_execution_context,
    format_history_for_prompt,
)
from .branding import (
    build_browser_kwargs,
    ensure_window_maximized,
    install_branding_hook,
    prefer_maximized_window,
    push_branding_status,
)
from .testmu import load_testmu_config
from .prompt_loader import load_framework_rules, load_prompt_with_vars, load_discovery_step_rules
from .knowledge import (
    actions_from_output,
    capability_from_step,
    compact_page_state,
    complete_microsoft_login_if_needed,
    ensure_auth_context_ready,
    execute_capability,
    KnowledgeRepository,
    load_knowledge_config,
    prepare_page_for_interaction,
    progressive_outcome_indicates_success,
    try_recipe_step,
    url_pattern,
    validate_step_outcome,
)
from .agent_progress import branding_current_text, print_agent_step
from .credentials import (
    credential_task_suffix,
    enrich_step_sensitive_data,
    extract_step_credentials,
    is_credential_step,
    is_unresolved_credential_placeholder,
    load_environment_credentials,
    merge_sensitive_data,
    prepare_step,
    redact_for_logs,
    task_requires_environment_credentials,
)
from .capability_contract import classify_failure, infer_intent, is_replay_allowed, route_failure
from .intent_resolver import detect_page_type, resolve_step_intent
from .repair_prompt import build_scoped_task
from .report_artifacts import finalize_artifacts, persist_screenshots

BDD_PREFIXES = ('given', 'when', 'then', 'and', 'but')
NUMBERED_STEP_RE = re.compile(r'^\d+\.\s+')


def build_sensitive_data_context(
    task: str,
    env_name: str,
) -> tuple[str, dict[str, str | dict[str, str]]]:
    """Expose credential placeholders to Browser Use without putting values in the LLM prompt."""
    env_creds = (
        load_environment_credentials(env_name)
        if task_requires_environment_credentials(task)
        else {}
    )

    placeholders: dict[str, str] = {}
    username = (env_creds.get('username') or '').strip()
    password = (env_creds.get('password') or '').strip()
    if username:
        placeholders['username'] = username
    if password and not is_unresolved_credential_placeholder(password):
        placeholders['password'] = password

    sanitized_task = task
    for line in task.splitlines():
        sanitized_line, step_sensitive = prepare_step(line, env_name)
        if step_sensitive:
            placeholders.update(step_sensitive)
        if line in sanitized_task:
            sanitized_task = sanitized_task.replace(line, sanitized_line, 1)

    if task_requires_environment_credentials(task):
        for key, value in load_environment_credentials(env_name).items():
            if value and not is_unresolved_credential_placeholder(value):
                placeholders.setdefault(key, value)

    if not placeholders:
        return redact_for_logs(task), {}

    secret_keys = sorted(placeholders.keys())
    secret_examples = ', '.join(f'<secret>{key}</secret>' for key in secret_keys[:6])
    lines = [
        '\n\nFor sign-in steps, use the sensitive-data placeholders exposed by WebPilot.',
        f'Type credentials using: {secret_examples}.',
        'Never print, extract, or repeat credential values.',
    ]
    sensitive_data: dict[str, str | dict[str, str]] = placeholders
    return redact_for_logs(sanitized_task, placeholders) + '\n'.join(lines), sensitive_data


def pricing_model_name(llm_cfg: dict | None = None) -> str:
    """Best model id for USD estimates (prefer billed model over opaque Azure deployment names)."""
    if not llm_cfg:
        return (
            os.environ.get('WEBPILOT_LLM_MODEL')
            or os.environ.get('AZURE_OPENAI_DEPLOYMENT')
            or 'gpt-4.1'
        )
    return str(
        llm_cfg.get('pricingModel')
        or llm_cfg.get('model')
        or llm_cfg.get('deploymentId')
        or os.environ.get('WEBPILOT_LLM_MODEL')
        or 'gpt-4.1'
    )


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Approximate USD cost (mirrors utils/ModelPricing.ts). Always returns >0 when tokens >0."""
    m = (model or '').lower()
    for prefix in ('azure/', 'aws/', 'gcp/', 'google/'):
        if m.startswith(prefix):
            m = m[len(prefix) :]
            break
    input_per_m, output_per_m = 2.5, 10.0
    if 'gpt-4o-mini' in m or 'gpt-4-mini' in m:
        input_per_m, output_per_m = 0.15, 0.6
    elif 'gpt-4.1-mini' in m or 'gpt-4.1-nano' in m:
        input_per_m, output_per_m = 0.4, 1.6
    elif 'gpt-4.1' in m:
        input_per_m, output_per_m = 2.0, 8.0
    elif 'gpt-4o' in m:
        input_per_m, output_per_m = 2.5, 10.0
    elif 'gpt-4-turbo' in m:
        input_per_m, output_per_m = 10.0, 30.0
    elif 'gpt-4' in m:
        input_per_m, output_per_m = 30.0, 60.0
    elif 'gpt-3.5' in m:
        input_per_m, output_per_m = 0.5, 1.5
    elif 'o3-mini' in m:
        input_per_m, output_per_m = 1.1, 4.4
    elif 'o3' in m:
        input_per_m, output_per_m = 10.0, 40.0
    elif 'claude-3-5-sonnet' in m or 'claude-sonnet-4' in m:
        input_per_m, output_per_m = 3.0, 15.0
    elif 'claude-3-opus' in m or 'claude-opus' in m:
        input_per_m, output_per_m = 15.0, 75.0
    elif 'claude-3-haiku' in m or 'claude-haiku' in m:
        input_per_m, output_per_m = 0.25, 1.25
    elif 'gemini-2.5-flash' in m or 'gemini-2-flash' in m:
        input_per_m, output_per_m = 0.075, 0.3
    elif 'gemini-2.5-pro' in m or 'gemini-2-pro' in m:
        input_per_m, output_per_m = 1.25, 5.0
    elif 'gemini' in m:
        input_per_m, output_per_m = 0.5, 1.5
    return (prompt_tokens / 1_000_000) * input_per_m + (completion_tokens / 1_000_000) * output_per_m


def priced_cost_usd(
    prompt_tokens: int,
    completion_tokens: int,
    browser_use_cost: float,
    llm_cfg: dict | None = None,
) -> float:
    """Prefer LiteLLM/browser-use cost; fall back to hardcoded rates when unpriced (Azure)."""
    if float(browser_use_cost or 0) > 0:
        return float(browser_use_cost)
    if (prompt_tokens or 0) + (completion_tokens or 0) <= 0:
        return 0.0
    return estimate_cost_usd(pricing_model_name(llm_cfg), int(prompt_tokens or 0), int(completion_tokens or 0))

def merge_llm_usage(totals: dict, prompt_tokens: int, completion_tokens: int, cost_usd: float) -> None:
    totals['promptTokens'] += int(prompt_tokens or 0)
    totals['completionTokens'] += int(completion_tokens or 0)
    totals['estimatedCostUsd'] += float(cost_usd or 0)
    totals['llmCalls'] += 1


def apply_usage_summary_to_totals(
    totals: dict,
    *,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
    llm_calls: int,
) -> None:
    """Set cumulative usage (do not add — browser-use summary is already cumulative)."""
    totals['promptTokens'] = int(prompt_tokens or 0)
    totals['completionTokens'] = int(completion_tokens or 0)
    totals['estimatedCostUsd'] = float(cost_usd or 0)
    totals['llmCalls'] = int(llm_calls or 0)


async def read_browser_use_usage_snapshot(agent) -> tuple[int, int, float, int]:
    """Sum token entries from browser-use (source of truth for the current run)."""
    history = agent.token_cost_service.usage_history
    prompt = sum(int(e.usage.prompt_tokens or 0) for e in history)
    completion = sum(int(e.usage.completion_tokens or 0) for e in history)
    calls = len(history)
    cost = 0.0
    if history and agent.token_cost_service.include_cost:
        summary = await agent.token_cost_service.get_usage_summary()
        cost = float(summary.total_cost or 0.0)
    return prompt, completion, cost, calls


def update_cumulative_usage_from_snapshot(
    totals: dict,
    snap_prompt: int,
    snap_completion: int,
    snap_cost: float,
    snap_calls: int,
    llm_cfg: dict,
) -> tuple[int, float]:
    """
    Keep WebPilot overlay totals monotonically cumulative.

    browser-use may report a running total or a per-step snapshot that resets;
    we detect resets and add increments instead of replacing the UI with a smaller number.
    """
    last = totals.get('_lastUsageSnapshot') or {
        'prompt': 0,
        'completion': 0,
        'cost': 0.0,
        'calls': 0,
    }
    delta_prompt = snap_prompt - int(last['prompt'])
    delta_completion = snap_completion - int(last['completion'])
    delta_cost = snap_cost - float(last['cost'])
    delta_calls = snap_calls - int(last['calls'])

    if delta_prompt < 0 or delta_completion < 0:
        # Snapshot reset (per-step only) — add the whole snapshot as this step's usage.
        delta_prompt = snap_prompt
        delta_completion = snap_completion
        delta_cost = snap_cost
        delta_calls = max(snap_calls, 1) if snap_calls else 1

    totals['promptTokens'] = int(totals.get('promptTokens', 0)) + delta_prompt
    totals['completionTokens'] = int(totals.get('completionTokens', 0)) + delta_completion
    totals['estimatedCostUsd'] = float(totals.get('estimatedCostUsd', 0.0)) + delta_cost
    if delta_calls > 0:
        totals['llmCalls'] = int(totals.get('llmCalls', 0)) + delta_calls

    totals['_lastUsageSnapshot'] = {
        'prompt': snap_prompt,
        'completion': snap_completion,
        'cost': snap_cost,
        'calls': snap_calls,
    }

    total_tokens = totals['promptTokens'] + totals['completionTokens']
    if totals['estimatedCostUsd'] <= 0 and total_tokens > 0:
        totals['estimatedCostUsd'] = estimate_cost_usd(
            pricing_model_name(llm_cfg),
            totals['promptTokens'],
            totals['completionTokens'],
        )
    return total_tokens, totals['estimatedCostUsd']


def save_llm_usage_file(test_file_path: str, totals: dict, *, llm_cfg: dict | None = None) -> str:
    base_file_name = os.path.splitext(os.path.basename(test_file_path))[0]
    ensure_report_dirs()
    out_path = llm_usage_path(base_file_name)

    prompt = int(totals.get('promptTokens') or 0)
    completion = int(totals.get('completionTokens') or 0)
    cost = float(totals.get('estimatedCostUsd') or 0.0)
    calls = int(totals.get('llmCalls') or 0)

    # Always estimate when we have tokens but no priced cost (Azure/custom models, litellm miss).
    if cost <= 0 and prompt + completion > 0:
        cost = estimate_cost_usd(pricing_model_name(llm_cfg), prompt, completion)
        totals['estimatedCostUsd'] = cost

    # Never wipe a prior BA usage file with a zeroed knowledge-only / early-exit run.
    if prompt + completion == 0 and os.path.isfile(out_path):
        try:
            with open(out_path, 'r', encoding='utf-8') as existing_f:
                previous = json.load(existing_f)
            prev_tokens = int(previous.get('promptTokens') or 0) + int(previous.get('completionTokens') or 0)
            if prev_tokens > 0:
                print(
                    f"[LLM] Keeping prior usage file ({prev_tokens:,} tokens) — "
                    f"current run recorded 0 LLM calls."
                )
                return out_path
        except Exception:
            pass

    execution_phase = {
        'promptTokens': prompt,
        'completionTokens': completion,
        'estimatedCostUsd': round(cost, 6),
        'llmCalls': calls,
    }
    payload = {
        **execution_phase,
        'phases': {
            'execution': execution_phase,
        },
        'sources': ['browser-use'],
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
    return out_path

def parse_txt_file(file_path):
    if not os.path.exists(file_path):
        print(f"Error: File not found at {file_path}")
        sys.exit(1)
        
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    lines = content.split('\n')
    test_name = "WebPilot Scenario"
    bdd_steps = []
    numbered_steps = []
    plain_steps = []
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        if line_strip.startswith('@'):
            continue
        if line_strip.startswith('#'):
            continue
        if re.match(r'^(target|baseUrl|codegen|report|sitePack|fixture)\s*:', line_strip, re.IGNORECASE):
            continue
        if line_strip.lower().startswith('test:'):
            test_name = line_strip[5:].strip()
            continue
        if any(line_strip.lower().startswith(prefix) for prefix in BDD_PREFIXES):
            bdd_steps.append(line_strip)
            continue
        if NUMBERED_STEP_RE.match(line_strip):
            numbered_steps.append(NUMBERED_STEP_RE.sub('', line_strip, count=1).strip())
            continue
        plain_steps.append(line_strip)

    if bdd_steps:
        return test_name, bdd_steps
    if numbered_steps:
        return test_name, numbered_steps
    return test_name, plain_steps


def _read_scenario_source(file_path: str | None) -> str:
    if not file_path or not os.path.isfile(file_path):
        return ""
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return ""


def resolve_discovery_rules_for_scenario(
    *,
    steps: list[str],
    test_file_path: str | None = None,
    scenario_text: str | None = None,
) -> tuple[str, list[str], str | None]:
    """Base discovery rules + origin-gated rulebooks. Returns (rules, packs, url)."""
    from .discovery_tuning import extract_initial_navigate_url
    from .prompt_loader import load_discovery_native_rules
    from .rulebooks import compose_discovery_rules, parse_site_pack_override

    text = scenario_text if scenario_text is not None else _read_scenario_source(test_file_path)
    site_pack = parse_site_pack_override(text)
    initial_url = extract_initial_navigate_url(steps or [])
    if not initial_url and text:
        # Fall back to baseUrl: metadata when steps use relative navigation.
        m = re.search(r"^baseUrl\s*:\s*(\S+)", text, re.I | re.M)
        if m:
            initial_url = m.group(1).strip()
    base = load_discovery_native_rules()
    rules, packs = compose_discovery_rules(base, url=initial_url, site_pack=site_pack)
    return rules, packs, initial_url

def load_codegen_guidelines():
    """Framework rules from prompts/ (locator strictness, POM layout, catalog)."""
    base_page_path = TEST_FRAMEWORK_ROOT / 'core' / 'BasePage.ts'
    parts = [load_framework_rules()]
    if os.path.exists(base_page_path):
        with open(base_page_path, 'r', encoding='utf-8') as f:
            parts.append('BasePage source (subclasses MUST call these methods):\n' + f.read())
    return '\n\n'.join(parts)

def resolve_upload_fixture_paths():
    """Absolute paths browser-use Agent may upload (contact form, etc.)."""
    candidates = [
        PROJECT_ROOT / 'tests' / 'fixtures' / 'sample.txt',
        TEST_FRAMEWORK_ROOT / 'data' / 'sample.txt',
    ]
    return [os.path.abspath(p) for p in candidates if os.path.isfile(p)]


def _merge_agent_usage(totals: dict, history: Any, llm_cfg: dict) -> None:
    usage = getattr(history, 'usage', None)
    if usage is None:
        return
    prompt = int(getattr(usage, 'total_prompt_tokens', 0) or 0)
    completion = int(getattr(usage, 'total_completion_tokens', 0) or 0)
    cost = float(getattr(usage, 'total_cost', 0.0) or 0.0)
    if cost <= 0 and prompt + completion:
        cost = estimate_cost_usd(pricing_model_name(llm_cfg), prompt, completion)
    totals['promptTokens'] += prompt
    totals['completionTokens'] += completion
    totals['estimatedCostUsd'] += cost
    totals['llmCalls'] += int(getattr(usage, 'entry_count', 0) or 0)


PERFORMANCE_DEFAULTS = {
    # native = one browser-use Agent for the full scenario (default — preserves engine intelligence).
    # scoped = one Agent per NL step (legacy WebPilot wrapper; use for knowledge repair only).
    'engineMode': 'native',
    # Full agent by default (judge/thinking/planning on). Opt into lean mode with
    # discoveryFastMode: true or WEBPILOT_DISCOVERY_FAST_MODE=1 (and WEBPILOT_FULL_AGENT_MODE=0).
    'discoveryFastMode': False,
    'judgeMode': 'verification',
    'maxActionsPerStep': 6,
    'useVision': 'auto',
    'useThinking': True,
    'flashMode': False,
    'enablePlanning': True,
    'visionDetailLevel': 'auto',
    'minPageLoadWait': 0.1,
    'networkIdleWait': 0.3,
    'waitBetweenActions': 0.3,
    'scopedAgentMaxSteps': 12,
    'nativeAgentMaxSteps': 80,
    'maxHistoryItems': 12,
    'freshAgentPerStep': True,
    'longScenarioStepWarning': 15,
    'longScenarioMode': 'auto',  # auto | off — auto-tune agent settings for 15+ step files
    'stepRetryOnFailure': 0,
}

VERIFICATION_KEYWORDS = (
    'verify', 'assert', 'should', 'check', 'confirm', 'ensure', 'expect',
    'validate', 'appears', 'is visible', 'is displayed', 'displayed', 'shown',
    'contains', 'present', 'must ', 'see ',
)


def load_performance_config() -> dict:
    """Read intelligentRunner.performance from config/webpilot.yaml with env overrides."""
    cfg = dict(PERFORMANCE_DEFAULTS)
    try:
        with open(CONFIG_ROOT / 'webpilot.yaml', 'r') as f:
            yaml_config = yaml.safe_load(f) or {}
        ir = yaml_config.get('intelligentRunner') or {}
        if ir.get('scopedAgentMaxSteps') is not None:
            cfg['scopedAgentMaxSteps'] = int(ir['scopedAgentMaxSteps'])
        if ir.get('nativeAgentMaxSteps') is not None:
            cfg['nativeAgentMaxSteps'] = int(ir['nativeAgentMaxSteps'])
        if ir.get('engineMode') is not None:
            cfg['engineMode'] = str(ir['engineMode']).strip().lower()
        if ir.get('maxHistoryItems') is not None:
            cfg['maxHistoryItems'] = _clamp_max_history_items(int(ir['maxHistoryItems']))
        if ir.get('freshAgentPerStep') is not None:
            cfg['freshAgentPerStep'] = bool(ir['freshAgentPerStep'])
        if ir.get('longScenarioStepWarning') is not None:
            cfg['longScenarioStepWarning'] = int(ir['longScenarioStepWarning'])
        if ir.get('longScenarioMode') is not None:
            cfg['longScenarioMode'] = str(ir['longScenarioMode']).strip().lower()
        if ir.get('stepRetryOnFailure') is not None:
            cfg['stepRetryOnFailure'] = int(ir['stepRetryOnFailure'])
        perf = ir.get('performance') or {}
        for key in ('judgeMode', 'useVision', 'engineMode'):
            if perf.get(key) is not None:
                cfg[key] = str(perf[key]).strip().lower()
        if perf.get('maxActionsPerStep') is not None:
            cfg['maxActionsPerStep'] = int(perf['maxActionsPerStep'])
        if perf.get('nativeAgentMaxSteps') is not None:
            cfg['nativeAgentMaxSteps'] = int(perf['nativeAgentMaxSteps'])
        for key in ('useThinking', 'flashMode', 'discoveryFastMode', 'enablePlanning'):
            if perf.get(key) is not None:
                cfg[key] = bool(perf[key])
        if perf.get('visionDetailLevel') is not None:
            cfg['visionDetailLevel'] = str(perf['visionDetailLevel']).strip().lower()
        for key in ('minPageLoadWait', 'networkIdleWait', 'waitBetweenActions'):
            if key in perf:
                cfg[key] = None if perf[key] is None else float(perf[key])
    except Exception as e:
        print('Warning: Could not parse intelligentRunner.performance:', e)

    env_judge = os.environ.get('WEBPILOT_JUDGE_MODE', '').strip().lower()
    if env_judge in ('verification', 'always', 'off'):
        cfg['judgeMode'] = env_judge
    env_flash = os.environ.get('WEBPILOT_FLASH_MODE', '').strip().lower()
    if env_flash in ('1', 'true', 'yes', 'on'):
        cfg['flashMode'] = True
    elif env_flash in ('0', 'false', 'no', 'off'):
        cfg['flashMode'] = False
    env_fast = os.environ.get('WEBPILOT_DISCOVERY_FAST_MODE', '').strip().lower()
    if env_fast in ('1', 'true', 'yes', 'on'):
        cfg['discoveryFastMode'] = True
    elif env_fast in ('0', 'false', 'no', 'off'):
        cfg['discoveryFastMode'] = False
    # Default to full agent when unset (WEBPILOT_FULL_AGENT_MODE=1).
    full_agent = os.environ.get('WEBPILOT_FULL_AGENT_MODE', '1').strip().lower()
    if full_agent in ('1', 'true', 'yes', 'on'):
        cfg['discoveryFastMode'] = False
    elif full_agent in ('0', 'false', 'no', 'off'):
        # Allow yaml / WEBPILOT_DISCOVERY_FAST_MODE to enable lean discovery.
        pass
    env_fresh = os.environ.get('WEBPILOT_FRESH_AGENT_PER_STEP', '').strip().lower()
    if env_fresh in ('1', 'true', 'yes', 'on'):
        cfg['freshAgentPerStep'] = True
    elif env_fresh in ('0', 'false', 'no', 'off'):
        cfg['freshAgentPerStep'] = False
    env_history = os.environ.get('WEBPILOT_MAX_HISTORY_ITEMS', '').strip()
    if env_history.isdigit():
        cfg['maxHistoryItems'] = _clamp_max_history_items(int(env_history))
    env_engine = os.environ.get('WEBPILOT_ENGINE_MODE', '').strip().lower()
    if env_engine in ('native', 'scoped'):
        cfg['engineMode'] = env_engine
    return cfg


def _clamp_max_history_items(value: int | None) -> int:
    """browser-use requires max_history_items to be None or strictly greater than 5."""
    if value is None:
        return 6
    return max(6, int(value))


def _apply_long_scenario_tuning(perf: dict, step_count: int) -> dict:
    """Apply reliability tuning for single-file long flows without requiring user splits."""
    mode = str(perf.get('longScenarioMode', 'auto')).strip().lower()
    threshold = int(perf.get('longScenarioStepWarning', 15))
    if mode != 'auto' or step_count < threshold:
        return perf

    tuned = dict(perf)
    tuned['freshAgentPerStep'] = True
    tuned['maxHistoryItems'] = _clamp_max_history_items(int(tuned.get('maxHistoryItems', 6)))
    tuned['scopedAgentMaxSteps'] = max(int(tuned.get('scopedAgentMaxSteps', 12)), 18)
    if str(tuned.get('judgeMode', 'verification')).strip().lower() == 'always':
        tuned['judgeMode'] = 'verification'
    if int(tuned.get('stepRetryOnFailure', 0)) < 1:
        tuned['stepRetryOnFailure'] = 1
    return tuned


async def _release_scoped_agent(scoped_agent: Any | None) -> None:
    """Tear down a scoped agent without closing the shared browser session."""
    if scoped_agent is None:
        return
    session = getattr(scoped_agent, 'browser_session', None)
    session_profile = getattr(session, 'browser_profile', None) if session is not None else None
    if session_profile is not None:
        session_profile.keep_alive = True
    try:
        await scoped_agent.close()
    except Exception as close_error:
        print(f"Warning: scoped agent release did not finish cleanly: {close_error}")


# Non-browser agent tools that pollute ActHistory / break Playwright replay.
_EXCLUDED_AGENT_FILE_ACTIONS = [
    'write_file',
    'replace_file',
    'read_file',
    'append_file',
]


def _discovery_tools(use_vision: Any) -> Tools:
    """Tools for discovery — browser actions only (no todo.md / write_file)."""
    exclude = list(_EXCLUDED_AGENT_FILE_ACTIONS)
    if use_vision != 'auto':
        exclude.append('screenshot')
    return Tools(exclude_actions=exclude)


def _build_scoped_agent_kwargs(
    *,
    scoped_task: str,
    step: str,
    llm: Any,
    browser: Any,
    sensitive_data: dict,
    upload_paths: list[str],
    on_scoped_step,
    resolved_use_vision,
    step_use_judge: bool,
    perf: dict,
    should_stop=None,
) -> dict:
    return {
        'task': scoped_task,
        'llm': llm,
        'browser': browser,
        'tools': _discovery_tools(resolved_use_vision),
        'calculate_cost': True,
        'register_new_step_callback': on_scoped_step,
        **(
            {'register_should_stop_callback': should_stop}
            if should_stop is not None
            else {}
        ),
        'use_vision': resolved_use_vision,
        'use_judge': step_use_judge,
        'ground_truth': step,
        'enable_planning': False,
        'use_thinking': bool(perf.get('useThinking', True)),
        'flash_mode': bool(perf.get('flashMode', False)),
        'max_actions_per_step': int(perf.get('maxActionsPerStep', 6)),
        'max_history_items': _clamp_max_history_items(int(perf.get('maxHistoryItems', 6))),
        'directly_open_url': False,
        **(
            {'sensitive_data': sensitive_data}
            if sensitive_data
            else {}
        ),
        **(
            {'available_file_paths': upload_paths}
            if upload_paths
            else {}
        ),
    }


def _is_verification_step(step: str) -> bool:
    s = (step or '').lower()
    return any(keyword in s for keyword in VERIFICATION_KEYWORDS)


def _judge_enabled_for_step(judge_mode: str, step: str) -> bool:
    if judge_mode == 'off':
        return False
    if judge_mode == 'always':
        return True
    intent = infer_intent(step)
    if intent in ('authenticate', 'navigate', 'mutate', 'delete'):
        return True
    return _is_verification_step(step)


def _resolve_use_vision(use_vision: str):
    if use_vision == 'auto':
        return 'auto'
    return use_vision in ('always', 'true', 'on', '1')


async def shutdown_browser(browser: Any, scoped_agent: Any | None = None) -> str | None:
    """Force-close the browser after a run.

    keep_alive=True is required during multi-step discovery so agent.run() does not
    kill Chrome between steps, but the window must be closed when the job finishes.

    Returns the finalized discovery video path when recording was active, else None.
    """
    finalized_video: str | None = None
    # browser-use only flushes MP4 files when the ffmpeg writer closes (BrowserStopEvent
    # or an explicit stop_recording call). Finalize before kill so artifact collection
    # can find the file on disk.
    watchdog = getattr(browser, '_recording_watchdog', None)
    if watchdog is not None and getattr(watchdog, 'is_recording', False):
        try:
            saved = await watchdog.stop_recording()
            if saved:
                finalized_video = str(saved)
                print(f"Finalized execution video: {saved}")
        except Exception as rec_err:
            print(f"Warning: could not finalize video recording: {rec_err}")

    profile = getattr(browser, 'browser_profile', None)
    if profile is not None:
        profile.keep_alive = False

    if scoped_agent is not None:
        session = getattr(scoped_agent, 'browser_session', None)
        session_profile = getattr(session, 'browser_profile', None) if session is not None else None
        if session_profile is not None:
            session_profile.keep_alive = False
        try:
            await scoped_agent.close()
        except Exception as close_error:
            print(f"Warning: agent close did not finish cleanly: {close_error}")

    try:
        await asyncio.wait_for(browser.kill(), timeout=25)
        return finalized_video
    except Exception as kill_error:
        print(f"Warning: browser shutdown did not finish cleanly: {kill_error}")

    try:
        await asyncio.wait_for(browser.kill(), timeout=25)
        return finalized_video
    except Exception as retry_error:
        print(f"Warning: browser.kill() retry failed: {retry_error}")

    watchdog = getattr(browser, '_local_browser_watchdog', None)
    subprocess = getattr(watchdog, '_subprocess', None) if watchdog is not None else None
    if watchdog is not None and subprocess is not None:
        try:
            await watchdog._cleanup_process(subprocess)
            watchdog._subprocess = None
            print('[WebPilot] Forced local browser process cleanup after kill() failure.')
        except Exception as force_error:
            print(f"Warning: forced browser process cleanup failed: {force_error}")
    return finalized_video


def build_native_scenario_task(steps: list[str], discovery_rules: str) -> str:
    """Lean full-scenario task — numbered steps first (Nexus-style)."""
    from .discovery_tuning import build_lean_native_task

    return build_lean_native_task(steps, discovery_rules)


async def run_native_browser_use_scenario(
    *,
    browser: Any,
    llm: Any,
    llm_cfg: dict,
    steps: list[str],
    test_name: str,
    test_slug: str,
    env_name: str,
    sensitive_data: dict,
    upload_paths: list[str],
    llm_usage_totals: dict,
    perf: dict | None = None,
    test_file_path: str | None = None,
) -> tuple[bool, dict, Any | None]:
    """Run one browser-use Agent on the full scenario; history/codegen follow engine actions."""
    from .discovery_tuning import (
        ControlLoopBreaker,
        apply_discovery_fast_mode,
        extract_initial_navigate_url,
    )

    perf = apply_discovery_fast_mode(perf or dict(PERFORMANCE_DEFAULTS))
    judge_mode = str(perf.get('judgeMode', 'verification')).strip().lower()
    resolved_use_vision = _resolve_use_vision(perf.get('useVision', 'auto'))

    discovery_rules, active_packs, _hint_url = resolve_discovery_rules_for_scenario(
        steps=steps,
        test_file_path=test_file_path,
    )
    if active_packs:
        print(f"[WebPilot] Rulebooks active: {', '.join(active_packs)}")

    await browser.start()
    await ensure_window_maximized(browser)
    if os.environ.get("WEBPILOT_RESET_AUTH") == "1" or os.environ.get("WEBPILOT_FRESH_CONTEXT") == "1":
        try:
            await browser.clear_cookies()
            page = await browser.must_get_current_page()
            await page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
            label = "WEBPILOT_FRESH_CONTEXT" if os.environ.get("WEBPILOT_FRESH_CONTEXT") == "1" else "WEBPILOT_RESET_AUTH"
            print(f"[WebPilot] {label}=1 — cleared cookies and web storage for fresh context")
        except Exception as reset_error:
            print(f"[WebPilot] Warning: could not reset browser context: {reset_error}")

    await prepare_page_for_interaction(browser)

    sanitized_steps: list[str] = []
    step_sensitive_data = dict(sensitive_data or {})
    for step in steps:
        sanitized, step_sensitive = prepare_step(step, env_name)
        sanitized_steps.append(sanitized)
        step_sensitive_data = enrich_step_sensitive_data(
            step, env_name, step_sensitive_data, step_sensitive
        )

    task = build_native_scenario_task(sanitized_steps, discovery_rules)
    initial_url = extract_initial_navigate_url(sanitized_steps)
    captured_actions: list[dict] = []
    page_snapshots: dict[str, dict] = {}
    native_agent = None
    loop_breaker = ControlLoopBreaker()

    async def on_native_step(state, output, _agent_step):
        new_actions: list[dict] = []
        if output is not None:
            new_actions = actions_from_output(state, output)
            captured_actions.extend(new_actions)
            tripped = loop_breaker.observe_actions(new_actions)
            tripped = loop_breaker.observe_model_state(output) or tripped
            if tripped and loop_breaker.message:
                print(f"[WebPilot] Control-loop breaker: {loop_breaker.message}")
        try:
            print_agent_step(int(_agent_step or 0), output, new_actions)
        except Exception:
            pass
        # Capture selector_map inventory while live DOM is still available
        try:
            from .page_inventory import snapshot_from_browser_state, upsert_inventory

            snap = snapshot_from_browser_state(state)
            if snap and snap.get("pageKey"):
                # Keep a history of snapshots per page — later DOM rebuilds change
                # backend_node_id and dismiss overlays (cookie Consent). End-of-run
                # verification must be able to use the step-time snapshot, not only
                # the final overwrite.
                key = snap["pageKey"]
                bucket = page_snapshots.get(key)
                if isinstance(bucket, list):
                    bucket.append(snap)
                elif isinstance(bucket, dict):
                    page_snapshots[key] = [bucket, snap]
                else:
                    page_snapshots[key] = [snap]
                if snap.get("url"):
                    page_snapshots[str(snap["url"])] = snap
                upsert_inventory(snap)
        except Exception:
            pass
        # Deterministic overlay cleanup each step — Booking Genius/sign-in often appears
        # after cookie accept and blocks the destination field (skip-link mistargets).
        try:
            await prepare_page_for_interaction(browser)
        except Exception:
            pass
        if native_agent is None:
            return
        try:
            prompt, completion, cost, _calls = await read_browser_use_usage_snapshot(native_agent)
            priced = priced_cost_usd(prompt, completion, cost, llm_cfg)
            total = (
                llm_usage_totals['promptTokens']
                + llm_usage_totals['completionTokens']
                + prompt
                + completion
            )
            await push_branding_status(
                browser,
                {
                    'currentIndex': min(len(steps), max(1, len(captured_actions))),
                    'totalSteps': len(steps),
                    'currentText': branding_current_text(
                        output, 'WebPilot agent running full scenario'
                    ),
                    'tokens': total,
                    'cost': f"{llm_usage_totals['estimatedCostUsd'] + priced:.4f}",
                    'allSteps': [
                        {'index': i + 1, 'text': s, 'done': False}
                        for i, s in enumerate(steps)
                    ],
                },
            )
        except Exception:
            pass

    use_judge = judge_mode != 'off'
    fast = bool(perf.get('_discoveryFastModeActive'))
    print(
        f"[WebPilot] Engine mode=native "
        f"({'fast discovery' if fast else 'full agent'}; "
        f"maxSteps={int(perf.get('nativeAgentMaxSteps', 80))})"
    )
    if fast:
        print(
            "[WebPilot] Discovery fast mode — judge/planning/thinking off, flash on "
            "(default is full agent; unset WEBPILOT_DISCOVERY_FAST_MODE / set "
            "WEBPILOT_FULL_AGENT_MODE=1 to restore)"
        )

    agent_kwargs: dict[str, Any] = {
        'task': task,
        'llm': llm,
        'browser': browser,
        'tools': _discovery_tools(resolved_use_vision),
        'calculate_cost': True,
        'register_new_step_callback': on_native_step,
        'register_should_stop_callback': loop_breaker.should_stop,
        'use_vision': resolved_use_vision,
        'use_judge': use_judge,
        'ground_truth': "\n".join(sanitized_steps),
        'enable_planning': bool(perf.get('enablePlanning', not fast)),
        'use_thinking': bool(perf.get('useThinking', not fast)),
        'flash_mode': bool(perf.get('flashMode', fast)),
        'max_actions_per_step': int(perf.get('maxActionsPerStep', 6)),
        'max_history_items': _clamp_max_history_items(int(perf.get('maxHistoryItems', 30))),
        'directly_open_url': True,
        'llm_timeout': int(os.environ.get('WEBPILOT_LLM_TIMEOUT', '180') or 180),
        'extend_system_message': (
            "You are running a WebPilot QE scenario via the WebPilot agent. "
            "Follow the numbered test steps in order. "
            "Prefer semantic targets: role/label/placeholder (textbox, combobox, searchbox, button, link). "
            "Never type into or click skip links (Skip to main content, a[href='#main']). "
            "If an input note says the field's actual value differs from typed text, retarget the real field. "
            "Dismiss cookie banners and blocking popups/interstitials as soon as they appear "
            "(Close, Dismiss, X, Not now, No thanks on any site) — do not sign in or subscribe "
            "unless the test steps require authentication. "
            "Never call done(success=true) until EVERY numbered step is done — including opening the "
            "date picker, selecting check-in/check-out dates, clicking Search, and verifications. "
            "Do not invent raw URLs for in-app navigation — use on-page click/search. "
            "Do NOT use write_file, replace_file, or todo.md — track progress in memory only. "
            "Verify UI with browser visibility/URL checks, never by writing checklist files."
        ),
    }
    vision_detail = str(perf.get('visionDetailLevel') or 'auto').strip().lower()
    if vision_detail in ('auto', 'low', 'high'):
        agent_kwargs['vision_detail_level'] = vision_detail
    if initial_url:
        agent_kwargs['initial_actions'] = [{'navigate': {'url': initial_url, 'new_tab': False}}]
        print(f"[WebPilot] Initial navigate → {initial_url}")
    if step_sensitive_data:
        agent_kwargs['sensitive_data'] = step_sensitive_data
    if upload_paths:
        agent_kwargs['available_file_paths'] = upload_paths

    native_agent = Agent(**agent_kwargs)

    before_prompt, before_completion, before_cost, before_calls = await read_browser_use_usage_snapshot(native_agent)
    max_steps = max(int(perf.get('nativeAgentMaxSteps', 80)), len(steps) * 3)
    history = await native_agent.run(max_steps=max_steps)
    after_prompt, after_completion, after_cost, after_calls = await read_browser_use_usage_snapshot(native_agent)
    llm_usage_totals['promptTokens'] += max(0, after_prompt - before_prompt)
    llm_usage_totals['completionTokens'] += max(0, after_completion - before_completion)
    delta_cost = max(0.0, after_cost - before_cost)
    llm_usage_totals['estimatedCostUsd'] += (
        delta_cost
        if delta_cost > 0
        else estimate_cost_usd(
            pricing_model_name(llm_cfg),
            max(0, after_prompt - before_prompt),
            max(0, after_completion - before_completion),
        )
    )
    llm_usage_totals['llmCalls'] += max(0, after_calls - before_calls)

    agent_ok = bool(getattr(history, 'is_successful', lambda: False)())
    if loop_breaker.triggered:
        agent_ok = False
        print(f"[WebPilot] Discovery stopped by control-loop breaker: {loop_breaker.message}")
    # ActHistory from browser-use is the sole executionHistory source of truth.
    # Do NOT overwrite with NL-aligned zipper (legacy build_nl_aligned_codegen_history).
    context = build_full_execution_context(
        history, steps, test_name, page_snapshots=page_snapshots or None
    )
    if loop_breaker.triggered:
        context["isSuccessful"] = False
        context["failure"] = loop_breaker.message
        context["errors"] = [loop_breaker.message]
        context.setdefault("runLog", {})["isSuccessful"] = False
        context.setdefault("runLog", {})["failures"] = [loop_breaker.message]

    # Milestone A: live Playwright certify locators against open CDP pages.
    try:
        from .live_locator_verifier import cdp_url_from_browser, live_verify_act_steps
        from .act_history import act_history_to_execution_rows
        from .page_inventory import upsert_inventory
        import json as _json

        act_steps = list(context.get("actHistory") or [])
        upgraded = await live_verify_act_steps(
            act_steps, cdp_url=cdp_url_from_browser(browser)
        )
        if upgraded:
            for step in act_steps:
                locs = step.get("locators") or []
                if locs:
                    step["selector"] = _json.dumps(locs, ensure_ascii=False)
            context["actHistory"] = act_steps
            context["executionHistory"] = act_history_to_execution_rows(act_steps)
            context["liveLocatorVerifiedSteps"] = upgraded
            print(f"[WebPilot] Live Playwright verified locators on {upgraded} ActHistory step(s)")
            for step in act_steps:
                locs = step.get("locators") or []
                live = next((l for l in locs if l.get("verifiedBy") == "playwright"), None)
                if live and step.get("url"):
                    upsert_inventory(
                        {
                            "url": step.get("url"),
                            "pageKey": None,
                            "title": step.get("pageTitle"),
                            "elements": [],
                            "elementCount": 0,
                            "capturedAt": None,
                            "fingerprint": None,
                            "schemaVersion": 2,
                            "verifiedLocators": [],
                        },
                        verified_locator=live,
                        ax_name=(step.get("element") or {}).get("ax_name"),
                    )
    except Exception as live_err:
        print(f"[WebPilot] Warning: live Playwright locator verify skipped: {live_err}")

    context['engineMode'] = 'native'
    context['learnedSteps'] = 0
    context['reusedSteps'] = 0
    if page_snapshots:
        context['pageInventoryKeys'] = sorted(
            {k for k in page_snapshots.keys() if not str(k).startswith('http')}
        )
    # Pre-action locator seeds — used by compactWorkflow (not display-only).
    if captured_actions:
        context['nativeCapturedActions'] = captured_actions

    # Rebuild compactWorkflow after live verify + nativeCapturedActions seeds.
    try:
        from .compact_workflow import build_compact_workflow, compact_steps_to_act_steps
        from .discovery_tuning import extract_initial_navigate_url
        from .rulebooks import parse_site_pack_override

        compact_url = extract_initial_navigate_url(steps) or None
        if not compact_url:
            for row in context.get("actHistory") or []:
                u = str((row or {}).get("url") or "").strip()
                if u.startswith("http"):
                    compact_url = u
                    break
        site_pack = None
        if test_file_path:
            try:
                from pathlib import Path as _Path

                site_pack = parse_site_pack_override(_Path(test_file_path).read_text(encoding="utf-8"))
            except Exception:
                site_pack = None

        compact = build_compact_workflow(
            list(context.get("actHistory") or []),
            list(context.get("nlSteps") or steps),
            list(context.get("assertionPlan") or []),
            native_captured_actions=captured_actions or None,
            source="browser-use-compact",
            url=compact_url,
            site_pack=site_pack,
        )
        # Optional certify pass on compact interactive steps still unverified.
        certify_flag = os.environ.get("WEBPILOT_COMPACT_CERTIFY", "1").strip().lower()
        if certify_flag not in ("0", "false", "no", "off") and os.environ.get("WEBPILOT_CODEGEN") == "1":
            try:
                from .live_locator_verifier import cdp_url_from_browser, live_verify_act_steps

                compact_acts = compact_steps_to_act_steps(compact)
                unverified = [
                    s
                    for s in compact_acts
                    if str(s.get("action") or "").lower() in ("click", "input", "fill", "type", "select")
                    and not s.get("locatorVerified")
                    and (s.get("locators") or [])
                ]
                if unverified:
                    upgraded_c = await live_verify_act_steps(
                        compact_acts, cdp_url=cdp_url_from_browser(browser)
                    )
                    if upgraded_c:
                        # Map verified locators back onto compact steps by index.
                        by_idx = {int(s.get("index") or 0): s for s in compact_acts}
                        for cstep in compact.get("steps") or []:
                            src = by_idx.get(int(cstep.get("index") or 0))
                            if not src:
                                continue
                            if src.get("locatorVerified"):
                                cstep["verified"] = True
                                cstep["verifiedBy"] = src.get("locatorVerifiedBy") or "playwright"
                                locs = list(src.get("locators") or [])
                                cstep["selectorCandidates"] = locs
                                cstep["semanticLocators"] = [
                                    l
                                    for l in locs
                                    if str(l.get("kind") or "").lower()
                                    in ("role", "label", "placeholder", "testid")
                                ]
                                if locs:
                                    cstep["locator"] = locs[0]
                        print(
                            f"[WebPilot] Compact workflow certify: upgraded {upgraded_c} step(s)"
                        )
            except Exception as certify_err:
                print(f"[WebPilot] Warning: compact certify skipped: {certify_err}")

        context["compactWorkflow"] = compact
        cov = compact.get("coverage") or {}
        print(
            f"[WebPilot] Compact workflow: {len(compact.get('steps') or [])} steps "
            f"(dropped {len(compact.get('dropped') or [])}); "
            f"NL coverage {cov.get('mapped', 0)}/{cov.get('nlTotal', 0)}"
        )
        if cov.get("unmapped"):
            print(
                "[WebPilot] Compact NL unmapped: "
                + "; ".join(str(u)[:80] for u in (cov.get("unmapped") or [])[:5])
            )
        statuses = cov.get("stepStatuses") or []
        if statuses:
            interesting = [
                s
                for s in statuses
                if str(s.get("status") or "")
                in ("notExecuted", "misbound", "assertHollow", "optionalSkipped")
            ]
            if interesting:
                print(
                    "[WebPilot] Compact NL step status: "
                    + "; ".join(
                        f"#{s.get('nlIndex')} {s.get('status')}: {str(s.get('nlStep') or '')[:60]}"
                        for s in interesting[:8]
                    )
                )
        # Fail closed: browser-use may report success while skipping required NL steps
        # (e.g. date picker). Do not treat that as codegen-eligible discovery.
        required_unmapped = list(cov.get("unmapped") or [])
        coverage_gate = (os.environ.get("WEBPILOT_COMPACT_COVERAGE_GATE") or "fail").strip().lower()
        soft_gate = coverage_gate in ("0", "false", "off", "warn", "warning")
        if agent_ok and required_unmapped:
            msg = (
                "Discovery incomplete — compact workflow missing required NL steps: "
                + "; ".join(required_unmapped[:4])
            )
            if soft_gate:
                print(f"[WebPilot] WARN (COMPACT_COVERAGE_GATE={coverage_gate}): {msg}")
            else:
                agent_ok = False
                context["isSuccessful"] = False
                context["failure"] = msg
                context["errors"] = [msg]
                context.setdefault("runLog", {})["isSuccessful"] = False
                context.setdefault("runLog", {})["failures"] = [msg]
                print(f"[WebPilot] {msg}")
    except Exception as compact_err:
        print(f"[WebPilot] Warning: compact workflow build skipped: {compact_err}")

    # Site-knowledge promotion from NL zipper is deferred (Phase 3: Playwright replay).
    # ActHistory already carries locator candidates for codegen / future PW runner.
    learned = 0
    act_count = len(context.get('actHistory') or context.get('executionHistory') or [])
    context['learnedSteps'] = learned
    context['knowledgeMetrics'] = {
        'totalSteps': len(steps),
        'reusedSteps': 0,
        'recipeSteps': 0,
        'discoverySteps': len(steps) if agent_ok else 0,
        'repairSteps': 0,
        'authGuardSteps': 0,
        'unsafeSkipped': 0,
        'quarantinedSkipped': 0,
        'blockingUnknownSteps': [] if agent_ok else list(range(1, len(steps) + 1)),
        'knowledgeCoverage': '0.0%',
        'fullReplayEligible': False,
        'engineMode': 'native',
        'actHistorySteps': act_count,
        'assertionPlanCount': len(context.get('assertionPlan') or []),
        'compactWorkflowSteps': len((context.get('compactWorkflow') or {}).get('steps') or []),
    }
    if not agent_ok:
        # Preserve a more specific failure (e.g. compact NL coverage) when already set.
        if not (context.get('failure') or '').strip():
            context['failure'] = 'WebPilot agent did not complete the scenario successfully'
        context['errors'] = [context['failure']]
        context.setdefault('runLog', {})['failures'] = [context['failure']]
    return agent_ok, context, native_agent


async def run_intelligent_steps(
    *,
    browser: Any,
    llm: Any,
    llm_cfg: dict,
    steps: list[str],
    test_name: str,
    test_slug: str,
    env_name: str,
    sensitive_data: dict,
    upload_paths: list[str],
    llm_usage_totals: dict,
    perf: dict | None = None,
    test_file_path: str | None = None,
) -> tuple[bool, dict, Any | None]:
    """Execute known steps deterministically and delegate only missing steps to WebPilot discovery."""
    perf = _apply_long_scenario_tuning(perf or dict(PERFORMANCE_DEFAULTS), len(steps))
    judge_mode = perf.get('judgeMode', 'verification')
    scoped_max_steps = int(perf.get('scopedAgentMaxSteps', 12))
    fresh_agent_per_step = bool(perf.get('freshAgentPerStep', True))
    long_scenario_warning = int(perf.get('longScenarioStepWarning', 15))
    step_retry_on_failure = int(perf.get('stepRetryOnFailure', 0))
    long_scenario_mode = str(perf.get('longScenarioMode', 'auto')).strip().lower()
    resolved_use_vision = _resolve_use_vision(perf.get('useVision', 'auto'))
    knowledge_repo = KnowledgeRepository(load_knowledge_config(), test_slug)
    force_discovery = os.environ.get('WEBPILOT_DISABLE_SITE_KNOWLEDGE') == '1'
    knowledge_only = os.environ.get('WEBPILOT_KNOWLEDGE_ONLY') == '1'

    from .prompt_loader import load_discovery_step_rules
    from .rulebooks import compose_discovery_rules, parse_site_pack_override
    from .discovery_tuning import ControlLoopBreaker, extract_initial_navigate_url

    site_pack = parse_site_pack_override(_read_scenario_source(test_file_path))
    scoped_discovery_rules, active_packs = compose_discovery_rules(
        load_discovery_step_rules(),
        url=extract_initial_navigate_url(steps),
        site_pack=site_pack,
    )
    if active_packs:
        print(f"[WebPilot] Rulebooks active: {', '.join(active_packs)}")
    execution_history: list[dict] = []
    url_sequence: list[str] = []
    learned = 0
    reused = 0
    recipe_steps = 0
    discovery_steps = 0
    repair_steps = 0
    auth_guard_steps = 0
    unsafe_skipped = 0
    quarantined_skipped = 0
    blocking_unknown_steps: list[int] = []
    scoped_agent = None
    active_capture: list[dict] = []
    active_step_index = 0
    active_step_text = ""
    scoped_loop_breaker = ControlLoopBreaker()

    async def scoped_should_stop() -> bool:
        return await scoped_loop_breaker.should_stop()

    await browser.start()
    await ensure_window_maximized(browser)
    if os.environ.get("WEBPILOT_RESET_AUTH") == "1" or os.environ.get("WEBPILOT_FRESH_CONTEXT") == "1":
        try:
            await browser.clear_cookies()
            page = await browser.must_get_current_page()
            await page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
            label = "WEBPILOT_FRESH_CONTEXT" if os.environ.get("WEBPILOT_FRESH_CONTEXT") == "1" else "WEBPILOT_RESET_AUTH"
            print(f"[WebPilot] {label}=1 — cleared cookies and web storage for fresh context")
        except Exception as reset_error:
            print(f"[WebPilot] Warning: could not reset browser context: {reset_error}")

    if len(steps) >= long_scenario_warning:
        if long_scenario_mode == 'auto':
            print(
                f"[WebPilot] Long scenario endurance mode ({len(steps)} steps): "
                f"freshAgentPerStep, maxHistory={perf.get('maxHistoryItems')}, "
                f"scopedMaxSteps={scoped_max_steps}, stepRetry={step_retry_on_failure}. "
                "AI runs only on steps not yet learned — re-runs replay the full file without LLM."
            )
        else:
            print(
                f"[WebPilot] Long scenario ({len(steps)} steps). "
                "Enable intelligentRunner.longScenarioMode: auto in webpilot.yaml for tuned agent settings."
            )

    async def on_scoped_step(state, output, _agent_step):
        new_actions: list[dict] = []
        if output is not None:
            new_actions = actions_from_output(state, output)
            active_capture.extend(new_actions)
            tripped = scoped_loop_breaker.observe_actions(new_actions)
            tripped = scoped_loop_breaker.observe_model_state(output) or tripped
            if tripped and scoped_loop_breaker.message:
                print(f"[WebPilot] Control-loop breaker: {scoped_loop_breaker.message}")
        try:
            print_agent_step(
                int(_agent_step or 0),
                output,
                new_actions,
                nl_hint=active_step_text,
            )
        except Exception:
            pass
        if scoped_agent is not None:
            try:
                prompt, completion, cost, _calls = await read_browser_use_usage_snapshot(scoped_agent)
                priced = priced_cost_usd(prompt, completion, cost, llm_cfg)
                total = (
                    llm_usage_totals['promptTokens']
                    + llm_usage_totals['completionTokens']
                    + prompt
                    + completion
                )
                await push_branding_status(
                    browser,
                    {
                        'currentIndex': active_step_index,
                        'totalSteps': len(steps),
                        'currentText': branding_current_text(output, active_step_text),
                        'tokens': total,
                        'cost': f"{llm_usage_totals['estimatedCostUsd'] + priced:.4f}",
                        'allSteps': [
                            {'index': i + 1, 'text': s, 'done': i < active_step_index - 1}
                            for i, s in enumerate(steps)
                        ],
                    },
                )
            except Exception:
                pass

    for step_index, step in enumerate(steps, start=1):
        sanitized_step, step_sensitive = prepare_step(step, env_name)
        step_sensitive_data = enrich_step_sensitive_data(
            step,
            env_name,
            sensitive_data,
            step_sensitive,
        )
        safe_step_label = redact_for_logs(sanitized_step, step_sensitive_data)
        step_intent = infer_intent(step)
        current_url = await browser.get_current_page_url()

        if step_intent not in ("authenticate", "navigate"):
            auth_ok, auth_reason = await ensure_auth_context_ready(browser)
            if not auth_ok:
                auth_guard_steps += 1
                if knowledge_only:
                    print(f"[Auth] Blocking step {step_index} in knowledge-only mode: {auth_reason}")
                    blocking_unknown_steps.append(step_index)
                    return False, {
                        "failure": f'Auth interstitial blocked step {step_index}: {auth_reason}',
                        "executionHistory": execution_history,
                        "urlSequence": url_sequence,
                        "reusedSteps": reused,
                        "learnedSteps": learned,
                        "knowledgeMetrics": _knowledge_metrics_payload(
                            len(steps), reused, recipe_steps, discovery_steps, repair_steps,
                            auth_guard_steps, unsafe_skipped, quarantined_skipped, blocking_unknown_steps,
                        ),
                    }, scoped_agent
                print(f"[Auth] Interstitial before step {step_index}: {auth_reason} — repair/discovery will run")

        current_url = await browser.get_current_page_url()
        if not url_sequence or url_sequence[-1] != current_url:
            url_sequence.append(current_url)

        if await prepare_page_for_interaction(browser):
            current_url = await browser.get_current_page_url()
            if not url_sequence or url_sequence[-1] != current_url:
                url_sequence.append(current_url)

        page_state = await compact_page_state(browser)
        capability = None if force_discovery else knowledge_repo.find_capability(step, current_url, page_state)
        if capability and not is_replay_allowed(capability):
            print(f"[Knowledge] Step {step_index}/{len(steps)} skipped unsafe replay (side effect): {safe_step_label}")
            unsafe_skipped += 1
            capability = None
        if capability and capability.get("status") == "quarantined":
            quarantined_skipped += 1
            capability = None
        repair_mode = False
        repair_failure_class: str | None = None
        repair_failure_reason = ""
        failed_capability: dict | None = None
        if capability:
            print(f"[Knowledge] Step {step_index}/{len(steps)} deterministic: {safe_step_label}")
            ok, reason = await execute_capability(browser, capability, step_sensitive_data)
            if ok and is_credential_step(step):
                kmsi_ok, kmsi_reason = await complete_microsoft_login_if_needed(browser, step)
                if not kmsi_ok:
                    ok = False
                    reason = kmsi_reason
            if ok:
                reused += 1
                knowledge_repo.promote(capability)
                append_replay_history_from_capability(
                    execution_history,
                    capability,
                    description=safe_step_label,
                    url=await browser.get_current_page_url(),
                    redact_value=lambda value: redact_for_logs(value, step_sensitive_data),
                )
                continue
            knowledge_repo.record_failure(capability, reason)
            repair_failure_class = classify_failure(reason)
            repair_failure_reason = reason
            failed_capability = capability
            action = route_failure(repair_failure_class)
            if action == "auth_advance":
                from .auth_state import advance_auth_state

                auth_ok, auth_reason, auth_state = await advance_auth_state(browser)
                if auth_ok:
                    print(f"[Auth] Advanced session ({auth_state}) — retrying step {step_index}")
                    ok, reason = await execute_capability(browser, capability, step_sensitive_data)
                    if ok:
                        reused += 1
                        knowledge_repo.promote(capability)
                        append_replay_history_from_capability(
                            execution_history,
                            capability,
                            description=safe_step_label,
                            url=await browser.get_current_page_url(),
                            redact_value=lambda value: redact_for_logs(value, step_sensitive_data),
                        )
                        continue
                    knowledge_repo.record_failure(capability, reason)
                    repair_failure_reason = reason
                    repair_failure_class = classify_failure(reason)
            print(f"[Knowledge] Validation failed; scoped WebPilot repair: {reason}")
            repair_mode = True

        recipe_handled, recipe_ok, recipe_reason = False, False, ""
        if capability is None or repair_mode:
            recipe_handled, recipe_ok, recipe_reason = await try_recipe_step(browser, step)
        if recipe_handled and recipe_ok:
            if is_credential_step(step):
                kmsi_ok, kmsi_reason = await complete_microsoft_login_if_needed(browser, step)
                if not kmsi_ok:
                    recipe_ok = False
                    recipe_reason = kmsi_reason
        if recipe_handled and recipe_ok:
            print(f"[Knowledge] Step {step_index}/{len(steps)} recipe replay: {safe_step_label}")
            recipe_steps += 1
            reused += 1
            append_recipe_replay_history(
                execution_history,
                step,
                description=safe_step_label,
                url=await browser.get_current_page_url(),
            )
            continue
        if recipe_handled and not recipe_ok:
            print(f"[Knowledge] Recipe replay failed; scoped WebPilot repair: {recipe_reason}")

        if knowledge_only:
            blocking_unknown_steps.append(step_index)
            return False, {
                "failure": f'No validated knowledge for step {step_index}: {safe_step_label}',
                "executionHistory": execution_history,
                "urlSequence": url_sequence,
                "reusedSteps": reused,
                "learnedSteps": learned,
                "knowledgeMetrics": _knowledge_metrics_payload(
                    len(steps), reused, recipe_steps, discovery_steps, repair_steps,
                    auth_guard_steps, unsafe_skipped, quarantined_skipped, blocking_unknown_steps,
                ),
            }, scoped_agent

        if repair_mode:
            repair_steps += 1
        else:
            discovery_steps += 1
        print(f"[Discovery] Step {step_index}/{len(steps)} WebPilot: {safe_step_label}")
        before = await compact_page_state(browser)
        captured_actions: list[dict] = []
        active_capture = captured_actions
        active_step_index = step_index
        active_step_text = safe_step_label
        scoped_loop_breaker = ControlLoopBreaker()

        scoped_task = build_scoped_task(
            sanitized_step,
            step,
            page_state=page_state,
            credential_suffix=credential_task_suffix(step_sensitive),
            discovery_rules=scoped_discovery_rules,
            repair_mode=repair_mode,
            failure_class=repair_failure_class,
            failure_reason=repair_failure_reason,
            capability=failed_capability,
        )
        step_use_judge = _judge_enabled_for_step(judge_mode, step)
        if fresh_agent_per_step:
            await _release_scoped_agent(scoped_agent)
            scoped_agent = Agent(
                **_build_scoped_agent_kwargs(
                    scoped_task=scoped_task,
                    step=sanitized_step,
                    llm=llm,
                    browser=browser,
                    sensitive_data=step_sensitive_data,
                    upload_paths=upload_paths,
                    on_scoped_step=on_scoped_step,
                    resolved_use_vision=resolved_use_vision,
                    step_use_judge=step_use_judge,
                    perf=perf,
                    should_stop=scoped_should_stop,
                )
            )
        elif scoped_agent is None:
            scoped_agent = Agent(
                **_build_scoped_agent_kwargs(
                    scoped_task=scoped_task,
                    step=sanitized_step,
                    llm=llm,
                    browser=browser,
                    sensitive_data=step_sensitive_data,
                    upload_paths=upload_paths,
                    on_scoped_step=on_scoped_step,
                    resolved_use_vision=resolved_use_vision,
                    step_use_judge=step_use_judge,
                    perf=perf,
                    should_stop=scoped_should_stop,
                )
            )
        else:
            scoped_agent.settings.ground_truth = sanitized_step
            scoped_agent.settings.use_judge = step_use_judge
            scoped_agent.add_new_task(scoped_task)

        before_prompt, before_completion, before_cost, before_calls = await read_browser_use_usage_snapshot(scoped_agent)
        history = await scoped_agent.run(max_steps=scoped_max_steps)
        step_ok = bool(getattr(history, 'is_successful', lambda: False)())
        if scoped_loop_breaker.triggered:
            step_ok = False
            print(f"[WebPilot] Step {step_index} stopped by control-loop breaker: {scoped_loop_breaker.message}")
        if not step_ok and step_retry_on_failure > 0 and not scoped_loop_breaker.triggered:
            print(f"[WebPilot] Step {step_index} failed — retrying once with a fresh agent...")
            scoped_loop_breaker = ControlLoopBreaker()
            await _release_scoped_agent(scoped_agent)
            scoped_agent = Agent(
                **_build_scoped_agent_kwargs(
                    scoped_task=scoped_task,
                    step=sanitized_step,
                    llm=llm,
                    browser=browser,
                    sensitive_data=step_sensitive_data,
                    upload_paths=upload_paths,
                    on_scoped_step=on_scoped_step,
                    resolved_use_vision=resolved_use_vision,
                    step_use_judge=step_use_judge,
                    perf=perf,
                    should_stop=scoped_should_stop,
                )
            )
            history = await scoped_agent.run(max_steps=scoped_max_steps)
            step_ok = bool(getattr(history, 'is_successful', lambda: False)())
            if scoped_loop_breaker.triggered:
                step_ok = False
                print(f"[WebPilot] Step {step_index} stopped by control-loop breaker: {scoped_loop_breaker.message}")

        after_prompt, after_completion, after_cost, after_calls = await read_browser_use_usage_snapshot(scoped_agent)
        delta_prompt = max(0, after_prompt - before_prompt)
        delta_completion = max(0, after_completion - before_completion)
        delta_cost = max(0.0, after_cost - before_cost)
        delta_calls = max(0, after_calls - before_calls)
        llm_usage_totals['promptTokens'] += delta_prompt
        llm_usage_totals['completionTokens'] += delta_completion
        llm_usage_totals['estimatedCostUsd'] += (
            delta_cost
            if delta_cost > 0
            else estimate_cost_usd(pricing_model_name(llm_cfg), delta_prompt, delta_completion)
        )
        llm_usage_totals['llmCalls'] += delta_calls

        if is_credential_step(step):
            kmsi_ok, kmsi_reason = await complete_microsoft_login_if_needed(browser, step)
            if not kmsi_ok:
                blocking_unknown_steps.append(step_index)
                return False, {
                    "failure": f'Login incomplete after step {step_index}: {kmsi_reason}',
                    "executionHistory": execution_history,
                    "urlSequence": url_sequence,
                    "reusedSteps": reused,
                    "learnedSteps": learned,
                    "knowledgeMetrics": _knowledge_metrics_payload(
                        len(steps), reused, recipe_steps, discovery_steps, repair_steps,
                        auth_guard_steps, unsafe_skipped, quarantined_skipped, blocking_unknown_steps,
                    ),
                }, scoped_agent

        after = await compact_page_state(browser)
        outcome_ok, outcome_reason = await validate_step_outcome(
            browser, step, before, after, captured_actions
        )
        if step_ok and not outcome_ok:
            print(f"[Validation] Step {step_index} agent reported success but outcome check failed: {outcome_reason}")
            step_ok = False
        elif (
            not step_ok
            and progressive_outcome_indicates_success(
                step, before, after, captured_actions, history=history
            )
        ):
            print(
                f"[Validation] Step {step_index} agent reported failure but UI advanced after the action — "
                "accepting as success (single-step false negative)."
            )
            step_ok = True
            outcome_reason = ""

        if not step_ok:
            blocking_unknown_steps.append(step_index)
            return False, {
                "failure": (
                    f'WebPilot could not complete step {step_index}: {safe_step_label}'
                    + (f' ({outcome_reason})' if outcome_reason else '')
                ),
                "executionHistory": execution_history,
                "urlSequence": url_sequence,
                "reusedSteps": reused,
                "learnedSteps": learned,
                "knowledgeMetrics": _knowledge_metrics_payload(
                    len(steps), reused, recipe_steps, discovery_steps, repair_steps,
                    auth_guard_steps, unsafe_skipped, quarantined_skipped, blocking_unknown_steps,
                ),
            }, scoped_agent

        capability = capability_from_step(step, before, after, captured_actions)
        if capability:
            knowledge_repo.promote(capability)
            learned += 1
        for action in captured_actions:
            execution_history.append({
                "index": len(execution_history) + 1,
                "action": action.get("type", "browser-use"),
                "selector": json.dumps(action.get("locators")) if action.get("locators") else None,
                "value": redact_for_logs(str(action.get("value") or ""), step_sensitive_data) or None,
                "url": action.get("url") or after.get("url"),
                "description": safe_step_label,
            })
        if not captured_actions:
            execution_history.append({
                "index": len(execution_history) + 1,
                "action": "browser-use-assertion",
                "url": after.get("url"),
                "description": safe_step_label,
            })

        current_url = after.get("url", "")
        if current_url and (not url_sequence or url_sequence[-1] != current_url):
            url_sequence.append(current_url)

    context = {
        "testName": test_name,
        "nlSteps": steps,
        "executionHistory": execution_history,
        "runtimeInsights": {
            "nlStepCount": len(steps),
            "insights": [{
                "type": "intelligent_runner",
                "required": True,
                "message": (
                    f"Reused {reused} validated steps, {recipe_steps} recipe(s), "
                    f"{discovery_steps} discovery, {repair_steps} repair; learned {learned}."
                ),
            }],
        },
        "urlSequence": url_sequence,
        "actionNames": [item.get("action") for item in execution_history],
        "memoriesAndExtractions": {},
        "agentSteps": [],
        "isSuccessful": True,
        "isDone": True,
        "fullHistoryDump": {},
        "reusedSteps": reused,
        "learnedSteps": learned,
        "knowledgeMetrics": _knowledge_metrics_payload(
            len(steps), reused, recipe_steps, discovery_steps, repair_steps,
            auth_guard_steps, unsafe_skipped, quarantined_skipped, blocking_unknown_steps,
        ),
    }
    _learn_rulebooks_from_execution(
        agent_ok=True,
        execution_context=context,
        knowledge_repo=knowledge_repo,
    )
    return True, context, scoped_agent


def _learn_rulebooks_from_execution(
    *,
    agent_ok: bool,
    execution_context: dict,
    knowledge_repo: Any | None = None,
) -> None:
    """Distill high-trust locators into runtime/rulebooks/<pack>/learned.md."""
    if not agent_ok:
        return
    try:
        from .rulebooks import (
            update_rulebook_from_capabilities,
            update_rulebooks_from_knowledge_repo,
        )

        written: list[Any] = []
        if knowledge_repo is not None:
            written.extend(update_rulebooks_from_knowledge_repo(knowledge_repo))

        # Also distill from this run's ActHistory (native engine may not promote knowledge yet).
        by_origin: dict[str, list[dict]] = {}
        for step in execution_context.get("actHistory") or execution_context.get("executionHistory") or []:
            if not isinstance(step, dict):
                continue
            url = str(step.get("url") or "")
            if not url:
                continue
            from .rulebooks import hostname_from_url

            origin = hostname_from_url(url) or url
            locs = []
            if step.get("locator"):
                locs.append(step["locator"])
            locs.extend(step.get("locators") or [])
            locs.extend(step.get("selectorCandidates") or [])
            if not locs and step.get("selector"):
                locs.append({"kind": "css", "value": str(step.get("selector"))})
            if not locs:
                continue
            cap = {
                "step": step.get("nlStep") or step.get("description") or step.get("action") or "",
                "origin": origin,
                "successCount": 2,  # treat successful discovery acts as learnable
                "actions": [{"locators": locs}],
            }
            by_origin.setdefault(origin, []).append(cap)
        for origin, caps in by_origin.items():
            path = update_rulebook_from_capabilities(origin, caps)
            if path:
                written.append(path)
        if written:
            from pathlib import Path as _Path

            unique = sorted({str(p) for p in written})
            print(
                f"[WebPilot] Rulebooks learned ({len(unique)}): "
                + ", ".join(_Path(p).name for p in unique[:6])
            )
    except Exception as exc:
        print(f"[WebPilot] Warning: rulebook learning skipped: {exc}")


def _knowledge_metrics_payload(
    total_steps: int,
    reused: int,
    recipe_steps: int,
    discovery_steps: int,
    repair_steps: int,
    auth_guard_steps: int,
    unsafe_skipped: int,
    quarantined_skipped: int,
    blocking_unknown_steps: list[int],
) -> dict:
    known = reused
    coverage = round((known / total_steps) * 100, 1) if total_steps else 0.0
    return {
        "totalSteps": total_steps,
        "reusedSteps": reused,
        "recipeSteps": recipe_steps,
        "discoverySteps": discovery_steps,
        "repairSteps": repair_steps,
        "authGuardSteps": auth_guard_steps,
        "unsafeSkipped": unsafe_skipped,
        "quarantinedSkipped": quarantined_skipped,
        "blockingUnknownSteps": blocking_unknown_steps,
        "knowledgeCoverage": f"{coverage}%",
        "fullReplayEligible": len(blocking_unknown_steps) == 0 and discovery_steps == 0 and repair_steps == 0,
    }


def load_browser_artifact_config():
    """Read video/trace paths from config/webpilot.yaml."""
    defaults = {
        'headless': True,
        'target': 'chrome',
        'viewport': {'width': 1280, 'height': 720},
        'video_dir': str(REPORTS_VIDEOS_DIR),
        'traces_dir': str(REPORTS_TRACES_DIR),
        'record_video': False,
        'record_trace': True,
        'screenshots_mode': 'only-on-failure',
        'provider': 'browser-use',
    }
    try:
        with open(CONFIG_ROOT / 'webpilot.yaml', 'r') as f:
            yaml_config = yaml.safe_load(f) or {}
        browser = yaml_config.get('browser', {})
        providers = yaml_config.get('browserProviders') or {}
        active_provider = (
            os.environ.get('WEBPILOT_BROWSER_PROVIDER')
            or providers.get('active')
            or ('testmu' if (browser.get('testmu') or {}).get('enabled') else 'browser-use')
        )
        provider_block = providers.get(active_provider) or {}
        defaults['provider'] = active_provider
        defaults['headless'] = provider_block.get('headless', browser.get('headless', True))
        defaults['target'] = (
            provider_block.get('browserName')
            or provider_block.get('target')
            or browser.get('target', 'chrome')
        )
        vp = browser.get('viewport')
        if isinstance(provider_block.get('viewport'), dict):
            vp = provider_block.get('viewport')
        if isinstance(vp, dict) and vp.get('width') and vp.get('height'):
            defaults['viewport'] = {'width': int(vp['width']), 'height': int(vp['height'])}
        scale_raw = os.environ.get('WEBPILOT_VIEWPORT_SCALE', '').strip()
        if scale_raw:
            try:
                scale = float(scale_raw)
                if scale > 0 and scale != 1:
                    defaults['viewport'] = {
                        'width': int(defaults['viewport']['width'] * scale),
                        'height': int(defaults['viewport']['height'] * scale),
                    }
                    print(f"[WebPilot] Viewport scale {scale}x → {defaults['viewport']['width']}×{defaults['viewport']['height']}")
            except ValueError:
                print(f"Warning: Ignoring invalid WEBPILOT_VIEWPORT_SCALE={scale_raw!r}")
        defaults['record_video'] = False  # set below from browser.video + ffmpeg availability
        ss_mode = str(browser.get('screenshots', 'only-on-failure') or 'only-on-failure').strip().lower()
        if ss_mode in ('off', 'on', 'only-on-failure'):
            defaults['screenshots_mode'] = ss_mode
        trace_val = browser.get('trace', True)
        defaults['record_trace'] = trace_val not in ('off', False, None)
        if active_provider == 'testmu':
            merged_browser = dict(browser)
            merged_browser['testmu'] = {
                **(browser.get('testmu') or {}),
                **(providers.get('testmu') or {}),
                'enabled': True,
            }
            defaults['testmu'] = load_testmu_config(merged_browser)
        else:
            defaults['testmu'] = load_testmu_config(browser)
        artifacts = yaml_config.get('framework', {}).get('artifactsPath', str(ARTIFACTS_ROOT))
        if artifacts:
            pass
        video_raw = str(browser.get('video', 'on') or 'on').strip().lower()
        defaults['video_mode'] = video_raw
    except Exception as e:
        print("Warning: Could not parse config/webpilot.yaml for artifacts:", e)
        defaults.setdefault('video_mode', 'on')

    env_video = os.environ.get('WEBPILOT_VIDEO', '').strip().lower()
    if env_video in ('off', '0', 'false', 'no'):
        defaults['video_mode'] = 'off'
    elif env_video in ('on', '1', 'true', 'yes'):
        defaults['video_mode'] = 'on'
    elif env_video == 'retain-on-failure':
        defaults['video_mode'] = 'retain-on-failure'

    # Prefer recording inside the discovery (browser-use) session so we do not need a
    # second Playwright browser just for report video. Requires bundled ffmpeg.
    video_mode = str(defaults.get('video_mode') or 'on').lower()
    want_video = video_mode in ('on', '1', 'true', 'yes', 'retain-on-failure')
    if want_video and _FFMPEG_AVAILABLE:
        defaults['record_video'] = True
        print(
            '[WebPilot] Discovery video recording ON (browser-use CDP screencast + ffmpeg) — '
            'no extra Playwright session needed for report video.'
        )
    elif want_video and not _FFMPEG_AVAILABLE:
        defaults['record_video'] = False
        print(
            '[WebPilot] Discovery video unavailable (ffmpeg not found). '
            'Report video will come from codegen Playwright validation when --codegen runs, '
            'or a one-shot ActHistory evidence replay as last resort.'
        )
    else:
        defaults['record_video'] = False

    # Headless comes from webpilot.yaml only (browserProviders.<active>.headless → browser.headless).
    # Do not honor WEBPILOT_HEADLESS — that env was previously able to override yaml.
    os.makedirs(defaults['video_dir'], exist_ok=True)
    os.makedirs(defaults['traces_dir'], exist_ok=True)
    return defaults


def browser_provider_summary(browser_cfg):
    testmu_cfg = browser_cfg.get('testmu') or {}
    provider = browser_cfg.get('provider') or ('testmu' if testmu_cfg.get('enabled') else 'browser-use')
    if provider == 'testmu' or testmu_cfg.get('enabled'):
        return {
            'provider': 'testmu',
            'displayName': 'TestMu',
            'browserName': testmu_cfg.get('browserName', 'Chrome'),
            'browserVersion': testmu_cfg.get('browserVersion', 'latest'),
            'platform': testmu_cfg.get('platform', 'Windows 10'),
        }
    return {
        'provider': 'browser-use',
        'displayName': 'WebPilot agent',
        'browserName': browser_cfg.get('target', 'chrome'),
        'platform': 'local',
    }

def trigger_html_reports(test_slug, env_name, test_file_path, skip_ai=False):
    """Generate reports/index.html (fast path via run-cli.ts)."""
    import subprocess
    cli = os.environ.get('WEBPILOT_REPORT_CLI')
    node = os.environ.get('WEBPILOT_NODE', 'node')
    if not cli or not os.path.isfile(cli):
        print("Warning: HTML report CLI is unavailable; run `webpilot report --html`.")
        return
    cmd = [node, cli, '--env', env_name, '--test', test_slug]
    if skip_ai:
        cmd.append('--no-ai')
    try:
        subprocess.run(cmd, cwd=os.getcwd(), check=False, timeout=300)
    except Exception as e:
        print(f"Warning: HTML report generation skipped: {e}")


def resolve_codegen_mode() -> str:
    env_mode = os.environ.get('WEBPILOT_CODEGEN_MODE', '').strip().lower()
    if env_mode in ('deterministic', 'llm', 'auto'):
        return env_mode
    try:
        with open(CONFIG_ROOT / 'webpilot.yaml', 'r') as f:
            yaml_config = yaml.safe_load(f) or {}
        config_mode = str(yaml_config.get('framework', {}).get('codegenMode', 'deterministic')).strip().lower()
        if config_mode in ('deterministic', 'llm', 'auto'):
            return config_mode
    except Exception:
        pass
    return 'deterministic'


async def generate_playwright_code(
    provider,
    llm_cfg,
    test_name,
    steps,
    llm_usage_totals,
    symbol_graph_context="None",
    execution_context=None,
):
    framework_rules = load_codegen_guidelines()
    execution_context = execution_context or build_full_execution_context(None, steps, test_name)
    execution_block = format_history_for_prompt(execution_context)
    prompt = load_prompt_with_vars(
        'browser-use/codegen.md',
        execution_block=execution_block,
        framework_rules=framework_rules,
        symbol_graph_context=symbol_graph_context or 'None',
    )
    client, model_id = create_codegen_client(provider, llm_cfg)

    response = client.chat.completions.create(
        model=model_id,
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0.0
    )
    pricing_model = pricing_model_name(llm_cfg) or model_id
    usage_meta = getattr(response, 'usage', None)
    if usage_meta is not None:
        pt = getattr(usage_meta, 'prompt_tokens', 0) or 0
        ct = getattr(usage_meta, 'completion_tokens', 0) or 0
        merge_llm_usage(
            llm_usage_totals,
            pt,
            ct,
            estimate_cost_usd(pricing_model, pt, ct),
        )

    clean_text = response.choices[0].message.content.strip()
    
    if clean_text.startswith('```json'):
        clean_text = clean_text[7:]
    if clean_text.endswith('```'):
        clean_text = clean_text[:-3]
    clean_text = clean_text.strip()
    
    try:
        data = json.loads(clean_text)
        return data
    except Exception as e:
        print("Error parsing LLM response as JSON:", e)
        print("Raw response content was:")
        print(clean_text)
        return None

async def main():
    if len(sys.argv) < 3:
        print("Usage: python -m integrations.browser_use <test_file_path> <env_name>")
        sys.exit(1)
        
    test_file_path = sys.argv[1]
    env_name = sys.argv[2]
    
    test_name, steps = parse_txt_file(test_file_path)
    base_file_name = os.path.splitext(os.path.basename(test_file_path))[0]
    print(f"Parsed test name: {test_name}")
    print(f"Loaded steps:")
    all_sensitive: dict[str, str] = {}
    for step in steps:
        sanitized, inline = prepare_step(step, env_name)
        all_sensitive.update(inline)
        print(f"  - {redact_for_logs(sanitized, merge_sensitive_data(all_sensitive))}")
        
    provider = get_active_provider()
    try:
        provider, llm_cfg = resolve_provider_config(provider)
        validate_provider_config(provider, llm_cfg)
    except ValueError as cred_err:
        print(f"\n[WebPilot] LLM configuration error:\n{cred_err}\n")
        sys.exit(1)

    browser_cfg = load_browser_artifact_config()
    llm = create_browser_use_llm(provider, llm_cfg)
    print(f"[WebPilot] LLM provider={provider} model={llm_cfg.get('model', llm_cfg.get('deploymentId', ''))}")
    if provider == 'azure':
        print(f"[WebPilot] Azure endpoint={llm_cfg.get('endpoint', '')[:48]}...")
    
    task = "Please execute the following test scenario step-by-step:\n" + "\n".join(steps)
    task, sensitive_data = build_sensitive_data_context(task, env_name)
    upload_paths = resolve_upload_fixture_paths()
    if upload_paths:
        task += (
            "\n\nFor file upload steps, use this exact file path: "
            + upload_paths[0]
        )
    
    perf = load_performance_config()
    install_branding_hook()
    try:
        browser_kwargs = build_browser_kwargs(browser_cfg, test_name=base_file_name)
    except ValueError as browser_err:
        print(f"\n[WebPilot] Browser configuration error:\n{browser_err}\n")
        sys.exit(1)
    # Latency tuning: trim browser-use's default page-load / inter-action waits.
    for kwarg_key, perf_key in (
        ('minimum_wait_page_load_time', 'minPageLoadWait'),
        ('wait_for_network_idle_page_load_time', 'networkIdleWait'),
        ('wait_between_actions', 'waitBetweenActions'),
    ):
        if perf.get(perf_key) is not None:
            browser_kwargs[kwarg_key] = perf[perf_key]
    browser_kwargs['keep_alive'] = True  # Required between scoped discovery steps; shutdown_browser() closes at end.
    browser = Browser(**browser_kwargs)
    prefer_maximized_window(browser)
    print(
        f"[WebPilot] Performance: engine={perf.get('engineMode', 'native')} "
        f"judge={perf.get('judgeMode')} "
        f"vision={perf.get('useVision')} thinking={perf.get('useThinking')} "
        f"flash={perf.get('flashMode')} maxActions/step={perf.get('maxActionsPerStep')} "
        f"freshAgentPerStep={perf.get('freshAgentPerStep', True)} "
        f"maxHistory={perf.get('maxHistoryItems', 6)}"
    )

    llm_usage_totals = {
        'promptTokens': 0,
        'completionTokens': 0,
        'estimatedCostUsd': 0.0,
        'llmCalls': 0,
    }
    
    testmu_cfg = browser_cfg.get('testmu') or {}
    if testmu_cfg.get('enabled'):
        print(
            f"\nStarting WebPilot agent on TestMu remote browser "
            f"(platform={testmu_cfg.get('platform', 'Windows 10')}, "
            f"browser={testmu_cfg.get('browserName', 'Chrome')}, "
            f"trace={browser_cfg['record_trace']})..."
        )
    else:
        print(
            f"\nStarting WebPilot agent "
            f"(channel={browser_kwargs.get('channel', 'chrome')}, "
            f"headless={browser_cfg['headless']}, "
            f"video={browser_cfg['record_video']}, trace={browser_cfg['record_trace']})..."
        )
    scoped_agent = None
    try:
        engine_mode = str(perf.get('engineMode', 'native')).strip().lower()
        knowledge_only = os.environ.get('WEBPILOT_KNOWLEDGE_ONLY') == '1'
        legacy_js = os.environ.get('WEBPILOT_LEGACY_KNOWLEDGE_REPLAY') == '1'
        if knowledge_only and not legacy_js:
            print(
                '[WebPilot] WEBPILOT_KNOWLEDGE_ONLY without LEGACY flag reached Python runner unexpectedly. '
                'Knowledge-only replay is handled in Node via Playwright ActHistory/spec. '
                'Set WEBPILOT_LEGACY_KNOWLEDGE_REPLAY=1 only for deprecated JS site-knowledge.'
            )
        if engine_mode == 'native' and not knowledge_only:
            agent_ok, execution_context, scoped_agent = await run_native_browser_use_scenario(
                browser=browser,
                llm=llm,
                llm_cfg=llm_cfg,
                steps=steps,
                test_name=test_name,
                test_slug=base_file_name,
                env_name=env_name,
                sensitive_data=sensitive_data,
                upload_paths=upload_paths,
                llm_usage_totals=llm_usage_totals,
                perf=perf,
                test_file_path=test_file_path,
            )
        else:
            if engine_mode == 'native' and knowledge_only:
                print(
                    '[WebPilot] DEPRECATED: JS site-knowledge / scoped runner '
                    '(WEBPILOT_LEGACY_KNOWLEDGE_REPLAY=1). Prefer Playwright ActHistory replay.'
                )
            agent_ok, execution_context, scoped_agent = await run_intelligent_steps(
                browser=browser,
                llm=llm,
                llm_cfg=llm_cfg,
                steps=steps,
                test_name=test_name,
                test_slug=base_file_name,
                env_name=env_name,
                sensitive_data=sensitive_data,
                upload_paths=upload_paths,
                llm_usage_totals=llm_usage_totals,
                perf=perf,
                test_file_path=test_file_path,
            )
        execution_history = execution_context.get('executionHistory', [])
        runtime_insights = execution_context.get('runtimeInsights', {})
        _learn_rulebooks_from_execution(
            agent_ok=bool(agent_ok),
            execution_context=execution_context,
            knowledge_repo=None,
        )
        
        ensure_report_dirs()
        history_path = str(execution_history_path(base_file_name))
        with open(history_path, 'w', encoding='utf-8') as f_hist:
            json.dump({'test': base_file_name, **execution_context}, f_hist, indent=2, default=str)
        print(f"Saved full WebPilot execution context: {history_path}")
        print(f"  - {len(execution_history)} structured steps, {len(execution_context.get('urlSequence', []))} URLs")
        compact = execution_context.get('compactWorkflow')
        if isinstance(compact, dict) and compact.get('steps') is not None:
            wf_path = str(workflow_path(base_file_name))
            with open(wf_path, 'w', encoding='utf-8') as f_wf:
                json.dump(
                    {'test': base_file_name, 'compactWorkflow': compact},
                    f_wf,
                    indent=2,
                    default=str,
                )
            cov = compact.get('coverage') or {}
            print(
                f"  - Compact workflow: {wf_path} "
                f"({len(compact.get('steps') or [])} steps, "
                f"NL coverage {cov.get('mapped', 0)}/{cov.get('nlTotal', 0)})"
            )
        if runtime_insights.get('insights'):
            print("Runtime insights for codegen:")
            for ins in runtime_insights['insights']:
                print(f"  - {ins.get('type')}: {ins.get('message', '')[:120]}")
        metrics = execution_context.get('knowledgeMetrics') or {}
        if metrics:
            print(
                f"[Knowledge] Coverage {metrics.get('knowledgeCoverage', '?')} — "
                f"reused={metrics.get('reusedSteps', 0)} recipe={metrics.get('recipeSteps', 0)} "
                f"discovery={metrics.get('discoverySteps', 0)} repair={metrics.get('repairSteps', 0)} "
                f"learned={execution_context.get('learnedSteps', 0)}"
            )
            if metrics.get('blockingUnknownSteps'):
                print(f"[Knowledge] Blocking steps: {metrics.get('blockingUnknownSteps')}")
        
        symbol_graph_context = "None"
        symbol_graph_path = TEST_FRAMEWORK_ROOT / 'symbol_graph.json'
        if symbol_graph_path.exists():
            try:
                with open(symbol_graph_path, 'r') as f_sym:
                    symbol_graph_context = f_sym.read()
            except Exception as e:
                print("Warning: Could not read symbol_graph.json:", e)

        if not agent_ok:
            failure_lines = []
            for err in execution_context.get('errors') or []:
                if err:
                    failure_lines.append(str(err))
            for insight in (execution_context.get('runtimeInsights') or {}).get('insights') or []:
                message = insight.get('message')
                if message:
                    failure_lines.append(f"{insight.get('type', 'insight')}: {message}")
            failure_context = '\n'.join(failure_lines).strip() or (
                "WebPilot agent failed (LLM connection or step errors). "
                "Check .env Azure/OpenAI credentials."
            )
            if os.environ.get('WEBPILOT_CODEGEN') == '1':
                print(
                    "\n[Codegen] Skipped — only successful executions generate code. "
                    "Re-run after the scenario passes."
                )
            fail_tokens = (
                llm_usage_totals['promptTokens'] + llm_usage_totals['completionTokens']
            )
            report_summary = {
                "test": base_file_name,
                "testName": test_name,
                "testFile": test_file_path,
                "environment": env_name,
                "status": "FAILED",
                "timestamp": datetime.datetime.now().isoformat(),
                "stepsExecuted": len(execution_context.get('executionHistory') or []),
                "summary": "WebPilot agent failed (LLM connection or step errors). Check .env Azure/OpenAI credentials.",
                "failureContext": failure_context,
                "tokens": fail_tokens,
                "promptTokens": llm_usage_totals['promptTokens'],
                "completionTokens": llm_usage_totals['completionTokens'],
                "estimatedCostUsd": round(llm_usage_totals['estimatedCostUsd'], 6),
                "llmCalls": llm_usage_totals.get('llmCalls', 0),
                "browser": {
                    "target": browser_cfg.get('target', 'chrome'),
                    "headless": browser_cfg['headless'],
                    "viewport": browser_cfg.get('viewport'),
                    "provider": browser_provider_summary(browser_cfg),
                },
            }
            with open(summary_path(base_file_name), 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
            sys.exit(1)

        reuse_only = (
            int(execution_context.get('reusedSteps', 0)) == len(steps)
            and int(execution_context.get('learnedSteps', 0)) == 0
        )
        codegen_requested = os.environ.get('WEBPILOT_CODEGEN') == '1'
        if codegen_requested:
            print("\n[Codegen] Discovery completed. OpenHands will generate Playwright code from execution history.")
            codegen_summary = f"Discovery completed for {test_name}. OpenHands codegen queued from execution history."
        else:
            print("\n[Knowledge] Skipping Playwright code generation (use --codegen to enable it).")
            codegen_summary = (
                f"Reused {int(execution_context.get('reusedSteps', 0))} validated capabilities and learned "
                f"{int(execution_context.get('learnedSteps', 0))} capabilities with scoped WebPilot discovery."
            )

        if codegen_requested:
            save_llm_usage_file(test_file_path, llm_usage_totals, llm_cfg=llm_cfg)
            total_tokens = llm_usage_totals['promptTokens'] + llm_usage_totals['completionTokens']
            print(
                f"[LLM] Execution usage (browser agent): {total_tokens:,} tokens across "
                f"{llm_usage_totals['llmCalls']} call(s), "
                f"~${llm_usage_totals['estimatedCostUsd']:.4f} USD "
                f"(codegen validation totals are added after post-processing)"
            )
            
            report_summary = {
                "test": base_file_name,
                "testName": test_name,
                "testFile": test_file_path,
                "environment": env_name,
                "status": "PASSED",
                "timestamp": datetime.datetime.now().isoformat(),
                "stepsExecuted": len(execution_history) or len(steps),
                "summary": codegen_summary,
                "executionHistoryPath": history_path,
                "tokens": total_tokens,
                "promptTokens": llm_usage_totals['promptTokens'],
                "completionTokens": llm_usage_totals['completionTokens'],
                "estimatedCostUsd": round(llm_usage_totals['estimatedCostUsd'], 6),
                "llmCalls": llm_usage_totals['llmCalls'],
                "browser": {
                    "target": browser_cfg.get('target', 'chrome'),
                    "headless": browser_cfg['headless'],
                    "viewport": browser_cfg.get('viewport'),
                    "recordVideo": browser_cfg['record_video'],
                    "recordTrace": browser_cfg['record_trace'],
                    "provider": browser_provider_summary(browser_cfg),
                },
            }
            
            with open(summary_path(base_file_name), 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
        else:
            save_llm_usage_file(test_file_path, llm_usage_totals, llm_cfg=llm_cfg)
            total_tokens = llm_usage_totals['promptTokens'] + llm_usage_totals['completionTokens']
            reused_steps = int(execution_context.get('reusedSteps', 0))
            learned_steps = int(execution_context.get('learnedSteps', 0))
            report_summary = {
                "test": base_file_name,
                "testName": test_name,
                "testFile": test_file_path,
                "environment": env_name,
                "status": "PASSED",
                "executionMode": "intelligent-replay" if reuse_only else "intelligent-hybrid",
                "timestamp": datetime.datetime.now().isoformat(),
                "stepsExecuted": len(steps),
                "summary": codegen_summary,
                "executionHistoryPath": history_path,
                "tokens": total_tokens,
                "promptTokens": llm_usage_totals['promptTokens'],
                "completionTokens": llm_usage_totals['completionTokens'],
                "estimatedCostUsd": round(llm_usage_totals['estimatedCostUsd'], 6),
                "llmCalls": llm_usage_totals['llmCalls'],
                "knowledge": execution_context.get('knowledgeMetrics') or {
                    "reusedSteps": reused_steps,
                    "learnedSteps": learned_steps,
                },
                "browser": {
                    "target": browser_cfg.get('target', 'chrome'),
                    "headless": browser_cfg['headless'],
                    "viewport": browser_cfg.get('viewport'),
                    "recordVideo": browser_cfg['record_video'],
                    "recordTrace": browser_cfg['record_trace'],
                    "provider": browser_provider_summary(browser_cfg),
                },
            }
            with open(summary_path(base_file_name), 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
            
    except Exception as e:
        print(f"Error during execution: {e}")
        sys.exit(1)
    finally:
        # Persist usage even on mid-run failure / SystemExit so Job summary & reports aren't $0.
        try:
            usage_path = save_llm_usage_file(test_file_path, llm_usage_totals, llm_cfg=llm_cfg)
            total_tokens = (
                int(llm_usage_totals.get('promptTokens') or 0)
                + int(llm_usage_totals.get('completionTokens') or 0)
            )
            if total_tokens > 0:
                print(
                    f"[LLM] Saved usage → {usage_path} "
                    f"({total_tokens:,} tokens, "
                    f"~${float(llm_usage_totals.get('estimatedCostUsd') or 0):.4f} USD)"
                )
                report_path = str(resolve_summary_path(base_file_name))
                if os.path.exists(report_path):
                    with open(report_path, 'r', encoding='utf-8') as f_rep:
                        report_summary = json.load(f_rep)
                    summary_tokens = int(report_summary.get('tokens') or 0)
                    summary_cost = float(report_summary.get('estimatedCostUsd') or 0)
                    # Backfill when tokens missing, OR when tokens exist but cost stayed $0
                    # (LiteLLM miss / Azure deployment names — common in consumer installs).
                    if not summary_tokens or summary_cost <= 0:
                        report_summary['tokens'] = total_tokens
                        report_summary['promptTokens'] = llm_usage_totals['promptTokens']
                        report_summary['completionTokens'] = llm_usage_totals['completionTokens']
                        report_summary['estimatedCostUsd'] = round(
                            float(llm_usage_totals.get('estimatedCostUsd') or 0), 6
                        )
                        report_summary['llmCalls'] = llm_usage_totals.get('llmCalls', 0)
                        report_summary.setdefault('model', pricing_model_name(llm_cfg))
                        with open(report_path, 'w', encoding='utf-8') as f_rep:
                            json.dump(report_summary, f_rep, indent=2)
        except Exception as usage_err:
            print(f"Warning: could not save LLM usage: {usage_err}")

        history_path = str(execution_history_path(base_file_name))
        screenshot_paths = persist_screenshots(
            base_file_name,
            history_path,
            mode=browser_cfg.get('screenshots_mode', 'only-on-failure'),
        )
        finalized_video = None
        try:
            finalized_video = await shutdown_browser(browser, scoped_agent)
        except Exception as close_error:
            print(f"Warning: browser cleanup did not finish cleanly: {close_error}")
        artifact_paths = finalize_artifacts(
            base_file_name,
            browser_cfg['video_dir'] if browser_cfg.get('record_video') else None,
            browser_cfg['traces_dir'] if browser_cfg['record_trace'] else None,
            preferred_video=finalized_video,
        )
        artifact_paths = artifact_paths or {}
        artifact_paths['screenshots'] = screenshot_paths
        report_path = str(resolve_summary_path(base_file_name))
        if os.path.exists(report_path):
            with open(report_path, 'r', encoding='utf-8') as f_rep:
                report_summary = json.load(f_rep)
            merged = dict(report_summary.get('artifacts') or {})
            merged.update(artifact_paths)
            # Drop stale video when this run did not produce a usable recording.
            if 'video' not in artifact_paths:
                merged.pop('video', None)
            report_summary['artifacts'] = merged
            with open(report_path, 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
        trigger_html_reports(base_file_name, env_name, test_file_path, skip_ai=True)

if __name__ == "__main__":
    asyncio.run(main())
