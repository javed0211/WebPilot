import path from 'path';
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
