import sys
import os

# WebPilot product defaults: disable upstream browser-use telemetry/version nags before import.
os.environ.setdefault('ANONYMIZED_TELEMETRY', 'false')
os.environ.setdefault('BROWSER_USE_VERSION_CHECK', 'false')
os.environ.setdefault('BROWSER_USE_CLOUD_SYNC', 'false')
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
import glob
import shutil
import tempfile
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
)

if BROWSER_USE_SOURCE_ROOT.is_dir():
    # Prefer WebPilot's editable source tree even if an older wheel is installed.
    sys.path.insert(0, str(BROWSER_USE_SOURCE_ROOT))

from browser_use import Agent, Browser
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
    build_nl_aligned_codegen_history,
    format_history_for_prompt,
)
from .branding import (
    build_browser_kwargs,
    install_branding_hook,
    push_branding_status,
)
from .testmu import load_testmu_config
from .prompt_loader import load_framework_rules, load_prompt_with_vars, load_discovery_step_rules
from .knowledge import (
    actions_from_output,
    capability_from_aligned_history_step,
    capability_from_step,
    compact_page_state,
    complete_microsoft_login_if_needed,
    ensure_auth_context_ready,
    execute_capability,
    KnowledgeRepository,
    load_knowledge_config,
    origin_for_url,
    prepare_page_for_interaction,
    progressive_outcome_indicates_success,
    try_recipe_step,
    url_pattern,
    validate_step_outcome,
)
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


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Approximate USD cost (mirrors utils/ModelPricing.ts)."""
    m = model.lower()
    input_per_m, output_per_m = 2.5, 10.0
    if 'gpt-4.1-mini' in m or 'gpt-4.1-nano' in m:
        input_per_m, output_per_m = 0.4, 1.6
    elif 'gpt-4.1' in m:
        input_per_m, output_per_m = 2.0, 8.0
    elif 'gpt-4o-mini' in m or 'gpt-4-mini' in m:
        input_per_m, output_per_m = 0.15, 0.6
    elif 'gpt-4o' in m:
        input_per_m, output_per_m = 2.5, 10.0
    elif 'gemini-2.5-flash' in m or 'gemini-2-flash' in m:
        input_per_m, output_per_m = 0.075, 0.3
    elif 'gemini-2.5-pro' in m or 'gemini-2-pro' in m:
        input_per_m, output_per_m = 1.25, 5.0
    elif 'claude-3-5-sonnet' in m:
        input_per_m, output_per_m = 3.0, 15.0
    return (prompt_tokens / 1_000_000) * input_per_m + (completion_tokens / 1_000_000) * output_per_m

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
            llm_cfg.get('model', llm_cfg.get('deploymentId', '')),
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
        model = ''
        if llm_cfg:
            model = str(llm_cfg.get('model') or llm_cfg.get('deploymentId') or '')
        cost = estimate_cost_usd(model, prompt, completion)
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
    test_name = "WebPilot Browser-Use Scenario"
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
        if re.match(r'^(target|baseUrl|codegen|report)\s*:', line_strip, re.IGNORECASE):
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
        cost = estimate_cost_usd(llm_cfg.get('model', ''), prompt, completion)
    totals['promptTokens'] += prompt
    totals['completionTokens'] += completion
    totals['estimatedCostUsd'] += cost
    totals['llmCalls'] += int(getattr(usage, 'entry_count', 0) or 0)


PERFORMANCE_DEFAULTS = {
    # native = one browser-use Agent for the full scenario (default — preserves engine intelligence).
    # scoped = one Agent per NL step (legacy WebPilot wrapper; use for knowledge repair only).
    'engineMode': 'native',
    'judgeMode': 'verification',
    'maxActionsPerStep': 6,
    'useVision': 'auto',
    'useThinking': True,
    'flashMode': False,
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
        for key in ('useThinking', 'flashMode'):
            if perf.get(key) is not None:
                cfg[key] = bool(perf[key])
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
) -> dict:
    return {
        'task': scoped_task,
        'llm': llm,
        'browser': browser,
        'calculate_cost': True,
        'register_new_step_callback': on_scoped_step,
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


async def shutdown_browser(browser: Any, scoped_agent: Any | None = None) -> None:
    """Force-close the browser after a run.

    keep_alive=True is required during multi-step discovery so agent.run() does not
    kill Chrome between steps, but the window must be closed when the job finishes.
    """
    # browser-use only flushes MP4 files when the ffmpeg writer closes (BrowserStopEvent
    # or an explicit stop_recording call). Finalize before kill so artifact collection
    # can find the file on disk.
    watchdog = getattr(browser, '_recording_watchdog', None)
    if watchdog is not None and getattr(watchdog, 'is_recording', False):
        try:
            saved = await watchdog.stop_recording()
            if saved:
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
        return
    except Exception as kill_error:
        print(f"Warning: browser shutdown did not finish cleanly: {kill_error}")

    try:
        await asyncio.wait_for(browser.kill(), timeout=25)
        return
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


def build_native_scenario_task(steps: list[str], discovery_rules: str) -> str:
    """Full-scenario task for stock browser-use — no per-step artificial stop rules."""
    numbered = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    return "\n".join(
        [
            "Execute this test scenario end-to-end in the browser.",
            "Handle cookie/consent banners, overlays, and auth flows yourself as needed.",
            "Complete every step in order. Do not stop after a single step.",
            "Prefer semantic locators (role, label, accessible name).",
            "Call done(success=true) only when the full scenario outcome is satisfied.",
            "",
            "Test steps:",
            numbered,
            "",
            "=== LOCATOR HINTS ===",
            discovery_rules,
        ]
    )


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
) -> tuple[bool, dict, Any | None]:
    """Run one browser-use Agent on the full scenario; history/codegen follow engine actions."""
    from .capability_contract import resolve_navigate_target

    perf = perf or dict(PERFORMANCE_DEFAULTS)
    judge_mode = str(perf.get('judgeMode', 'verification')).strip().lower()
    resolved_use_vision = _resolve_use_vision(perf.get('useVision', 'auto'))
    knowledge_repo = KnowledgeRepository(load_knowledge_config(), test_slug)
    from .prompt_loader import load_discovery_native_rules

    discovery_rules = load_discovery_native_rules()

    await browser.start()
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
    captured_actions: list[dict] = []
    native_agent = None

    async def on_native_step(state, output, _agent_step):
        if output is not None:
            captured_actions.extend(actions_from_output(state, output))
        if native_agent is None:
            return
        try:
            prompt, completion, cost, _calls = await read_browser_use_usage_snapshot(native_agent)
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
                    'currentText': 'Native browser-use agent running full scenario',
                    'tokens': total,
                    'cost': f"{llm_usage_totals['estimatedCostUsd'] + cost:.4f}",
                    'allSteps': [
                        {'index': i + 1, 'text': s, 'done': False}
                        for i, s in enumerate(steps)
                    ],
                },
            )
        except Exception:
            pass

    use_judge = judge_mode != 'off'
    print(
        f"[WebPilot] Engine mode=native (browser-use full-scenario agent, "
        f"maxSteps={int(perf.get('nativeAgentMaxSteps', 80))})"
    )
    native_agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        calculate_cost=True,
        register_new_step_callback=on_native_step,
        use_vision=resolved_use_vision,
        use_judge=use_judge,
        ground_truth="\n".join(sanitized_steps),
        enable_planning=True,
        use_thinking=bool(perf.get('useThinking', True)),
        flash_mode=bool(perf.get('flashMode', False)),
        max_actions_per_step=int(perf.get('maxActionsPerStep', 6)),
        max_history_items=_clamp_max_history_items(int(perf.get('maxHistoryItems', 30))),
        directly_open_url=True,
        llm_timeout=int(os.environ.get('WEBPILOT_LLM_TIMEOUT', '180') or 180),
        extend_system_message=(
            "You are executing a WebPilot QE scenario end-to-end. "
            "Follow the numbered Test steps in order without skipping. "
            "Never call done(success=true) after a single field fill or click — "
            "only when the full scenario outcome (last numbered step) is satisfied. "
            "Preserve session state. Dismiss blocking cookie/consent UIs before interacting with forms. "
            "For in-app navigation instructions (for example navigate to a menu or subarea), "
            "use click/search on the page — do not invent raw URLs."
        ),
        **(
            {'sensitive_data': step_sensitive_data}
            if step_sensitive_data
            else {}
        ),
        **(
            {'available_file_paths': upload_paths}
            if upload_paths
            else {}
        ),
    )

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
            llm_cfg.get('model', ''),
            max(0, after_prompt - before_prompt),
            max(0, after_completion - before_completion),
        )
    )
    llm_usage_totals['llmCalls'] += max(0, after_calls - before_calls)

    agent_ok = bool(getattr(history, 'is_successful', lambda: False)())
    context = build_full_execution_context(history, steps, test_name)
    context['engineMode'] = 'native'
    context['learnedSteps'] = 0
    context['reusedSteps'] = 0

    # Prefer locator-rich captures AND NL-aligned verify/screenshot steps for codegen.
    aligned = build_nl_aligned_codegen_history(
        steps,
        captured_actions=captured_actions,
        url_sequence=context.get('urlSequence') or [],
    )
    if aligned:
        context['executionHistory'] = aligned
        if captured_actions:
            context['nativeCapturedActions'] = captured_actions

    learned = 0
    if agent_ok and aligned:
        # Promote NL-aligned history so knowledge-only can replay clicks/asserts/go_back.
        browser_url = (context.get('urlSequence') or [None])[0] or 'about:blank'
        seq = list(context.get('urlSequence') or [])
        for nl_step, hist_step in zip(steps, aligned):
            hist_url = hist_step.get('url') or browser_url
            action = str(hist_step.get('action') or '')
            if action == 'click':
                after_url = browser_url
                if browser_url in seq:
                    idx = seq.index(browser_url)
                    if idx + 1 < len(seq):
                        after_url = seq[idx + 1]
                hist_step = {**hist_step, '_afterUrl': after_url}
            cap = capability_from_aligned_history_step(nl_step, hist_step, page_url=hist_url)
            if cap:
                before_pattern = cap.get('before', {}).get('urlPattern') or url_pattern(hist_url)
                # Verify/assert/screenshot: root origin precondition so homepage↔docs replay matches.
                if action in ('assert', 'screenshot') or str(cap.get('intent') or '') == 'verify':
                    origin = origin_for_url(before_pattern)
                    if origin and origin != '_global':
                        before_pattern = f"https://{origin}/"
                cap.setdefault('before', {})['urlPattern'] = before_pattern
                # Partition by BEFORE page origin so cross-origin navigations (portal→enwiki)
                # can still find the click/input capability on the page where it runs.
                if action != 'navigate':
                    cap['origin'] = origin_for_url(hist_url) or cap.get('origin')
                if action == 'go_back' or re.search(r'\b(navigate\s+back|go\s+back)\b', nl_step, re.I):
                    cap['postconditions'] = {
                        'urlPattern': None,
                        'requiredAnchors': [],
                        'notAllowedAnchors': [],
                        'requiredEvidence': [],
                        'requiredText': [],
                        'urlContains': [],
                        'forbiddenText': [],
                    }
                if str(cap.get('intent') or '') in ('interact', 'input'):
                    cap['postconditions'] = {
                        'urlPattern': None,
                        'requiredAnchors': [],
                        'notAllowedAnchors': [],
                        'requiredEvidence': [],
                        'requiredText': [],
                        'urlContains': [],
                        'forbiddenText': [],
                    }
                knowledge_repo.promote(cap)
                learned += 1
            if action == 'navigate' and hist_step.get('url'):
                browser_url = hist_step['url']
            elif action == 'go_back':
                for candidate in reversed(seq):
                    if candidate != browser_url:
                        browser_url = candidate
                        break
            elif action == 'click':
                browser_url = hist_step.get('_afterUrl') or browser_url
    elif agent_ok and captured_actions:
        # Fallback legacy path when aligned history was unavailable.
        after_state = await compact_page_state(browser)
        url_now = after_state.get('url') or await browser.get_current_page_url()
        action_idx = 0
        for step in steps:
            nav = resolve_navigate_target(step)
            if nav:
                before = {'url': 'about:blank', 'urlPattern': 'about:blank', 'anchors': [], 'evidence': []}
                after = {'url': nav, 'urlPattern': nav, 'anchors': [], 'evidence': []}
                cap = capability_from_step(step, before, after, [{'type': 'navigate', 'url': nav}])
                if cap:
                    knowledge_repo.promote(cap)
                    learned += 1
                continue
            if re.match(r'^(verify|assert|check|ensure)\b', step.strip(), re.I):
                continue
            while action_idx < len(captured_actions):
                action = captured_actions[action_idx]
                action_idx += 1
                if action.get('type') not in ('click', 'input', 'press', 'go_back'):
                    continue
                before = {
                    'url': url_now,
                    'urlPattern': url_now,
                    'anchors': [],
                    'evidence': [],
                }
                after = await compact_page_state(browser)
                cap = capability_from_step(step, before, after, [action])
                if cap:
                    knowledge_repo.promote(cap)
                    learned += 1
                break

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
        'knowledgeCoverage': f"{round((learned / len(steps)) * 100, 1) if steps else 0.0}%",
        'fullReplayEligible': False,
        'engineMode': 'native',
    }
    if not agent_ok:
        context['failure'] = 'Native browser-use agent did not complete the scenario successfully'
        context['errors'] = [context['failure']]
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

    await browser.start()
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
        if output is not None:
            active_capture.extend(actions_from_output(state, output))
        if scoped_agent is not None:
            try:
                prompt, completion, cost, _calls = await read_browser_use_usage_snapshot(scoped_agent)
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
                        'currentText': active_step_text,
                        'tokens': total,
                        'cost': f"{llm_usage_totals['estimatedCostUsd'] + cost:.4f}",
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

        scoped_task = build_scoped_task(
            sanitized_step,
            step,
            page_state=page_state,
            credential_suffix=credential_task_suffix(step_sensitive),
            discovery_rules=load_discovery_step_rules(),
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
                )
            )
        else:
            scoped_agent.settings.ground_truth = sanitized_step
            scoped_agent.settings.use_judge = step_use_judge
            scoped_agent.add_new_task(scoped_task)

        before_prompt, before_completion, before_cost, before_calls = await read_browser_use_usage_snapshot(scoped_agent)
        history = await scoped_agent.run(max_steps=scoped_max_steps)
        step_ok = bool(getattr(history, 'is_successful', lambda: False)())
        if not step_ok and step_retry_on_failure > 0:
            print(f"[WebPilot] Step {step_index} failed — retrying once with a fresh agent...")
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
                )
            )
            history = await scoped_agent.run(max_steps=scoped_max_steps)
            step_ok = bool(getattr(history, 'is_successful', lambda: False)())

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
            else estimate_cost_usd(llm_cfg.get('model', ''), delta_prompt, delta_completion)
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
    return True, context, scoped_agent


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
        defaults['record_video'] = browser.get('video', 'off') not in ('off', False, None)
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
    except Exception as e:
        print("Warning: Could not parse config/webpilot.yaml for artifacts:", e)
    # BA no longer uses imageio/ffmpeg screencast recording — ignore ffmpeg availability.
    env_video = os.environ.get('WEBPILOT_VIDEO', '').strip().lower()
    if env_video in ('off', '0', 'false', 'no'):
        defaults['record_video'] = False
    elif env_video in ('on', '1', 'true', 'yes'):
        defaults['record_video'] = True
    env_headless = os.environ.get('WEBPILOT_HEADLESS', '').strip().lower()
    if env_headless in ('1', 'true', 'yes', 'on'):
        defaults['headless'] = True
    elif env_headless in ('0', 'false', 'no', 'off'):
        defaults['headless'] = False
    os.makedirs(defaults['video_dir'], exist_ok=True)
    os.makedirs(defaults['traces_dir'], exist_ok=True)
    return defaults


def browser_provider_summary(browser_cfg):
    testmu_cfg = browser_cfg.get('testmu') or {}
    provider = browser_cfg.get('provider') or ('testmu' if testmu_cfg.get('enabled') else 'browser-use')
    if provider == 'testmu' or testmu_cfg.get('enabled'):
        return {
            'provider': 'testmu',
            'browserName': testmu_cfg.get('browserName', 'Chrome'),
            'browserVersion': testmu_cfg.get('browserVersion', 'latest'),
            'platform': testmu_cfg.get('platform', 'Windows 10'),
        }
    return {
        'provider': 'browser-use',
        'browserName': browser_cfg.get('target', 'chrome'),
        'platform': 'local',
    }

def _latest_files(search_roots, patterns):
    """Collect files matching patterns under each root (newest mtime wins)."""
    found = []
    for root in search_roots:
        if not root or not os.path.isdir(root):
            continue
        for pattern in patterns:
            found.extend(glob.glob(os.path.join(root, '**', pattern), recursive=True))
    found.sort(key=os.path.getmtime)
    return found


def persist_screenshots(test_slug, history_path):
    """Copy browser-use step screenshots into reports/ before temp dirs are removed."""
    if not history_path or not os.path.isfile(history_path):
        return []
    try:
        with open(history_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return []

    dest_dir = str(REPORTS_SCREENSHOTS_DIR / test_slug)
    os.makedirs(dest_dir, exist_ok=True)
    saved = []
    seen = set()

    dump = data.get('fullHistoryDump') or {}
    for item in dump.get('history') or []:
        if not isinstance(item, dict):
            continue
        state = item.get('state') or {}
        if not isinstance(state, dict):
            continue
        sp = state.get('screenshot_path')
        if not sp or not os.path.isfile(sp) or sp in seen:
            continue
        seen.add(sp)
        dest = os.path.join(dest_dir, os.path.basename(sp))
        try:
            shutil.copy2(sp, dest)
            saved.append(dest.replace('\\', '/'))
        except Exception as e:
            print(f"Warning: could not copy screenshot {sp}: {e}")

    if saved:
        print(f"Saved {len(saved)} screenshot(s) under {dest_dir}")
    return saved


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
    reuse_only = False
    try:
        subprocess.run(cmd, cwd=os.getcwd(), check=False, timeout=300)
    except Exception as e:
        print(f"Warning: HTML report generation skipped: {e}")


def finalize_artifacts(test_slug, video_dir, traces_dir):
    """Copy latest browser-use recordings into reports/ with stable names."""
    artifacts = {}

    video_roots = []
    for d in (video_dir, str(REPORTS_VIDEOS_DIR)):
        if d:
            video_roots.append(os.path.abspath(d))
    video_roots.append(tempfile.gettempdir())

    videos = _latest_files(video_roots, ('*.webm', '*.mp4'))
    if videos:
        src = videos[-1]
        ext = os.path.splitext(src)[1] or '.webm'
        dest = str(REPORTS_VIDEOS_DIR / f'{test_slug}{ext}')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.abspath(src) != os.path.abspath(dest):
            shutil.copy2(src, dest)
        artifacts['video'] = dest
        print(f"Saved execution video: {dest}")

    trace_roots = []
    for d in (traces_dir, str(REPORTS_TRACES_DIR)):
        if d:
            trace_roots.append(os.path.abspath(d))
    trace_roots.append(tempfile.gettempdir())

    traces = _latest_files(trace_roots, ('*.zip',))
    if traces:
        src = traces[-1]
        dest = str(REPORTS_TRACES_DIR / f'{test_slug}_trace.zip')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.abspath(src) != os.path.abspath(dest):
            shutil.copy2(src, dest)
        artifacts['trace'] = dest
        print(f"Saved execution trace: {dest}")

    return artifacts


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
    pricing_model = llm_cfg.get('model', model_id)
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
            )
        else:
            if engine_mode == 'native' and knowledge_only:
                print('[WebPilot] WEBPILOT_KNOWLEDGE_ONLY=1 — using scoped/deterministic runner')
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
            )
        execution_history = execution_context.get('executionHistory', [])
        runtime_insights = execution_context.get('runtimeInsights', {})
        
        ensure_report_dirs()
        history_path = str(execution_history_path(base_file_name))
        with open(history_path, 'w', encoding='utf-8') as f_hist:
            json.dump({'test': base_file_name, **execution_context}, f_hist, indent=2, default=str)
        print(f"Saved full WebPilot execution context: {history_path}")
        print(f"  - {len(execution_history)} structured steps, {len(execution_context.get('urlSequence', []))} URLs")
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
        skip_codegen = not codegen_requested
        codegen_mode = resolve_codegen_mode()
        code_data = None
        if skip_codegen:
            print("\n[Knowledge] Skipping Playwright code generation (use --codegen to enable it).")
        elif codegen_mode in ('deterministic', 'auto'):
            print(f"\n[Codegen] Queuing deterministic codegen (mode={codegen_mode}) — no LLM file generation.")
            code_data = {
                'deterministic': True,
                'summary': f'Deterministic codegen queued for {test_name}.',
            }
        else:
            print(f"\nGenerating Playwright TS code ({provider})...")
            code_data = await generate_playwright_code(
                provider,
                llm_cfg,
                test_name,
                steps,
                llm_usage_totals,
                symbol_graph_context,
                execution_context=execution_context,
            )
        
        if code_data:
            files = []
            if code_data.get('deterministic'):
                files = []
            elif isinstance(code_data.get('files'), list):
                files = code_data['files']
            else:
                pom_path = code_data.get('pom_file_path')
                pom_content = code_data.get('pom_content')
                spec_path = code_data.get('spec_file_path')
                spec_content = code_data.get('spec_content')
                if pom_path and pom_content:
                    files.append({"path": pom_path, "content": pom_content})
                if spec_path and spec_content:
                    files.append({"path": spec_path, "content": spec_content})

            TEST_FRAMEWORK_ROOT.mkdir(parents=True, exist_ok=True)
            temp_codegen = {
                "deterministic": bool(code_data.get('deterministic')),
                "files": files,
                "executionContext": execution_context,
                "executionHistoryPath": history_path,
                "summary": code_data.get('summary') or f"Executed: {test_name}. Automated POM and spec created.",
            }
            with open(TEST_FRAMEWORK_ROOT / 'temp_codegen.json', 'w', encoding='utf-8') as f_temp:
                json.dump(temp_codegen, f_temp, indent=2)
                
            print(f"Exported codegen data to: packages/test-framework/temp_codegen.json for AST-based merging")

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
                "summary": temp_codegen["summary"],
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
                
        elif not skip_codegen:
            print("Failed to generate code via LLM.")

        if skip_codegen:
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
                "summary": (
                    f"Reused {reused_steps} validated capabilities and learned "
                    f"{learned_steps} capabilities with scoped WebPilot discovery."
                ),
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
                    if not report_summary.get('tokens'):
                        report_summary['tokens'] = total_tokens
                        report_summary['promptTokens'] = llm_usage_totals['promptTokens']
                        report_summary['completionTokens'] = llm_usage_totals['completionTokens']
                        report_summary['estimatedCostUsd'] = round(
                            float(llm_usage_totals.get('estimatedCostUsd') or 0), 6
                        )
                        report_summary['llmCalls'] = llm_usage_totals.get('llmCalls', 0)
                        with open(report_path, 'w', encoding='utf-8') as f_rep:
                            json.dump(report_summary, f_rep, indent=2)
        except Exception as usage_err:
            print(f"Warning: could not save LLM usage: {usage_err}")

        history_path = str(execution_history_path(base_file_name))
        screenshot_paths = persist_screenshots(base_file_name, history_path)
        try:
            await shutdown_browser(browser, scoped_agent)
        except Exception as close_error:
            print(f"Warning: browser cleanup did not finish cleanly: {close_error}")
        artifact_paths = finalize_artifacts(
            base_file_name,
            browser_cfg['video_dir'] if browser_cfg['record_video'] else None,
            browser_cfg['traces_dir'] if browser_cfg['record_trace'] else None,
        )
        if screenshot_paths:
            artifact_paths = artifact_paths or {}
            artifact_paths['screenshots'] = screenshot_paths
        report_path = str(resolve_summary_path(base_file_name))
        if os.path.exists(report_path):
            with open(report_path, 'r', encoding='utf-8') as f_rep:
                report_summary = json.load(f_rep)
            if artifact_paths:
                report_summary['artifacts'] = {
                    **(report_summary.get('artifacts') or {}),
                    **artifact_paths,
                }
            with open(report_path, 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
        trigger_html_reports(base_file_name, env_name, test_file_path, skip_ai=True)

if __name__ == "__main__":
    asyncio.run(main())
