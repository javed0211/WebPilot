package webpilot.generated;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class Feature01SmokeTest {
  private WebDriver driver;

  @BeforeEach
  public void setUp() {
    driver = new ChromeDriver();
  }

  @AfterEach
  public void tearDown() {
    if (driver != null) {
      driver.quit();
    }
  }

  @Test
  public void feature01Smoke() {
    driver.get("https://automationexercise.com/");
    driver.findElement(By.xpath("//*[@role='link' and normalize-space(.)='Products']")).click();
    driver.get("https://automationexercise.com/products");
    // assertion(medium): URL contains "products"
    assertTrue(driver.getCurrentUrl().contains("products"));
    // assertion(strong): role selector is visible
    assertTrue(driver.findElement(By.xpath("//*[@role='heading' and normalize-space(.)='All Products']")).isDisplayed());
  }
}
