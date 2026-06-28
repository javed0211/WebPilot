# Assertion Engine

WebPilot infers **meaningful assertions** from natural-language steps, page state, and execution traces — not just "the script didn't crash."

---

## Overview

Weak AI-generated tests often stop at navigation. The assertion engine:

- Parses verify/assert language in step text
- Observes URL changes, visible text, roles, and form values after actions
- Scores assertion strength (strong / medium / weak)
- Emits profile-aware assertion code in deterministic codegen
- Warns in reports when assertions are too weak

---

## Assertion sources

| Source | Example input | Inferred assertion |
|--------|---------------|-------------------|
| Step text | `Verify home page is visible` | Role/text visibility |
| Step text | `Verify URL contains /cart` | URL contains |
| Page state | Form filled with "London" | Input value equals |
| Post-action URL | Redirect to `/searchresults` | URL pattern match |
| Success text | "Product added to cart" | Text visible |

**Planned:** network responses, storage/cookies, accessibility audits.

---

## Assertion types (implemented)

### UI assertions

- Element visible (`expect(locator).toBeVisible()`)
- Text present / contains
- Role + name exists
- Form field value

### Navigation assertions

- URL contains / matches pattern
- Page title (when stable)

### Live replay assertions

During intelligent runner execution, verify steps use `assert_visible_page` and app-specific checks (e.g. cart not empty, search form visible).

---

## Assertion strength

| Score | Meaning | Example |
|-------|---------|---------|
| **Strong** | User-visible outcome or business state | "Product appears in cart" |
| **Medium** | Page structure or navigation | "Search results page displayed" |
| **Weak** | Generic presence only | "Page loaded" |

Reports and codegen metadata include `assertionSummary` with weak-assertion warnings.

```json
{
  "total": 4,
  "strong": 2,
  "medium": 1,
  "weak": 1,
  "warnings": ["Step 3 uses generic visibility check only"]
}
```

---

## Profile-aware emission

Assertion code is emitted through profile-specific emitters:

| Profile | Emitter status |
|---------|----------------|
| TypeScript + Playwright | Full |
| Python + Playwright | Full |
| Java + Selenium | Full |
| TypeScript + Cypress | Full |

Example generated Playwright assertion:

```typescript
await expect(this.page).toHaveURL(/view_cart/);
await expect(this.cartProductRow()).toBeVisible();
```

---

## Natural-language patterns

The engine recognizes keywords in step text:

| Keywords | Assertion type |
|----------|----------------|
| verify, assert, should see, must show | Visibility / outcome |
| URL contains, redirected to | URL |
| value is, field shows | Form value |
| at least N, exactly N | Count |

Write explicit verification steps — they improve both live replay and codegen quality.

---

## Integration points

| Stage | Role |
|-------|------|
| Intelligent runner | `assert_visible_page`, recipe postconditions |
| Trace builder | Records assertion candidates per step |
| Deterministic writer | Emits assertion code in specs and page methods |
| HTML reports | Assertion summary card |

**Key files:**

- `src/core/assertions/AssertionCandidate.ts`
- `src/core/assertions/AssertionRanker.ts`
- `src/core/assertions/AssertionEmitter.ts`
- `src/core/codegen/TraceBuilder.ts` (integration)

---

## Best practices

1. **One assertion per step** when possible — easier to replay and debug.
2. **Assert outcomes, not implementation** — "product in cart" not "div.cart-row exists".
3. **Use business language** — matches how SDETs write manual test cases.
4. **Review weak assertions** in HTML reports before merging generated code.

---

## Roadmap

| Planned | Status |
|---------|--------|
| API side-effect assertions | Not yet |
| Cookie / localStorage assertions | Not yet |
| Network response assertions | Not yet |
| Accessibility audit assertions | Not yet |

---

## See also

- [Deterministic Codegen](./deterministic-codegen.md)
- [Test Authoring](./test-authoring.md)
- [features/04-assertion-engine.md](../features/04-assertion-engine.md)
