# Selector Intelligence & Healing

WebPilot chooses **strong, accessible selectors**, stores fallbacks with confidence scores, and produces **auditable healing proposals** when locators break.

---

## Overview

AI agents often click the correct element during exploration but emit weak selectors in generated code (`nth-child`, brittle CSS, duplicated text). Selector intelligence ensures:

- Role and label selectors are preferred
- Every primary selector has fallbacks and a confidence score
- Failures produce healing diffs — never silent changes
- Live replay uses registry selectors over brittle learned text

---

## Selector priority

WebPilot ranks candidates in this order:

| Priority | Selector type | Example |
|----------|---------------|---------|
| 1 | Role + accessible name | `getByRole('button', { name: 'Add to cart' })` |
| 2 | Label | `getByLabel('Email')` |
| 3 | Placeholder | `getByPlaceholder('Search...')` |
| 4 | Test ID | `getByTestId('checkout-submit')` |
| 5 | Stable visible text | `getByText('Products', { exact: true })` |
| 6 | Semantic CSS | `input[name="ss"]` |
| 7 | XPath | Last resort only |

---

## Selector candidate schema

```json
{
  "kind": "role",
  "value": "link",
  "name": "Products",
  "frameworkExpression": "page.getByRole('link', { name: 'Products' })",
  "confidence": 0.92,
  "signals": ["unique", "accessible", "visible"],
  "risks": []
}
```

Confidence is lowered when:

- Multiple elements match
- Text is dynamic or icon-font garbage
- Selector is positional (`nth-child`)
- Historical failures exist

---

## Selector registry

**Path:** `runtime/selectors/registry.json`

Organized by site/page/action:

```json
{
  "automationexercise.com/products": {
    "clickProductsNav": {
      "primary": { "kind": "role", "value": "link", "name": "Products" },
      "fallbacks": [],
      "confidence": 0.95,
      "lastVerifiedAt": "2026-06-28T..."
    }
  }
}
```

### Who reads the registry

| Consumer | Usage |
|----------|-------|
| Intelligent runner (`knowledge.py`) | Prefer registry selectors during live replay |
| Trace builder | Record confidence + fallbacks in codegen trace |
| Deterministic writer | Emit best expression in generated code |
| Healing CLI | Propose replacements on failure |

---

## Healing flow

When a selector fails during execution or Playwright replay:

```text
1. Capture failure context (screenshot, DOM snapshot, error message)
2. Re-rank existing fallback selectors
3. Search for semantically equivalent element
4. Write healing proposal JSON (no auto-apply)
5. SDET reviews and applies explicitly
```

### Healing proposal example

```text
Old selector:
  page.getByText('Products')

New selector:
  page.getByRole('link', { name: 'Products' })

Reason:
  Old selector matched 2 elements. New selector is accessible and unique.
```

**Proposals path:** `runtime/selectors/healing-proposals/*.json`

**Cache path:** `runtime/healing-cache/cache.json`

---

## CLI: `webpilot self-heal`

```bash
# List healing proposals
webpilot self-heal --proposals

# Apply a reviewed proposal to a specific file (explicit opt-in)
webpilot self-heal --apply runtime/selectors/healing-proposals/proposal-abc.json \
  --file packages/test-framework/pages/ProductsPage.ts

# Clear healing cache
webpilot self-heal --clean
```

**Important:** `--apply` patches only the file you name. WebPilot does not silently modify committed tests.

---

## Configuration

```yaml
framework:
  healingCachePath: "./runtime/healing-cache/cache.json"

execution:
  selfHealing:
    enabled: true
    similarityThreshold: 0.7
    autoUpdateCache: true
```

> Note: `execution.selfHealing` options are defined in YAML; inline healing on the browser-use path is partial. CLI proposal workflow is the primary maintenance path today.

---

## Integration with intelligent runner

During live replay, WebPilot:

1. Dismisses cookie consent before clicks (`#onetrust-accept-btn-handler`, Consent button)
2. Cleans icon-font characters from learned locators
3. Merges registry selectors ahead of raw browser-use captures
4. Uses POM-aligned recipes for known apps when no capability exists yet

This is why AutomationExercise and Booking smoke tests achieve **0 LLM** replay after learning.

---

## Generated code comments

Deterministic codegen embeds selector metadata:

```typescript
// selector-confidence: 0.92 | fallbacks: 2 | signals: unique, accessible
await this.getByRole('link', { name: 'Products' }).click();
```

Reports surface low-confidence selectors for review.

---

## Roadmap

| Planned | Status |
|---------|--------|
| Browser-validate every fallback before storing | Not yet |
| Auto-rerun after `--apply` | Not yet |
| Inline healing on browser-use discovery path | Partial |
| Visual matching | Planned |
| Cloud selector service | Planned |

---

## Key source files

| File | Role |
|------|------|
| `src/core/selectors/SelectorRanker.ts` | Ranking algorithm |
| `src/core/selectors/SelectorRegistry.ts` | Read/write registry |
| `src/core/selectors/SelectorCandidate.ts` | Schema types |
| `src/agents/HealingAgent.ts` | Legacy engine healing |
| `src/integrations/browser_use/knowledge.py` | Live replay bridge |

---

## See also

- [Intelligent Runner & Site Knowledge](./intelligent-runner-and-site-knowledge.md)
- [Flake Analyzer](./flake-analyzer.md) — selector-related failures
- [features/02-selector-intelligence-and-healing.md](../features/02-selector-intelligence-and-healing.md)
