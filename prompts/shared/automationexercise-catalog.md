# Automation Exercise — canonical Python page methods

When codegen touches `automationexercise.com`, page modules are injected automatically. Generate the pytest test using:

| Page | Methods |
|---|---|
| `AutomationExerciseHomePage` | `goto()`, `assert_featured_items_visible()`, `go_to_products_page()` |
| `AutomationExerciseProductsPage` | `assert_all_products_visible()`, `hover_product_at(i)`, `add_to_cart_product_at(i)`, `handle_cart_modal("continue" \| "view")` |
| `AutomationExerciseCartPage` | `assert_on_cart_page()`, `assert_cart_products([...])` |
| `AutomationExerciseContactUsPage` | `open_from_nav()`, `assert_contact_page_loaded()`, `fill_contact_form({...})`, `upload_file()`, `submit_and_accept_alert()`, `assert_submission_success()`, `click_home()` |

- Upload fixture: `ROOT / "tests" / "fixtures" / "sample.txt"`
- Imports: `from framework.pages.automationexercise.<module> import <ClassName>`
