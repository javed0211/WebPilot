# WebPilot prompts

Edit these Markdown files to change LLM behavior **without changing TypeScript or Python code**.

## Layout

| Path | Used by |
|------|---------|
| `shared/locator-strict-rules.md` | All Playwright codegen and fix agents |
| `shared/framework-guidelines.md` | Codegen, validators, browser-use codegen |
| `shared/automationexercise-catalog.md` | Automation Exercise flows |
| `../rulebooks/<pack>/seed.md` | Origin-gated site rulebooks (see `resources/rulebooks/`) |
| `codegen/agent-system.md` | `CodegenAgent` (Engine path) |
| `codegen/agent-user.md` | `CodegenAgent` user message template |
| `codegen-fix/typescript-system.md` | `CodegenValidator` auto-fix |
| `codegen-fix/playwright-system.md` | `CodegenPlaywrightValidator` auto-fix |
| `browser-use/codegen.md` | `src/integrations/browser_use/runner.py` codegen |
| `runtime/reports/ai-analysis-system.md` | HTML execution report — AI analyst |
| `runtime/reports/ai-analysis-user.md` | Per-test AI analysis user prompt |
| `runtime/reports/ai-analysis-suite-user.md` | Suite-level AI analysis |

Placeholders use `{{name}}` and are replaced at runtime.

## After editing

Re-run WebPilot tests; no rebuild required. Restart any long-running processes if prompts were cached in memory.
