# Automation Exercise — canonical page methods

When codegen touches `automationexercise.com`, page POMs are injected automatically. Generate the **spec** using:

| Page | Methods |
|------|---------|
| `AutomationExerciseHomePage` | `goto()`, `assertFeaturedItemsVisible()`, `goToProductsPage()` |
| `AutomationExerciseProductsPage` | `assertAllProductsVisible()`, `hoverProductAt(i)`, `addToCartProductAt(i)`, `handleCartModal('continue' \| 'view')` |
| `AutomationExerciseCartPage` | `assertOnCartPage()`, `assertCartProducts([...])` |
| `AutomationExerciseContactUsPage` | `openFromNav()`, `assertContactPageLoaded()`, `fillContactForm({...})`, `uploadFile()`, `submitAndAcceptAlert()`, `assertSubmissionSuccess()`, `clickHome()` |

- Upload fixture: `path.join(process.cwd(), 'tests', 'fixtures', 'sample.txt')`
- Imports: `@pages/automationexercise/<ClassName>`
