# 02. Selector Intelligence and Healing

## Goal

Make WebPilot-generated tests stable by choosing strong selectors, storing alternatives, and healing broken selectors with a clear audit trail.

## User Problem

AI agents often click the right thing during exploration but generate weak selectors later. Weak selectors create flaky tests and erode trust.

Users need:

- Predictable selector ranking.
- Fallback selectors.
- Selector confidence.
- Clear healing diffs.
- No silent changes to committed tests.

## Selector Priority

Preferred selector order:

1. `getByRole()` with accessible name.
2. `getByLabel()`.
3. `getByPlaceholder()`.
4. `getByTestId()`.
5. Stable visible text.
6. Stable CSS based on semantic attributes.
7. XPath only as a last resort.

## Selector Candidate Schema

```json
{
  "kind": "role",
  "value": "button[name='Add to cart']",
  "frameworkExpression": "page.getByRole('button', { name: 'Add to cart' })",
  "confidence": 0.92,
  "signals": ["unique", "accessible", "visible"],
  "risks": [],
  "createdAt": "..."
}
```

## Selector Registry

Store learned selectors by site/page/action:

```text
runtime/selectors/registry.json
```

Example:

```json
{
  "automationexercise.com/products": {
    "addFirstProductToCart": {
      "primary": {},
      "fallbacks": [],
      "lastVerifiedAt": "..."
    }
  }
}
```

## Healing Flow

When a selector fails:

1. Capture DOM snapshot and screenshot.
2. Re-rank existing fallback selectors.
3. Search for semantically equivalent element.
4. Validate candidate by executing the intended action in a controlled retry.
5. Save healing proposal.
6. Optionally patch generated code.

Healing must produce:

```text
Old selector:
  page.getByText('Products')

New selector:
  page.getByRole('link', { name: 'Products' })

Reason:
  Old selector matched 2 elements. New selector is accessible and unique.
```

## Product Scope

This product feature supports:

- Playwright selectors.
- Selector scoring during codegen.
- Selector registry in `runtime/selectors/`.
- Healing proposal report.
- Optional `webpilot self-heal --apply`.

Future enhancements:

- Selenium/Cypress/WebdriverIO selector emitters.
- Persistent cloud selector service.
- Visual matching.

## Implementation Plan

### Phase 1: Selector Model

Files:

- `src/core/selectors/SelectorCandidate.ts`
- `src/core/selectors/SelectorRanker.ts`
- `src/core/selectors/SelectorRegistry.ts`

### Phase 2: Candidate Extraction

Extract candidates from:

- Accessibility snapshot.
- Playwright locator info.
- DOM attributes.
- Observed action target.

### Phase 3: Ranking

Ranking inputs:

- Uniqueness.
- Accessibility.
- Stability.
- Human readability.
- Page object compatibility.
- Historical success.

Ranking output:

- Primary selector.
- Fallback list.
- Confidence score.

### Phase 4: Codegen Integration

Generated code should include the best selector expression:

```typescript
await this.page.getByRole('button', { name: 'Add to cart' }).click();
```

Avoid:

```typescript
await this.page.locator('div:nth-child(3) > button').click();
```

### Phase 5: Healing Integration

`webpilot self-heal` should:

- Load failure report.
- Load selector registry.
- Propose replacements.
- Save patch proposal.
- Apply patch only when explicitly requested.

## Tests

Unit tests:

- Role selector outranks CSS when unique.
- `data-testid` outranks brittle CSS.
- Duplicate text lowers confidence.
- XPath gets low score.
- Historical success raises confidence.

Integration tests:

- Break a selector in an AutomationExercise page object.
- Healing proposes a better selector.
- Applying the proposal makes the test pass.

## Exit Criteria

- Generated selectors prefer role/label/test-id patterns.
- Every generated selector has a confidence score.
- Broken selector failures include a healing suggestion.
- `self-heal --apply` can patch one broken selector and rerun successfully.

## Implementation Status

Product feature implemented in WebPilot:

- [x] Selector candidate schema and ranked selector set (`src/core/selectors/SelectorCandidate.ts`)
- [x] Deterministic selector ranking for Playwright selectors (`src/core/selectors/SelectorRanker.ts`)
- [x] Runtime selector registry at `runtime/selectors/registry.json`
- [x] Trace building records selector confidence, signals, risks, and fallbacks
- [x] Deterministic generated code includes selector confidence/fallback comments
- [x] Browser page-state extraction captures role/text/test-id/placeholder/CSS candidates
- [x] Healing writes auditable proposal JSON under `runtime/selectors/healing-proposals/`
- [x] `webpilot self-heal --proposals` lists proposals
- [x] `webpilot self-heal --apply <proposal> --file <target>` patches only explicit targets

Future enhancements:

- [ ] Browser-driven validation of every fallback selector before storing it
- [ ] Automatic rerun after applying a healing proposal
- [ ] Visual matching and cloud selector service

