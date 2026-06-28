# Test Authoring

How SDETs write WebPilot scenarios in natural language — formats, metadata, templates, and CLI helpers.

---

## Overview

WebPilot tests are plain `.txt` files. No programming required for authoring; the intelligent runner interprets numbered steps and learns locators on first execution.

**Typical workflow:**

```bash
webpilot create test checkout --template checkout-flow --base-url https://automationexercise.com
webpilot run tests/web/checkout.txt --codegen --report
webpilot replay packages/test-framework/tests/checkout.spec.ts
```

---

## Basic format

```text
@smoke @cart
Test: Add Products in Cart

1. Navigate to https://automationexercise.com/
2. Verify that home page is visible successfully
3. Click on Products link in the navigation menu
4. Click on Add to cart for the first product
5. Click View Cart in the modal
6. Verify the product appears in the cart
```

### Rules

- **Title line:** `Test: <name>` (optional but recommended)
- **Steps:** Numbered list (`1.`, `2.`, …)
- **Tags:** `@smoke`, `@regression` on any line
- **Language:** Plain English imperatives — Navigate, Click, Enter, Verify, Select, Open

---

## Scenario metadata

Metadata lines at the top configure the run without CLI flags. They are **parsed but not executed** as steps.

```text
@smoke @booking
target: web
baseUrl: https://www.booking.com
codegen: true
report: true

Test: Booking home smoke
1. Navigate to https://www.booking.com/
...
```

| Field | Values | Effect |
|-------|--------|--------|
| `target` | `web`, `api`, `web-api` | Routing |
| `baseUrl` | URL | Default navigation context |
| `codegen` | `true` / `false` | Enable post-run codegen |
| `report` | `true` / `false` | Generate HTML report |

Implemented in `src/core/authoring/ScenarioMetadata.ts`.

---

## Templates

### Create from template

```bash
webpilot create test smoke --template web-smoke --base-url https://automationexercise.com
webpilot create test checkout --template checkout-flow
webpilot create api petstore --template api-smoke
```

### Built-in templates

| Template | Path | Purpose |
|----------|------|---------|
| `web-smoke` | `resources/templates/tests/web-smoke.txt` | Minimal UI smoke |
| `checkout-flow` | `resources/templates/tests/checkout-flow.txt` | E-commerce flow |
| `api-smoke` | `resources/templates/tests/api-smoke.txt` | HTTP smoke |

Templates are rendered by `src/core/authoring/TestTemplates.ts`.

---

## Authoring tips

### Write steps an SDET would

**Good:**
```text
4. Enter "London" in the destination field
5. Select London, United Kingdom from the destination suggestions
10. Verify the search results page is displayed
```

**Avoid vague steps:**
```text
4. Search for a hotel   # too ambiguous for deterministic replay
```

### Separate navigation, action, and assertion

```text
3. Click the Search button
4. Verify the results page shows at least one hotel listing
```

### Handle overlays explicitly (first run learns; later replays auto-dismiss)

```text
2. If a cookie consent dialog is visible, accept or dismiss it
```

### Use tags for suite filtering

```text
@smoke @booking @p1
```

---

## BDD and hybrid (deferred)

Gherkin-style scenarios are documented for future support:

```gherkin
Feature: Checkout
Scenario: Add product to cart
  Given I am on the products page
  When I add the first product to the cart
  Then I should see the product in the cart
```

Today, use numbered natural-language steps. A full Gherkin parser is on the roadmap.

---

## CLI output after run

WebPilot prints focused next steps via `src/core/authoring/NextSteps.ts`:

```text
Generated:
  - packages/test-framework/pages/ProductsPage.ts
  - packages/test-framework/tests/add-product.spec.ts

Validate:
  webpilot replay packages/test-framework/tests/add-product.spec.ts

Report:
  runtime/reports/html/index.html
```

Every command answers: what happened, where outputs are, what to do next, how to fix blockers.

---

## Example scenarios in repo

| File | Purpose |
|------|---------|
| `tests/web/webpilot_live_checkout_2341.txt` | AutomationExercise cart (0-LLM replay proven) |
| `tests/web/booking_home_visibility_smoke.txt` | Booking.com smoke |
| `tests/web/booking_search_hotels.txt` | Full booking search flow |

---

## `webpilot init` starter tests

`webpilot init` scaffolds project structure and creates starter tests for TypeScript + Playwright profiles. Other language profiles receive template files without full framework scaffold.

```bash
webpilot init --yes --language typescript --tool playwright --pattern pom
```

---

## See also

- [Execution & Replay](./execution-and-replay.md)
- [Intelligent Runner & Site Knowledge](./intelligent-runner-and-site-knowledge.md)
- [USAGE.md](../USAGE.md)
- [features/08-test-authoring-ux.md](../features/08-test-authoring-ux.md)
