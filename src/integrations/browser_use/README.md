# WebPilot Browser Use Integration

This package is the boundary between the WebPilot test framework and the Browser
Use engine.

| File | Responsibility |
|------|----------------|
| `runner.py` | Runtime entry point invoked by `core/Engine.ts` |
| `PythonRuntime.ts` | Python environment discovery and setup |
| `llm_config.py` | Provider credentials and Browser Use LLM creation |
| `llm_capabilities.py` | Model payload capability lookup |
| `branding.py` | WebPilot browser overlay and BrowserSession options |
| `testmu.py` | TestMu/LambdaTest remote CDP connection |
| `execution_history.py` | Browser Use history normalization for reports/codegen |
| `prompt_loader.py` | Prompt loading for Browser Use post-run codegen |
| `paths.py` | Repository path constants |

The adapter may import `browser_use`. The test framework must not import Browser
Use implementation modules directly.

Run the adapter with:

```bash
.venv/bin/python -m integrations.browser_use <test-file> <environment>
```
