import sys
import os
import json
import asyncio
import re
import datetime
import yaml
import glob
import shutil
import tempfile
from browser_use import Agent, Browser, ChatAzureOpenAI
from execution_history_export import (
    build_full_execution_context,
    format_history_for_prompt,
)
from webpilot_browser_branding import (
    build_browser_kwargs,
    install_branding_hook,
    push_branding_status,
)
from prompt_loader import load_framework_rules, load_prompt_with_vars

BDD_PREFIXES = ('given', 'when', 'then', 'and', 'but')
NUMBERED_STEP_RE = re.compile(r'^\d+\.\s+')

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
    azure: dict,
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
            azure.get('model', azure.get('deploymentId', '')),
            totals['promptTokens'],
            totals['completionTokens'],
        )
    return total_tokens, totals['estimatedCostUsd']


def save_llm_usage_file(test_file_path: str, totals: dict) -> str:
    base_file_name = os.path.splitext(os.path.basename(test_file_path))[0]
    os.makedirs('reports', exist_ok=True)
    out_path = os.path.join('reports', f'{base_file_name}_llm_usage.json')
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
    base_page_path = os.path.join('framework', 'core', 'BasePage.ts')
    parts = [load_framework_rules()]
    if os.path.exists(base_page_path):
        with open(base_page_path, 'r', encoding='utf-8') as f:
            parts.append('BasePage source (subclasses MUST call these methods):\n' + f.read())
    return '\n\n'.join(parts)

def resolve_upload_fixture_paths():
    """Absolute paths browser-use Agent may upload (contact form, etc.)."""
    candidates = [
        os.path.join(os.getcwd(), 'tests', 'fixtures', 'sample.txt'),
        os.path.join(os.getcwd(), 'framework', 'data', 'sample.txt'),
    ]
    return [os.path.abspath(p) for p in candidates if os.path.isfile(p)]


def load_browser_artifact_config():
    """Read video/trace paths from config/webpilot.yaml."""
    defaults = {
        'headless': True,
        'target': 'chrome',
        'viewport': {'width': 1280, 'height': 720},
        'video_dir': os.path.join('reports', 'videos'),
        'traces_dir': os.path.join('reports', 'traces'),
        'record_video': True,
        'record_trace': True,
    }
    try:
        with open('config/webpilot.yaml', 'r') as f:
            yaml_config = yaml.safe_load(f) or {}
        browser = yaml_config.get('browser', {})
        defaults['headless'] = browser.get('headless', True)
        defaults['target'] = browser.get('target', 'chrome')
        vp = browser.get('viewport')
        if isinstance(vp, dict) and vp.get('width') and vp.get('height'):
            defaults['viewport'] = {'width': int(vp['width']), 'height': int(vp['height'])}
        defaults['record_video'] = browser.get('video', 'on') not in ('off', False)
        trace_val = browser.get('trace', True)
        defaults['record_trace'] = trace_val not in ('off', False, None)
        artifacts = yaml_config.get('framework', {}).get('artifactsPath', './artifacts')
        if artifacts:
            pass
    except Exception as e:
        print("Warning: Could not parse config/webpilot.yaml for artifacts:", e)
    os.makedirs(defaults['video_dir'], exist_ok=True)
    os.makedirs(defaults['traces_dir'], exist_ok=True)
    return defaults

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

    dest_dir = os.path.join('reports', 'screenshots', test_slug)
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


def trigger_html_reports(test_slug, env_name, test_file_path):
    """Generate reports/index.html (fast path via run-cli.ts)."""
    import subprocess
    cli = os.path.join('core', 'execution_report', 'run-cli.ts')
    cmd = ['npx', 'ts-node', cli, '--env', env_name, '--test', test_slug]
    try:
        subprocess.run(cmd, cwd=os.getcwd(), check=False, timeout=300)
    except Exception as e:
        print(f"Warning: HTML report generation skipped: {e}")


def finalize_artifacts(test_slug, video_dir, traces_dir):
    """Copy latest browser-use recordings into reports/ with stable names."""
    artifacts = {}

    video_roots = []
    for d in (video_dir, os.path.join('reports', 'videos')):
        if d:
            video_roots.append(os.path.abspath(d))
    video_roots.append(tempfile.gettempdir())

    videos = _latest_files(video_roots, ('*.webm', '*.mp4'))
    if videos:
        src = videos[-1]
        ext = os.path.splitext(src)[1] or '.webm'
        dest = os.path.join('reports', 'videos', f'{test_slug}{ext}')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src, dest)
        artifacts['video'] = dest
        print(f"Saved execution video: {dest}")

    trace_roots = []
    for d in (traces_dir, os.path.join('reports', 'traces')):
        if d:
            trace_roots.append(os.path.abspath(d))
    trace_roots.append(tempfile.gettempdir())

    traces = _latest_files(trace_roots, ('*.zip',))
    if traces:
        src = traces[-1]
        dest = os.path.join('reports', 'traces', f'{test_slug}_trace.zip')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src, dest)
        artifacts['trace'] = dest
        print(f"Saved execution trace: {dest}")

    return artifacts

async def generate_playwright_code(
    azure,
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
    from openai import AzureOpenAI
    client = AzureOpenAI(
        api_key=azure['apiKey'],
        api_version=azure['apiVersion'],
        azure_endpoint=azure['endpoint']
    )
    
    response = client.chat.completions.create(
        model=azure['deploymentId'],
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0.0
    )
    usage_meta = getattr(response, 'usage', None)
    if usage_meta is not None:
        pt = getattr(usage_meta, 'prompt_tokens', 0) or 0
        ct = getattr(usage_meta, 'completion_tokens', 0) or 0
        merge_llm_usage(
            llm_usage_totals,
            pt,
            ct,
            estimate_cost_usd(azure.get('model', azure['deploymentId']), pt, ct),
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
        print("Usage: python3 browser_use_runner.py <test_file_path> <env_name>")
        sys.exit(1)
        
    test_file_path = sys.argv[1]
    env_name = sys.argv[2]
    
    test_name, steps = parse_txt_file(test_file_path)
    base_file_name = os.path.splitext(os.path.basename(test_file_path))[0]
    print(f"Parsed test name: {test_name}")
    print(f"Loaded steps:")
    for step in steps:
        print(f"  - {step}")
        
    with open('config/llm.json', 'r') as f:
        llm_config = json.load(f)
    
    azure = llm_config['azure']
    browser_cfg = load_browser_artifact_config()
    
    os.environ["AZURE_OPENAI_API_KEY"] = azure['apiKey']
    os.environ["AZURE_OPENAI_ENDPOINT"] = azure['endpoint']
    os.environ["OPENAI_API_VERSION"] = azure['apiVersion']
    
    llm = ChatAzureOpenAI(
        model=azure['model'],
        api_key=azure['apiKey'],
        azure_endpoint=azure['endpoint'],
        azure_deployment=azure['deploymentId'],
        api_version=azure['apiVersion'],
        temperature=0.0
    )
    
    task = "Please execute the following test scenario step-by-step:\n" + "\n".join(steps)
    upload_paths = resolve_upload_fixture_paths()
    if upload_paths:
        task += (
            "\n\nFor file upload steps, use this exact file path: "
            + upload_paths[0]
        )
    
    install_branding_hook()
    browser_kwargs = build_browser_kwargs(browser_cfg)
    browser = Browser(**browser_kwargs)

    llm_usage_totals = {
        'promptTokens': 0,
        'completionTokens': 0,
        'estimatedCostUsd': 0.0,
        'llmCalls': 0,
    }
    
    print(
        f"\nStarting browser-use agent "
        f"(channel={browser_kwargs.get('channel', 'chrome')}, "
        f"headless={browser_cfg['headless']}, "
        f"video={browser_cfg['record_video']}, trace={browser_cfg['record_trace']})..."
    )
    async def on_new_step(state, output, step_index):
        if not agent.browser_session:
            return
            
        all_steps = []
        for i, s in enumerate(steps):
            all_steps.append({
                'index': i + 1,
                'text': s,
                'done': (i + 1) < step_index
            })
            
        if output and output.current_state:
            brain = output.current_state
            current_text = (
                brain.next_goal
                or brain.memory
                or brain.evaluation_previous_goal
                or 'Working on next action...'
            )
        else:
            current_text = 'Working on next action...'

        snap_prompt, snap_completion, snap_cost, snap_calls = await read_browser_use_usage_snapshot(
            agent
        )
        total_tokens, cost_usd = update_cumulative_usage_from_snapshot(
            llm_usage_totals,
            snap_prompt,
            snap_completion,
            snap_cost,
            snap_calls,
            azure,
        )

        data = {
            'currentIndex': step_index,
            'totalSteps': len(steps),
            'currentText': current_text,
            'tokens': total_tokens,
            'cost': f"{cost_usd:.4f}",
            'allSteps': all_steps
        }
        
        try:
            await push_branding_status(agent.browser_session, data)
        except Exception as e:
            print(f"Warning: Failed to update branding status: {e}")

    agent_kwargs = {
        'task': task,
        'llm': llm,
        'browser': browser,
        'calculate_cost': True,
        'register_new_step_callback': on_new_step,
    }
    if upload_paths:
        agent_kwargs['available_file_paths'] = upload_paths
        print(f"Upload fixture(s) for browser-use: {', '.join(upload_paths)}")

    agent = Agent(**agent_kwargs)

    history_list = None
    try:
        history_list = await agent.run()
        print("\nAgent finished execution successfully!")

        usage = getattr(history_list, 'usage', None)
        if usage is not None:
            agent_prompt = getattr(usage, 'total_prompt_tokens', 0) or 0
            agent_completion = getattr(usage, 'total_completion_tokens', 0) or 0
            agent_cost = float(getattr(usage, 'total_cost', 0.0) or 0.0)
            if agent_cost <= 0 and (agent_prompt + agent_completion) > 0:
                agent_cost = estimate_cost_usd(
                    azure.get('model', azure['deploymentId']),
                    agent_prompt,
                    agent_completion,
                )
            final_tokens, final_cost = update_cumulative_usage_from_snapshot(
                llm_usage_totals,
                agent_prompt,
                agent_completion,
                agent_cost,
                int(getattr(usage, 'entry_count', 0) or 0),
                azure,
            )
            print(
                f"[LLM] browser-use agent: {final_tokens:,} tokens, "
                f"~${final_cost:.4f} USD ({llm_usage_totals['llmCalls']} calls)"
            )
            if agent.browser_session:
                try:
                    await push_branding_status(
                        agent.browser_session,
                        {
                            'currentIndex': getattr(agent.state, 'n_steps', 0),
                            'totalSteps': len(steps),
                            'currentText': 'Run complete',
                            'tokens': final_tokens,
                            'cost': f"{final_cost:.4f}",
                            'allSteps': [
                                {'index': i + 1, 'text': s, 'done': True}
                                for i, s in enumerate(steps)
                            ],
                        },
                    )
                except Exception as e:
                    print(f"Warning: Failed final branding status update: {e}")
        
        execution_context = build_full_execution_context(history_list, steps, test_name)
        execution_history = execution_context.get('executionHistory', [])
        runtime_insights = execution_context.get('runtimeInsights', {})
        
        os.makedirs('reports', exist_ok=True)
        history_path = os.path.join('reports', f'{base_file_name}_execution_history.json')
        with open(history_path, 'w', encoding='utf-8') as f_hist:
            json.dump({'test': base_file_name, **execution_context}, f_hist, indent=2, default=str)
        print(f"Saved full browser-use execution context: {history_path}")
        print(f"  - {len(execution_history)} structured steps, {len(execution_context.get('urlSequence', []))} URLs")
        if runtime_insights.get('insights'):
            print("Runtime insights for codegen:")
            for ins in runtime_insights['insights']:
                print(f"  - {ins.get('type')}: {ins.get('message', '')[:120]}")
        
        symbol_graph_context = "None"
        if os.path.exists('framework/symbol_graph.json'):
            try:
                with open('framework/symbol_graph.json', 'r') as f_sym:
                    symbol_graph_context = f_sym.read()
            except Exception as e:
                print("Warning: Could not read symbol_graph.json:", e)

        print("\nGenerating Playwright TS code using Azure OpenAI...")
        code_data = await generate_playwright_code(
            azure,
            test_name,
            steps,
            llm_usage_totals,
            symbol_graph_context,
            execution_context=execution_context,
        )
        
        if code_data:
            files = []
            if isinstance(code_data.get('files'), list):
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

            os.makedirs('framework', exist_ok=True)
            temp_codegen = {
                "files": files,
                "executionContext": execution_context,
                "executionHistoryPath": history_path,
                "summary": code_data.get('summary') or f"Executed: {test_name}. Automated POM and spec created.",
            }
            with open('framework/temp_codegen.json', 'w', encoding='utf-8') as f_temp:
                json.dump(temp_codegen, f_temp, indent=2)
                
            print(f"Exported codegen data to: framework/temp_codegen.json for AST-based merging")

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
                },
            }
            
            with open(f'reports/{base_file_name}_summary.json', 'w', encoding='utf-8') as f_rep:
                json.dump(report_summary, f_rep, indent=2)
                
        else:
            print("Failed to generate code via LLM.")
            
    except Exception as e:
        print(f"Error during execution: {e}")
        sys.exit(1)
    finally:
        history_path = os.path.join('reports', f'{base_file_name}_execution_history.json')
        screenshot_paths = persist_screenshots(base_file_name, history_path)
        artifact_paths = finalize_artifacts(
            base_file_name,
            browser_cfg['video_dir'] if browser_cfg['record_video'] else None,
            browser_cfg['traces_dir'] if browser_cfg['record_trace'] else None,
        )
        if screenshot_paths:
            artifact_paths = artifact_paths or {}
            artifact_paths['screenshots'] = screenshot_paths
        report_path = os.path.join('reports', f'{base_file_name}_summary.json')
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
        await browser.close()
        trigger_html_reports(base_file_name, env_name, test_file_path)

if __name__ == "__main__":
    asyncio.run(main())
