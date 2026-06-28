# 04. Assertion Engine

## Goal

Generate meaningful assertions from observed behavior, not just clicks and navigation.

## User Problem

Many AI-generated tests are weak because they only verify that the script did not crash. Real automation must prove user-visible outcomes and business behavior.

## Assertion Sources

WebPilot should infer assertions from:

- Natural-language step text.
- Page state after each action.
- URL changes.
- Visible text.
- Accessibility tree.
- Network responses.
- API side effects.
- Browser storage.
- Reports and screenshots.

## Assertion Types

### UI Assertions

- Element visible.
- Text present.
- URL contains.
- Form value equals.
- Count is at least/exactly.
- Button/link enabled or disabled.

### Network Assertions

- Request sent.
- Response status.
- Response body field.
- No failed network requests.

### State Assertions

- Cookie exists.
- Local storage key exists.
- Session storage key exists.

### Accessibility Assertions

- Landmark exists.
- Role/name exists.
- Dialog has accessible name.

## Assertion Strength

Assertions should be scored:

| Score | Meaning |
|-------|---------|
| strong | Verifies user-visible outcome or business state |
| medium | Verifies navigation or page structure |
| weak | Verifies only generic presence |

Reports should warn about weak assertions.

## Product Scope

This product feature supports:

- Playwright UI assertions.
- URL assertions.
- Text/role visibility assertions.
- Weak assertion warning in generated code metadata/report.
- Profile-aware assertion emission for TypeScript Playwright, Python Playwright, Java Selenium, and TypeScript Cypress.

Future enhancements:

- API side-effect assertions.
- Storage assertions.
- Accessibility audit assertions.

## Implementation Plan

### Phase 1: Assertion Model

Create:

- `src/core/assertions/AssertionCandidate.ts`
- `src/core/assertions/AssertionRanker.ts`
- `src/core/assertions/AssertionEmitter.ts`

### Phase 2: Candidate Extraction

After each action, capture:

- URL.
- title.
- visible headings.
- role/name landmarks.
- success/error text.
- modal/dialog state.

### Phase 3: Ranking

Rank based on:

- Alignment with step intent.
- Specificity.
- Stability.
- User value.
- Uniqueness.

### Phase 4: Codegen Integration

Examples:

```typescript
await expect(page).toHaveURL(/products/);
await expect(page.getByRole('heading', { name: 'All Products' })).toBeVisible();
await expect(page.getByText('Added!')).toBeVisible();
```

### Phase 5: Report Integration

Reports should show:

- Generated assertions.
- Assertion strength.
- Missing assertion warnings.
- Failed assertion diagnosis.

## Tests

Unit tests:

- Success message becomes strong assertion.
- Generic body visibility is weak.
- URL change creates medium assertion.
- Natural language "verify product is in cart" maps to cart item text/count.

Integration tests:

- Generate AutomationExercise product search test with strong assertions.
- Generated test fails if expected product text changes.

## Exit Criteria

- Generated tests contain at least one meaningful assertion per scenario.
- Weak assertion warnings appear in report metadata.
- Assertion generation is profile-aware for TypeScript Playwright and Python Playwright.

## Implementation Status

Product feature implemented in WebPilot:

- [x] Assertion candidate schema and summary model (`src/core/assertions/AssertionCandidate.ts`)
- [x] Assertion ranker infers URL, role/text visibility, value, and success-outcome assertions
- [x] Assertion emitter produces profile-aware assertions for TypeScript Playwright, Python Playwright, Java Selenium, and TypeScript Cypress
- [x] Trace building attaches scored assertion candidates to each step
- [x] Deterministic generated code includes assertion strength comments
- [x] Codegen metadata includes assertion totals and weak-assertion warnings
- [x] HTML reports display assertion strength summary and warnings

Future enhancements:

- [ ] API side-effect assertions
- [ ] Browser storage assertions
- [ ] Accessibility audit assertions
- [ ] Network response/body assertions

