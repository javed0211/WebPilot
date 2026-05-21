Analyze this WebPilot test execution.

## Test: {{test_slug}}
Status: {{status}}
Steps executed: {{steps_executed}}
Agent successful: {{agent_success}}
URLs visited: {{url_sequence}}

## NL steps
{{nl_steps}}

## Runtime insights
{{runtime_insights}}

## Codegen summary
{{codegen_summary}}

## LLM usage
- Calls: {{llm_calls}}
- Tokens: {{total_tokens}} (prompt {{prompt_tokens}}, completion {{completion_tokens}})
- Estimated cost: ${{estimated_cost_usd}} USD
- Model: {{model}} ({{provider}})

## Sample execution steps (first 15)
{{execution_sample}}

Provide a concise AI analysis (under 400 words).
