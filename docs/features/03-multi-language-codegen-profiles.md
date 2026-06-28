# 03. Multi-Language Codegen Profiles

## Goal

Generate production-grade automation code for each selected `webpilot init` profile instead of assuming TypeScript + Playwright.

## Supported Profiles

Initial support matrix:

| Language | Tool | Pattern | Priority |
|----------|------|---------|----------|
| TypeScript | Playwright | POM | P0 |
| Python | Playwright | POM/simple | P0 |
| Java | Selenium | POM | P1 |
| TypeScript | Cypress | simple/POM | P1 |
| TypeScript | WebdriverIO | POM | P2 |
| C# | Selenium/Playwright | POM | P2 |

## User Problem

Users pick language/tool during `webpilot init`, but generated automation must honor that choice.

Without profile-aware codegen, WebPilot feels like a Playwright-only tool with a broader setup wizard.

## Profile Contract

The source of truth is:

```yaml
project:
  language: "python"
  automationTool: "playwright"
  testFramework: "pytest"
  frameworkPattern: "pom"
```

Codegen must read this profile before choosing:

- File extensions.
- Test runner.
- Assertion style.
- Locator syntax.
- Page object style.
- Package/build files.

## Codegen Architecture

Introduce codegen profiles:

```text
src/core/codegen/profiles/
  typescript-playwright-pom.ts
  python-playwright-pom.ts
  java-selenium-pom.ts
  typescript-cypress-simple.ts
```

Each profile owns:

- File layout.
- Imports.
- Page object template.
- Test template.
- Selector emitter.
- Assertion emitter.
- Validator command.

## Product Scope

This product feature implements:

- TypeScript Playwright POM.
- Python Playwright simple/POM.
- Java Selenium POM skeleton.
- TypeScript Cypress simple generation.

Generated output includes:

- Test file.
- Page object when useful.
- Basic assertions.
- Profile-specific replay and validation commands in codegen metadata and reports.

Future enhancements:

- BDD/Cucumber.
- Screenplay.
- Advanced framework-specific fixtures.

## Example Outputs

### Python Playwright

```python
from playwright.sync_api import Page, expect


class ProductsPage:
    def __init__(self, page: Page):
        self.page = page

    def add_first_product_to_cart(self):
        self.page.get_by_role("button", name="Add to cart").first.click()


def test_add_product_to_cart(page: Page):
    page.goto("https://automationexercise.com/products")
    products = ProductsPage(page)
    products.add_first_product_to_cart()
    expect(page.get_by_text("Added!")).to_be_visible()
```

### Java Selenium

```java
class ProductsPage {
  private final WebDriver driver;

  ProductsPage(WebDriver driver) {
    this.driver = driver;
  }

  void addFirstProductToCart() {
    driver.findElement(By.cssSelector("[data-product-id='1']")).click();
  }
}
```

## Implementation Plan

### Phase 1: Profile Interface

Create:

- `CodegenProfile`
- `CodegenProfileRegistry`
- `GeneratedFile`
- `ValidationCommand`

### Phase 2: Profile-Aware Prompt Context

Prompt must include:

- Active profile.
- Existing graph summary for matching language/tool.
- Framework rules specific to profile.
- Example output for profile.

### Phase 3: Emitters

Split emitters:

- Selector emitter.
- Assertion emitter.
- Page object emitter.
- Test emitter.

### Phase 4: Validators

Per-profile validation:

- TypeScript Playwright: `npm run build`, `npx playwright test`.
- Python Playwright: `python -m py_compile`, `pytest`.
- Java Selenium: `mvn test`.
- Cypress: `npx cypress run`.

## Tests

Unit tests:

- Profile registry selects correct profile from YAML.
- Python profile emits `.py` files.
- Java profile emits Maven/JUnit structure.
- TypeScript Cypress profile emits Cypress syntax.

Integration tests:

- Init Python project, generate Python Playwright test.
- Init Java project, generate Selenium test.
- Generated code passes syntax validation.

## Exit Criteria

- `webpilot init --language python --tool playwright` leads to Python generated code.
- `webpilot init --language java --tool selenium` leads to Java generated code.
- TypeScript Playwright remains stable.
- Validators are profile-aware.

## Implementation Status

Product feature implemented in WebPilot:

- [x] Codegen profile contract and registry (`src/core/codegen/profiles/`)
- [x] TypeScript Playwright profile preserves existing deterministic POM output
- [x] Python Playwright profile emits pytest-compatible tests and POM page objects
- [x] Java Selenium profile emits JUnit/Selenium test and page-object files
- [x] TypeScript Cypress profile emits native Cypress specs
- [x] `PlanBuilder` reads `project.language`, `project.automationTool`, `project.testFramework`, and `project.frameworkPattern`
- [x] Deterministic pipeline emits files through the active profile
- [x] Metadata and reports include profile-specific replay and validation commands

Future enhancements:

- [ ] WebdriverIO profile
- [ ] C# Selenium/Playwright profile
- [ ] BDD/Cucumber emitters
- [ ] Advanced framework-specific fixtures

