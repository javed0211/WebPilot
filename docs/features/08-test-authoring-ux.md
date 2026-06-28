# 08. Test Authoring UX

## Goal

Make WebPilot feel simple and powerful for first-time users while preserving advanced control for automation engineers.

## User Problem

Automation tools often force users to choose between:

- Simple but unreliable AI execution.
- Powerful but complex code-first frameworks.

WebPilot should bridge both.

## Target Workflow

```bash
webpilot init
webpilot explore "login and checkout"
webpilot generate
webpilot run
webpilot report
```

Or file-based:

```bash
webpilot run tests/web/checkout.txt --codegen --report
```

## Authoring Formats

### Natural Language

```text
Test: Checkout flow

1. Go to the store.
2. Search for a product.
3. Add it to cart.
4. Verify the product appears in cart.
```

### BDD

```gherkin
Feature: Checkout

Scenario: Add product to cart
  Given I am on the products page
  When I add the first product to the cart
  Then I should see the product in the cart
```

### Hybrid Metadata

```text
@smoke @checkout
target: web
baseUrl: https://automationexercise.com
codegen: true

Test: Add product to cart
...
```

## Product Scope

Test authoring UX supports:

- Clear examples from `webpilot init`.
- `webpilot run <file> --codegen --report`.
- Helpful command output with next step suggestions.
- Starter templates for web and API.

Deferred for later:

- Full Gherkin parser.
- Interactive recorder UI.
- VS Code extension.

## Implementation Notes

Implemented in `src/core/authoring/`:

- `ScenarioMetadata.ts` parses tags, target, baseUrl, codegen, report, natural-language, BDD, and hybrid metadata.
- `TestTemplates.ts` renders web smoke, API smoke, and checkout-flow starters.
- `NextSteps.ts` formats command output blocks for created tests and completed runs.

Templates:

- `resources/templates/tests/web-smoke.txt`
- `resources/templates/tests/api-smoke.txt`
- `resources/templates/tests/checkout-flow.txt`

CLI behavior:

```bash
webpilot create test checkout --template checkout-flow --base-url https://automationexercise.com
webpilot create api petstore
webpilot run tests/web/checkout.txt
```

Scenario files can enable codegen and reports without extra flags:

```text
@smoke @checkout
target: web
baseUrl: https://automationexercise.com
codegen: true
report: true

Test: Checkout flow
```

`webpilot run` prints a focused summary with report, artifact manifest, generated-code, and replay guidance. API and browser-use parsers ignore metadata lines so they do not become executable steps.

Verification:

```bash
npm run build
node scripts/test-feature-08.cjs
```

## CLI UX Principles

Every command should answer:

- What happened?
- Where are the outputs?
- What should I do next?
- How do I fix blockers?

Example:

```text
Generated:
  - packages/test-framework/pages/ProductsPage.ts
  - packages/test-framework/tests/add-product.spec.ts

Validate:
  npm run test:web -- add-product.spec.ts

Report:
  runtime/reports/html/index.html
```

## Implementation Plan

### Phase 1: Command Output Cleanup

Improve:

- `init`
- `doctor`
- `run`
- `graph`
- `report`

### Phase 2: Templates

Add:

- `templates/tests/web-smoke.txt`
- `templates/tests/api-smoke.txt`
- `templates/tests/checkout-flow.txt`

### Phase 3: Scenario Metadata Parser

Parse:

- tags.
- target.
- baseUrl.
- codegen flag.
- report flag.

### Phase 4: Suggested Next Steps

After each command, print focused next steps.

## Tests

Unit tests:

- Scenario metadata parser.
- Tag parser.
- Command output formatting helpers.

Integration tests:

- `webpilot init` creates useful starter tests.
- `webpilot run tests/web/automationexercise_smoke.txt --codegen --report` prints generated files and report path.

## Exit Criteria

- New users can understand the first run without reading source code. **Done**
- Generated starter tests demonstrate the intended workflow. **Done**
- CLI output consistently points to reports, generated files, and fixes. **Done**

