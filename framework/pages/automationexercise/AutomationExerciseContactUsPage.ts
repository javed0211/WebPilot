import { expect } from '@playwright/test';
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
    await this.page.waitForURL(/\/contact_us/, { timeout: 15000 });
  }

  public async assertContactPageLoaded(): Promise<void> {
    await this.assertUrl(/\/contact_us/);
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
