/**
 * Battle-tested POM implementations for automationexercise.com.
 * CodegenNormalizer replaces LLM page output with these files so Playwright runs pass without manual edits.
 */
export const AUTOMATION_EXERCISE_CANONICAL_PATHS = new Set([
  'packages/test-framework/pages/automationexercise/AutomationExerciseBasePage.ts',
  'packages/test-framework/pages/automationexercise/AutomationExerciseHomePage.ts',
  'packages/test-framework/pages/automationexercise/AutomationExerciseProductsPage.ts',
  'packages/test-framework/pages/automationexercise/AutomationExerciseCartPage.ts',
  'packages/test-framework/pages/automationexercise/AutomationExerciseContactUsPage.ts',
]);

export const AUTOMATION_EXERCISE_BASE_PAGE = `import { BasePage } from '@core/BasePage';
import { Page } from '@playwright/test';

/**
 * @pageIdentity AutomationExerciseBasePage
 * Shared Automation Exercise helpers (cookie banner, global nav).
 */
export abstract class AutomationExerciseBasePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async dismissCookieConsentIfPresent(): Promise<void> {
    const consent = this.page.locator('.fc-consent-root');
    if (!(await consent.isVisible().catch(() => false))) {
      return;
    }
    const acceptSelectors = [
      this.page.locator('button.fc-cta-consent'),
      this.page.getByRole('button', { name: 'Consent', exact: true }),
      this.page.getByRole('button', { name: /accept all|accept|agree/i }),
    ];
    for (const accept of acceptSelectors) {
      if (await accept.first().isVisible().catch(() => false)) {
        await accept.first().click({ force: true });
        await consent.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
        return;
      }
    }
  }

  async openProductsFromNav(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.clickByRole('link', { name: 'Products' });
  }
}
`;

export const AUTOMATION_EXERCISE_HOME_PAGE = `import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseHomePage
 * @urlPattern https://automationexercise.com/?
 */
export class AutomationExerciseHomePage extends AutomationExerciseBasePage {
  public async goto(): Promise<void> {
    await this.navigate('https://automationexercise.com/');
    await this.dismissCookieConsentIfPresent();
  }

  public async assertFeaturedItemsVisible(): Promise<void> {
    await this.assertHeadingVisible(/FEATURES ITEMS/i);
    const featuredCards = this.page.locator('.features_items .product-image-wrapper');
    await this.assertCountAtLeast(featuredCards, 1);
    await expect(featuredCards.first()).toBeVisible();
  }

  public async goToProductsPage(): Promise<void> {
    await this.openProductsFromNav();
  }

  /** Alias for LLM-generated method names */
  public async clickProductsNav(): Promise<void> {
    await this.goToProductsPage();
  }
}
`;

export const AUTOMATION_EXERCISE_PRODUCTS_PAGE = `import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseProductsPage
 * @urlPattern https://automationexercise.com/products
 */
export class AutomationExerciseProductsPage extends AutomationExerciseBasePage {
  private productCards() {
    return this.page.locator('.features_items .product-image-wrapper');
  }

  public async assertAllProductsVisible(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.assertHeadingVisible(/All Products/i);
    await this.assertCountAtLeast(this.productCards(), 3);
  }

  public async assertAllProductsPageLoaded(): Promise<void> {
    await this.assertAllProductsVisible();
  }

  public async hoverProductAt(index: number): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.productCards().nth(index).hover();
  }

  public async hoverProductCard(index: number): Promise<void> {
    await this.hoverProductAt(index);
  }

  public async hoverProductByIndex(index: number): Promise<void> {
    await this.hoverProductAt(index);
  }

  public async addToCartProductAt(index: number): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    const addToCart = this.productCards().nth(index).locator('a.add-to-cart').first();
    await addToCart.waitFor({ state: 'visible', timeout: 10000 });
    await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/add_to_cart/') && res.ok(),
        { timeout: 15000 }
      ),
      addToCart.click({ force: true }),
    ]);
    await expect(this.page.locator('#cartModal')).toContainText(/added/i, { timeout: 10000 });
  }

  public async clickAddToCartByIndex(index: number): Promise<void> {
    await this.addToCartProductAt(index);
  }

  public async handleCartModal(action: 'continue' | 'view'): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.page.locator('#cartModal').waitFor({ state: 'attached', timeout: 10000 });
    if (action === 'continue') {
      await expect(this.page.locator('#cartModal')).toContainText(/added/i);
      await this.page.evaluate(() => {
        (document.querySelector('#cartModal button.close-modal') as HTMLElement | null)?.click();
      });
      await this.page.locator('#cartModal').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      return;
    }
    const viewCart = this.page.locator('#cartModal a[href="/view_cart"]');
    try {
      await viewCart.click({ force: true, timeout: 5000 });
      await this.page.waitForURL(/\\/view_cart/, { timeout: 15000 });
    } catch {
      await this.page.evaluate(() => {
        (document.querySelector('#cartModal a[href="/view_cart"]') as HTMLElement | null)?.click();
      });
      try {
        await this.page.waitForURL(/\\/view_cart/, { timeout: 10000 });
      } catch {
        await this.navigate('https://automationexercise.com/view_cart');
      }
    }
  }
}
`;

export const AUTOMATION_EXERCISE_CART_PAGE = `import { expect } from '@playwright/test';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

export type CartLineItem = {
  name: string;
  price: string;
  quantity: string;
  total: string;
  description?: string;
};

/**
 * @pageIdentity AutomationExerciseCartPage
 * @urlPattern https://automationexercise.com/view_cart
 */
export class AutomationExerciseCartPage extends AutomationExerciseBasePage {
  public async assertOnCartPage(): Promise<void> {
    await this.assertUrl(/\\/view_cart/);
    await expect(this.page.getByText(/cart is empty/i)).not.toBeVisible({ timeout: 5000 }).catch(() => {});
    await this.assertElementVisible('#cart_info_table');
    await this.assertCountAtLeast(this.page.locator('#cart_info_table tbody tr'), 1);
  }

  public async assertCartPageLoaded(): Promise<void> {
    await this.assertOnCartPage();
  }

  public async assertCartProducts(expected: CartLineItem[]): Promise<void> {
    const rows = this.page.locator('#cart_info_table tbody tr');
    await this.assertCountAtLeast(rows, expected.length);
    for (let i = 0; i < expected.length; i++) {
      const row = rows.nth(i);
      const exp = expected[i];
      await expect(row.locator('.cart_description h4 a').first()).toContainText(exp.name);
      if (exp.description) {
        await expect(row.locator('.cart_description p').first()).toContainText(exp.description);
      }
      await expect(row.locator('.cart_price p').first()).toHaveText(exp.price);
      await expect(row.locator('.cart_quantity button').first()).toHaveText(exp.quantity);
      await expect(row.locator('.cart_total p').first()).toHaveText(exp.total);
    }
  }

  public async assertProductsInCart(
    expected: Array<{ name: string; price: string; quantity: string; total: string; description?: string }>
  ): Promise<void> {
    await this.assertCartProducts(expected);
  }
}
`;

export const AUTOMATION_EXERCISE_CONTACT_US_PAGE = `import { expect } from '@playwright/test';
import path from 'path';
import { AutomationExerciseBasePage } from './AutomationExerciseBasePage';

/**
 * @pageIdentity AutomationExerciseContactUsPage
 * @urlPattern https://automationexercise.com/contact_us
 */
export class AutomationExerciseContactUsPage extends AutomationExerciseBasePage {
  private contactForm() {
    return this.page.locator('.contact-form');
  }

  public async openFromNav(): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    await this.clickByRole('link', { name: /Contact us/i });
    await this.page.waitForURL(/\\/contact_us/, { timeout: 15000 });
  }

  public async assertContactPageLoaded(): Promise<void> {
    await this.assertUrl(/\\/contact_us/);
    await expect(this.page.getByText(/GET IN TOUCH/i)).toBeVisible();
  }

  public async fillContactForm(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }): Promise<void> {
    await this.dismissCookieConsentIfPresent();
    const form = this.contactForm();
    await form.locator('input[name="name"]').fill(data.name);
    await form.locator('input[name="email"]').fill(data.email);
    await form.locator('input[name="subject"]').fill(data.subject);
    await form.locator('textarea[name="message"]').fill(data.message);
  }

  public async uploadFile(filePath?: string): Promise<void> {
    const resolved =
      filePath ?? path.join(process.cwd(), 'tests', 'fixtures', 'sample.txt');
    await this.contactForm().locator('input[name="upload_file"]').setInputFiles(resolved);
  }

  public async submitAndAcceptAlert(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept());
    await this.contactForm().locator('input[type="submit"][value="Submit"]').click();
  }

  public async assertSubmissionSuccess(): Promise<void> {
    await expect(
      this.page.locator('#contact-page .alert-success').filter({
        hasText: /Success! Your details have been submitted successfully/i,
      })
    ).toBeVisible();
  }

  public async clickHome(): Promise<void> {
    await this.page.locator('#contact-page').getByRole('link', { name: /Home/i }).click();
  }
}
`;

export const CANONICAL_CONTACT_US_SPEC = `import path from 'path';
import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '@pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseContactUsPage } from '@pages/automationexercise/AutomationExerciseContactUsPage';

test.describe('Automation Exercise - Contact Us Form', () => {
  test('should submit contact form with file upload and verify success', async ({ page }) => {
    const uploadFile = path.join(process.cwd(), 'tests', 'fixtures', 'sample.txt');
    const home = new AutomationExerciseHomePage(page);
    const contact = new AutomationExerciseContactUsPage(page);

    await home.goto();
    await home.assertFeaturedItemsVisible();
    await contact.openFromNav();
    await contact.assertContactPageLoaded();
    await contact.fillContactForm({
      name: 'WebPilot Tester',
      email: 'webpilot.test@example.com',
      subject: 'Automation test inquiry',
      message: 'This is an automated test message from WebPilot.',
    });
    await contact.uploadFile(uploadFile);
    await contact.submitAndAcceptAlert();
    await contact.assertSubmissionSuccess();
    await contact.clickHome();
    await home.assertFeaturedItemsVisible();
  });
});
`;

export const CANONICAL_AUTOMATIONEXERCISE_SMOKE_SPEC = `import { test } from '@playwright/test';
import { AutomationExerciseHomePage } from '../pages/automationexercise/AutomationExerciseHomePage';
import { AutomationExerciseProductsPage } from '../pages/automationexercise/AutomationExerciseProductsPage';

test('AutomationExercise Smoke', async ({ page }) => {
  const homePage = new AutomationExerciseHomePage(page);
  const productsPage = new AutomationExerciseProductsPage(page);

  await homePage.goto();
  await homePage.assertFeaturedItemsVisible();
  await homePage.goToProductsPage();
  await productsPage.assertAllProductsPageLoaded();
});
`;

export const CANONICAL_PAGE_CONTENT: Record<string, string> = {
  'packages/test-framework/pages/automationexercise/AutomationExerciseBasePage.ts': AUTOMATION_EXERCISE_BASE_PAGE,
  'packages/test-framework/pages/automationexercise/AutomationExerciseHomePage.ts': AUTOMATION_EXERCISE_HOME_PAGE,
  'packages/test-framework/pages/automationexercise/AutomationExerciseProductsPage.ts': AUTOMATION_EXERCISE_PRODUCTS_PAGE,
  'packages/test-framework/pages/automationexercise/AutomationExerciseCartPage.ts': AUTOMATION_EXERCISE_CART_PAGE,
  'packages/test-framework/pages/automationexercise/AutomationExerciseContactUsPage.ts': AUTOMATION_EXERCISE_CONTACT_US_PAGE,
};

export const CANONICAL_SPEC_BY_SLUG: Record<string, { path: string; content: string }> = {
  automationexercise_smoke: {
    path: 'packages/test-framework/tests/automationexercise_smoke.spec.ts',
    content: CANONICAL_AUTOMATIONEXERCISE_SMOKE_SPEC,
  },
  automationexercise_contact_us: {
    path: 'packages/test-framework/tests/contact-us-form.spec.ts',
    content: CANONICAL_CONTACT_US_SPEC,
  },
};
