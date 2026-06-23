# Reporting

WebPilot stores local artifacts in `reports/`.

| Artifact | Path |
|---|---|
| Suite HTML | `reports/index.html` |
| Execution summary | `reports/<slug>_summary.json` |
| Full browser history | `reports/<slug>_execution_history.json` |
| LLM usage | `reports/<slug>_llm_usage.json` |
| Screenshots | `reports/screenshots/<slug>/` |
| Video | `reports/videos/<slug>.webm` |
| Trace | `reports/traces/<slug>_trace.zip` |
| Markdown analysis | `reports/execution_analysis_report.md` |

Generate reports:

```bash
webpilot report
webpilot report --test booking_search_hotels
webpilot analyze
```
