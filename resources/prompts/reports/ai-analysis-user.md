Analyze this WebPilot test execution.

## Test: {{test_slug}}
Status: {{status}}
Execution kind: {{execution_kind}}
Execution mode: {{execution_mode}}
Steps executed: {{steps_executed}}
Agent successful: {{agent_success}}
Status reason: {{status_reason}}
Failure context: {{failure_context}}
URLs visited: {{url_sequence}}

## NL steps
{{nl_steps}}

## Runtime insights
{{runtime_insights}}

## Codegen summary
{{codegen_summary}}

## Evidence sample
{{execution_sample}}

## LLM usage
- Calls: {{llm_calls}}
- Tokens: {{total_tokens}} (prompt {{prompt_tokens}}, completion {{completion_tokens}})
- Estimated cost: ${{estimated_cost_usd}} USD
- Model: {{model}} ({{provider}})

Provide a concise AI analysis (under 400 words). Match the focus rules for this execution kind.
