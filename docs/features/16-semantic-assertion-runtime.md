# 16. Semantic Assertion Runtime

## Goal

Replace flat scalar assertion candidates with a **typed expression AST** that can extract values, compare across fields, do arithmetic with tolerances, and run registered domain checks — producing a runtime assertion ledger with provenance.

## How to use

Write explicit DSL lines in a scenario (ambiguous lines are rejected, not invented):

```text
Extract subtotal as currency from [data-testid=subtotal]
Extract tax as currency from [data-testid=tax]
Extract total as currency from [data-testid=total]
Assert total approximatelyEquals (subtotal + tax) within 0.01
Assert domain money.total_equals_sum(total=total, parts=[subtotal, tax], tolerance=0.01)
```

Sources:

| Form | Meaning |
|------|---------|
| `[data-testid=x]` / `testid:x` | Locator text |
| `url` / `title` / `status` | Page/API context |
| `json:path` / `var:name` | Variables / response body |
| `count:css:.row` | Locator count |

Operators: `equals`, `notEquals`, `gt`/`gte`/`lt`/`lte`, `contains`, `exists`, `approximatelyEquals` (`~=`).

Built-in domain checks: `money.total_equals_sum`, `date.end_after_start`, `collection.count_between`, `http.success_status`, `inventory.quantity_changed_by`.

## Product Scope

### Phase A — shipped

- `SemanticAssertion` AST + `AssertionDslParser`
- `TypedExtractor`, `ValueCoercion`, `ExpressionEvaluator` (cent-safe money add/sub)
- `DomainCheckRegistry` (named predicates only)
- `SemanticAssertionRuntime` + `AssertionResultLedger` → execution events
- `LegacyAssertionAdapter`
- TypeScript Playwright semantic codegen
- `count_at_least` emitter fixed to `>=`
- AssertionRanker attaches `semanticPlan` when DSL is detected
- Tests: `npm run test:semantic-assertions`

### Phase B — next

- Live Playwright page bridge in replay for locator extractionsions
- API codegen helpers for jsonPath extracts
- Fail-closed semantic emit for remaining frameworks (Python currently raises)

## V1 exclusions

- Arbitrary JS evaluation
- LLM-only assertion grading
- Full multi-framework semantic emitters on day one

## Implementation Status

- [x] AST + parser + evaluator modules
- [x] Runtime ledger wired to event ledger
- [x] Domain check registry
- [x] Codegen for TS Playwright
- [x] Feature flag `features.semanticAssertions` (DSL opt-in also works when lines are present)
- [ ] Browser-live extract during ActHistory replay
- [ ] Python/Java/Cypress semantic emitters

## Critical Files

- `src/core/assertions/SemanticAssertion.ts`
- `src/core/assertions/AssertionDslParser.ts`
- `src/core/assertions/SemanticAssertionRuntime.ts`
- `src/core/assertions/AssertionEmitter.ts`
- `src/core/assertions/AssertionRanker.ts`

## Exit Criteria

1. API/variable cross-value assertion executes and persists typed actuals — **done** (variable context).
2. Ambiguous NL is rejected, not invented — **done**.
3. Money uses decimal/cent arithmetic + explicit tolerance — **done**.
4. Assertion outcomes appear as citation-ready events — **done**.
