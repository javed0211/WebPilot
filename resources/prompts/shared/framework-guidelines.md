# WebPilot framework guidelines

## Multi-page POM (mandatory for multi-route flows)

When a test visits **more than one screen/route** (e.g. Home → Products → Cart), generate **one Page Object class per logical page**, not a single catch-all class.

| Route / screen | Example class | Example file |
|----------------|---------------|--------------|
| Home | `AutomationExerciseHomePage` | `packages/test-framework/pages/automationexercise/AutomationExerciseHomePage.ts` |
| Products listing | `AutomationExerciseProductsPage` | `packages/test-framework/pages/automationexercise/AutomationExerciseProductsPage.ts` |
| Product detail | `AutomationExerciseProductDetailPage` | `packages/test-framework/pages/automationexercise/AutomationExerciseProductDetailPage.ts` |
| Cart | `AutomationExerciseCartPage` | `packages/test-framework/pages/automationexercise/AutomationExerciseCartPage.ts` |
| Contact Us | `AutomationExerciseContactUsPage` | `packages/test-framework/pages/automationexercise/AutomationExerciseContactUsPage.ts` |

Rules:
- Each class has its own `@pageIdentity` and `@urlPattern` matching that route.
- Shared site-wide actions (cookie banner, global nav) go in a **base** class (e.g. `AutomationExerciseBasePage`), not duplicated in every page.
- **Never** generate `AutomationExercisePage` or one mega-class for an entire site.
- Specs import **multiple** page classes and orchestrate the flow.
- Put site-specific pages under `packages/test-framework/pages/<site>/`.

## Site-specific notes (automationexercise.com)

- **Add to cart** is `<a class="add-to-cart">`, not `role=button`.
- Cookie consent: `button.fc-cta-consent` or role `Consent`.
- Cart modal: `#cartModal button.close-modal`, `#cartModal a[href="/view_cart"]`; wait for `/add_to_cart/` response.
- Cart page: URL `/view_cart`, rows via `.cart_description`, `.cart_price`, `.cart_quantity`, `.cart_total`.
- Contact form: scope to `.contact-form` and `input[name="..."]`; success under `#contact-page .alert-success`.

## BasePage reuse (mandatory)

- Page objects MUST `extend BasePage` (or a site base that extends `BasePage`).
- Use: `navigate()`, `clickByRole()`, `assertCountAtLeast()`, `assertUrl()`, etc.
- Do NOT redeclare `readonly page: Page` on subclasses.
- Do NOT instantiate abstract classes (e.g. `AutomationExerciseBasePage`).

## Live execution history (browser-use)

Codegen receives **LIVE EXECUTION HISTORY** as source of truth. NL steps are secondary.
Every workaround from the live run (cookies, modals, force clicks) must appear in POMs.

## Canonical POM injection

For `automationexercise.com`, WebPilot **replaces** LLM-generated page files with canonical POMs post-codegen.
Focus LLM effort on a **correct spec** using stable method names (see `automationexercise-catalog.md`).

Post-write: TypeScript check → Playwright run → auto-fix on spec failures.

## TypeScript quality

- Valid `@playwright/test` APIs only.
- NEVER `toHaveCountGreaterThan` — use `assertCountAtLeast(locator, n)`.
- Spec imports: `@pages/<folder>/<ClassName>` (never `../pages/...`).
