# WebPilot Playwright Python framework guidelines

## Stack

- Python 3.11+
- Synchronous `playwright.sync_api`
- `pytest` + `pytest-playwright`
- Tests use the built-in `page: Page` fixture.

## Multi-page POM

Use one Page Object per logical page:

| Screen | Class | Module |
|---|---|---|
| Home | `AutomationExerciseHomePage` | `framework/pages/automationexercise/automation_exercise_home_page.py` |
| Products | `AutomationExerciseProductsPage` | `framework/pages/automationexercise/automation_exercise_products_page.py` |
| Product detail | `AutomationExerciseProductDetailPage` | `framework/pages/automationexercise/automation_exercise_product_detail_page.py` |
| Cart | `AutomationExerciseCartPage` | `framework/pages/automationexercise/automation_exercise_cart_page.py` |
| Contact Us | `AutomationExerciseContactUsPage` | `framework/pages/automationexercise/automation_exercise_contact_us_page.py` |

Rules:

- Use snake_case file and method names.
- Classes use PascalCase.
- Page objects extend `BasePage` or a site base class.
- Shared site-wide actions belong in the site base class.
- Tests belong in `framework/tests/test_<name>.py`.
- Imports are absolute from `framework`.
- Never generate TypeScript, JavaScript, `async`, or `await`.

## Strict locators

Scope forms and page regions before selecting fields or text. Use `locator.filter(has_text=...)` for repeated elements. Avoid page-wide semantic locators when multiple elements can match.

## Validation

Generated files run through `python -m py_compile`, then the generated pytest Playwright test is executed and auto-fixed when configured.
