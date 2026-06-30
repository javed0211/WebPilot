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

import json
import asyncio
import re
import datetime
import yaml
import glob
import shutil
import tempfile
from typing import Any

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
    build_full_execution_context,
    format_history_for_prompt,
)
from .branding import (
    build_browser_kwargs,
    install_branding_hook,
    push_branding_status,
)
from .testmu import load_testmu_config
from .prompt_loader import load_framework_rules, load_prompt_with_vars
from .knowledge import (
    actions_from_output,
    capability_from_step,
    compact_page_state,
    execute_capability,
    find_capability,
    load_knowledge,
    promote_capability,
    record_failure,
    try_recipe_step,
)

BDD_PREFIXES = ('given', 'when', 'then', 'and', 'but')
NUMBERED_STEP_RE = re.compile(r'^\d+\.\s+')
ENV_VAR_RE = re.compile(r'\$\{(\w+)\}')

def _resolve_env_vars(value: str) -> str:
    def repl(match: re.Match) -> str:
        return os.environ.get(match.group(1), match.group(0))

    return ENV_VAR_RE.sub(repl, value)


def _is_unresolved_placeholder(value: str) -> bool:
    stripped = (value or '').strip()
    return bool(stripped) and stripped.startswith('${') and stripped.endswith('}')


def _resolve_credential_value(raw: str, *fallback_env_keys: str) -> str:
    resolved = _resolve_env_vars(raw).strip()
    if resolved and not _is_unresolved_placeholder(resolved):
        return resolved
    for key in fallback_env_keys:
        fallback = (os.environ.get(key) or '').strip()
        if fallback:
            return fallback
    return resolved


def load_environment_credentials(env_name: str) -> dict[str, str]:
    """Load resolved credentials from config/environments/<env>.json."""
    _load_dotenv()
    config_path = CONFIG_ROOT / 'environments' / f'{env_name}.json'
    if not os.path.isfile(config_path):
        return {}
    with open(config_path, encoding='utf-8') as f:
        config = json.load(f)
    raw = config.get('credentials') or {}
    resolved: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(value, str):
            if key == 'username':
                resolved[key] = _resolve_credential_value(value, 'QA_USERNAME')
            elif key == 'password':
                resolved[key] = _resolve_credential_value(value, 'QA_PASSWORD')
            else:
                resolved[key] = _resolve_env_vars(value)
    return resolved


def build_sensitive_data_context(
    task: str,
    env_name: str,
) -> tuple[str, dict[str, str | dict[str, str]]]:
    """Expose credential placeholders to Browser Use without putting values in the LLM prompt."""
    lowered = task.lower()
    if 'valid credentials' not in lowered and 'sign in' not in lowered and 'sign-in' not in lowered:
        return task, {}

    creds = load_environment_credentials(env_name)
    username = (creds.get('username') or '').strip()
    password = (creds.get('password') or '').strip()
    if not username and not password:
        return task, {}

    placeholders: dict[str, str] = {}
    if username:
        placeholders['username'] = username
    if password and not _is_unresolved_placeholder(password):
        placeholders['password'] = password

    if not placeholders:
        return task, {}

    lines = [
        '\n\nFor sign-in steps, use the sensitive-data placeholders exposed by WebPilot.',
        'Never print, extract, or repeat credential values.',
    ]
    sensitive_data: dict[str, str | dict[str, str]] = placeholders
    return task + '\n'.join(lines), sensitive_data


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


def save_llm_usage_file(test_file_path: str, totals: dict) -> str:
    base_file_name = os.path.splitext(os.path.basename(test_file_path))[0]
    ensure_report_dirs()
    out_path = llm_usage_path(base_file_name)
    payload = {
        'promptTokens': totals['promptTokens'],
        'completionTokens': totals['completionTokens'],
        'estimatedCostUsd': round(totals['estimatedCostUsd'], 6),
        'llmCalls': totals['llmCalls'],
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
    'judgeMode': 'verification',
    'maxActionsPerStep': 6,
    'useVision': 'auto',
    'useThinking': True,
    'flashMode': False,
    'minPageLoadWait': 0.1,
    'networkIdleWait': 0.3,
    'waitBetweenActions': 0.3,
    'scopedAgentMaxSteps': 12,
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
        perf = ir.get('performance') or {}
        for key in ('judgeMode', 'useVision'):
            if perf.get(key) is not None:
                cfg[key] = str(perf[key]).strip().lower()
        if perf.get('maxActionsPerStep') is not None:
            cfg['maxActionsPerStep'] = int(perf['maxActionsPerStep'])
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
    return cfg


def _is_verification_step(step: str) -> bool:
    s = (step or '').lower()
    return any(keyword in s for keyword in VERIFICATION_KEYWORDS)


def _judge_enabled_for_step(judge_mode: str, step: str) -> bool:
    if judge_mode == 'off':
        return False
    if judge_mode == 'always':
        return True
    return _is_verification_step(step)


def _resolve_use_vision(use_vision: str):
    if use_vision == 'auto':
        return 'auto'
    return use_vision in ('always', 'true', 'on', '1')


async def run_intelligent_steps(
    *,
    browser: Any,
    llm: Any,
    llm_cfg: dict,
    steps: list[str],
    test_name: str,
    sensitive_data: dict,
    upload_paths: list[str],
    llm_usage_totals: dict,
    perf: dict | None = None,
) -> tuple[bool, dict]:
    """Execute known steps deterministically and delegate only missing steps to WebPilot discovery."""
    perf = perf or dict(PERFORMANCE_DEFAULTS)
    judge_mode = perf.get('judgeMode', 'verification')
    scoped_max_steps = int(perf.get('scopedAgentMaxSteps', 12))
    resolved_use_vision = _resolve_use_vision(perf.get('useVision', 'auto'))
    knowledge = load_knowledge()
    force_discovery = os.environ.get('WEBPILOT_DISABLE_SITE_KNOWLEDGE') == '1'
    knowledge_only = os.environ.get('WEBPILOT_KNOWLEDGE_ONLY') == '1'
    execution_history: list[dict] = []
    url_sequence: list[str] = []
    learned = 0
    reused = 0
    scoped_agent = None
    active_capture: list[dict] = []
    active_step_index = 0
    active_step_text = ""

    await browser.start()

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
        current_url = await browser.get_current_page_url()
        if not url_sequence or url_sequence[-1] != current_url:
            url_sequence.append(current_url)

        capability = None if force_discovery else find_capability(knowledge, step, current_url)
        if capability:
            print(f"[Knowledge] Step {step_index}/{len(steps)} deterministic: {step}")
            ok, reason = await execute_capability(browser, capability)
            if ok:
                reused += 1
                promote_capability(knowledge, capability)
                execution_history.append({
                    "index": len(execution_history) + 1,
                    "action": "knowledge-replay",
                    "description": step,
                    "url": await browser.get_current_page_url(),
                })
                continue
            record_failure(knowledge, capability, reason)
            print(f"[Knowledge] Validation failed; scoped WebPilot repair: {reason}")

        recipe_handled, recipe_ok, recipe_reason = await try_recipe_step(browser, step)
        if recipe_handled and recipe_ok:
            print(f"[Knowledge] Step {step_index}/{len(steps)} recipe replay: {step}")
            reused += 1
            execution_history.append({
                "index": len(execution_history) + 1,
                "action": "recipe-replay",
                "description": step,
                "url": await browser.get_current_page_url(),
            })
            continue
        if recipe_handled and not recipe_ok:
            print(f"[Knowledge] Recipe replay failed; scoped WebPilot repair: {recipe_reason}")

        if knowledge_only:
            return False, {
                "failure": f'No validated knowledge for step {step_index}: {step}',
                "executionHistory": execution_history,
                "urlSequence": url_sequence,
                "reusedSteps": reused,
                "learnedSteps": learned,
            }

        print(f"[Discovery] Step {step_index}/{len(steps)} WebPilot: {step}")
        before = await compact_page_state(browser)
        captured_actions: list[dict] = []
        active_capture = captured_actions
        active_step_index = step_index
        active_step_text = step

        scoped_task = (
            f"Execute ONLY this test step and verify it is complete:\n{step}\n\n"
            f"This is step {step_index} of {len(steps)} in test '{test_name}'. "
            "Do not execute later test steps. Preserve all existing browser state. "
            "Use done(success=true) only after this step's observable result is satisfied."
        )
        step_use_judge = _judge_enabled_for_step(judge_mode, step)
        if scoped_agent is None:
            agent_kwargs = {
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
                'max_history_items': 8,
                'directly_open_url': False,
            }
            if sensitive_data:
                agent_kwargs['sensitive_data'] = sensitive_data
            if upload_paths:
                agent_kwargs['available_file_paths'] = upload_paths
            scoped_agent = Agent(**agent_kwargs)
        else:
            scoped_agent.settings.ground_truth = step
            scoped_agent.settings.use_judge = step_use_judge
            scoped_agent.add_new_task(scoped_task)

        before_prompt, before_completion, before_cost, before_calls = await read_browser_use_usage_snapshot(scoped_agent)
        history = await scoped_agent.run(max_steps=scoped_max_steps)
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
        step_ok = bool(getattr(history, 'is_successful', lambda: False)())
        if not step_ok:
            return False, {
                "failure": f'WebPilot could not complete step {step_index}: {step}',
                "executionHistory": execution_history,
                "urlSequence": url_sequence,
                "reusedSteps": reused,
                "learnedSteps": learned,
            }

        after = await compact_page_state(browser)
        capability = capability_from_step(step, before, after, captured_actions)
        if capability:
            promote_capability(knowledge, capability)
            learned += 1
        for action in captured_actions:
            execution_history.append({
                "index": len(execution_history) + 1,
                "action": action.get("type", "browser-use"),
                "selector": json.dumps(action.get("locators")) if action.get("locators") else None,
                "value": action.get("value"),
                "url": action.get("url") or after.get("url"),
                "description": step,
            })
        if not captured_actions:
            execution_history.append({
                "index": len(execution_history) + 1,
                "action": "browser-use-assertion",
                "url": after.get("url"),
                "description": step,
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
                "message": f"Reused {reused} validated steps and learned {learned} steps with scoped WebPilot discovery.",
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
    }
    return True, context


def load_browser_artifact_config():
    """Read video/trace paths from config/webpilot.yaml."""
    defaults = {
        'headless': True,
        'target': 'chrome',
        'viewport': {'width': 1280, 'height': 720},
        'video_dir': str(REPORTS_VIDEOS_DIR),
        'traces_dir': str(REPORTS_TRACES_DIR),
        'record_video': True,
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
        defaults['record_video'] = browser.get('video', 'on') not in ('off', False)
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
    for step in steps:
        print(f"  - {step}")
        
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
    browser_kwargs['keep_alive'] = True
    browser = Browser(**browser_kwargs)
    print(
        f"[WebPilot] Performance: judge={perf.get('judgeMode')} "
        f"vision={perf.get('useVision')} thinking={perf.get('useThinking')} "
        f"flash={perf.get('flashMode')} maxActions/step={perf.get('maxActionsPerStep')}"
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
    try:
        agent_ok, execution_context = await run_intelligent_steps(
            browser=browser,
            llm=llm,
            llm_cfg=llm_cfg,
            steps=steps,
            test_name=test_name,
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

            save_llm_usage_file(test_file_path, llm_usage_totals)
            total_tokens = llm_usage_totals['promptTokens'] + llm_usage_totals['completionTokens']
            print(
                f"[LLM] Total job usage: {total_tokens:,} tokens across "
                f"{llm_usage_totals['llmCalls']} call(s), "
                f"~${llm_usage_totals['estimatedCostUsd']:.4f} USD"
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
            save_llm_usage_file(test_file_path, llm_usage_totals)
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
                "knowledge": {
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
        history_path = str(execution_history_path(base_file_name))
        screenshot_paths = persist_screenshots(base_file_name, history_path)
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
        try:
            await asyncio.wait_for(browser.kill(), timeout=20)
        except Exception as close_error:
            print(f"Warning: browser cleanup did not finish cleanly: {close_error}")
        trigger_html_reports(base_file_name, env_name, test_file_path, skip_ai=True)

if __name__ == "__main__":
    asyncio.run(main())
