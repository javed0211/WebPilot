import * as fs from 'fs';
import * as path from 'path';

export const JAVA_FRAMEWORK_PATHS = {
  pom: 'pom.xml',
  basePage: 'src/test/java/webpilot/generated/pages/BasePage.java',
  baseTest: 'src/test/java/webpilot/support/BaseTest.java',
  configManager: 'src/test/java/webpilot/support/ConfigManager.java',
  sampleTest: 'src/test/java/webpilot/generated/AutomationExerciseSmokeTest.java',
} as const;

export function isFullJavaSelenium(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'java' && profile.automationTool === 'selenium';
}

export function buildPomXml(projectName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>io.webpilot</groupId>
  <artifactId>${projectName}</artifactId>
  <version>0.1.0</version>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <junit.version>5.11.4</junit.version>
    <selenium.version>4.27.0</selenium.version>
    <gson.version>2.11.0</gson.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>\${selenium.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>\${junit.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.google.code.gson</groupId>
      <artifactId>gson</artifactId>
      <version>\${gson.version}</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <release>\${maven.compiler.release}</release>
        </configuration>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
        <configuration>
          <includes>
            <include>**/*Test.java</include>
          </includes>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

export const JAVA_BASE_PAGE = `package webpilot.generated.pages;

import java.time.Duration;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

/** Shared Selenium helpers for WebPilot-generated page objects. */
public class BasePage {
  protected final WebDriver driver;
  protected final WebDriverWait wait;

  public BasePage(WebDriver driver) {
    this.driver = driver;
    this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
  }

  public void navigate(String url) {
    driver.get(url);
  }

  public void click(By locator) {
    wait.until(ExpectedConditions.elementToBeClickable(locator)).click();
  }

  public void fill(By locator, String value) {
    WebElement field = wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
    field.clear();
    field.sendKeys(value);
  }

  public void assertElementVisible(By locator) {
    wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
  }

  public boolean isElementVisible(By locator) {
    try {
      return driver.findElement(locator).isDisplayed();
    } catch (Exception ex) {
      return false;
    }
  }
}
`;

export const JAVA_BASE_TEST = `package webpilot.support;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

/** JUnit 5 lifecycle for WebPilot-generated Selenium tests. */
public abstract class BaseTest {
  protected WebDriver driver;

  @BeforeEach
  void setUp() {
    ChromeOptions options = new ChromeOptions();
    options.addArguments("--remote-allow-origins=*");
    driver = new ChromeDriver(options);
    driver.manage().window().maximize();
  }

  @AfterEach
  void tearDown() {
    if (driver != null) {
      driver.quit();
    }
  }
}
`;

export const JAVA_CONFIG_MANAGER = `package webpilot.support;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Load WebPilot environment JSON (resources/config/environments/<env>.json). */
public final class ConfigManager {
  private static final Gson GSON = new Gson();
  private static JsonObject cached;

  private ConfigManager() {}

  public static JsonObject getConfig() {
    if (cached != null) {
      return cached;
    }
    String env = System.getenv().getOrDefault("ENV", "qa");
    Path configPath = Path.of("resources", "config", "environments", env + ".json");
    if (!Files.exists(configPath)) {
      throw new IllegalStateException("Configuration file not found for environment \\"" + env + "\\": " + configPath);
    }
    try {
      String raw = Files.readString(configPath, StandardCharsets.UTF_8);
      cached = JsonParser.parseString(resolveEnvVars(raw)).getAsJsonObject();
      return cached;
    } catch (IOException ex) {
      throw new IllegalStateException("Failed to read configuration: " + configPath, ex);
    }
  }

  public static String getBaseUrl() {
    JsonObject config = getConfig();
    return config.has("baseUrl") ? config.get("baseUrl").getAsString() : "";
  }

  private static String resolveEnvVars(String input) {
    Pattern pattern = Pattern.compile("\\\\$\\\\{(\\\\w+)\\\\}");
    Matcher matcher = pattern.matcher(input);
    StringBuffer buffer = new StringBuffer();
    while (matcher.find()) {
      String value = System.getenv(matcher.group(1));
      matcher.appendReplacement(buffer, value != null ? Matcher.quoteReplacement(value) : matcher.group(0));
    }
    matcher.appendTail(buffer);
    return buffer.toString();
  }
}
`;

export const JAVA_SAMPLE_TEST = `package webpilot.generated;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import webpilot.generated.pages.BasePage;
import webpilot.support.BaseTest;

public class AutomationExerciseSmokeTest extends BaseTest {
  @Test
  void opensHomePage() {
    BasePage home = new BasePage(driver);
    home.navigate("https://automationexercise.com/");
    assertTrue(driver.getTitle().contains("Automation Exercise"));
  }
}
`;

export interface JavaFrameworkFile {
  path: string;
  content: string;
}

export function javaFrameworkFiles(projectName: string): JavaFrameworkFile[] {
  return [
    { path: JAVA_FRAMEWORK_PATHS.pom, content: buildPomXml(projectName) },
    { path: JAVA_FRAMEWORK_PATHS.basePage, content: JAVA_BASE_PAGE },
    { path: JAVA_FRAMEWORK_PATHS.baseTest, content: JAVA_BASE_TEST },
    { path: JAVA_FRAMEWORK_PATHS.configManager, content: JAVA_CONFIG_MANAGER },
    { path: JAVA_FRAMEWORK_PATHS.sampleTest, content: JAVA_SAMPLE_TEST },
  ];
}

export function readJavaProjectName(cwd = process.cwd()): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) {
      return pkg.name;
    }
  } catch {
    // ignore
  }
  try {
    const pom = fs.readFileSync(path.join(cwd, 'pom.xml'), 'utf8');
    const match = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // ignore
  }
  return 'webpilot-project';
}

/** Write missing Java Selenium framework files (safe for existing projects). */
export function ensureJavaSeleniumFramework(
  cwd = process.cwd(),
  projectName = readJavaProjectName(cwd)
): string[] {
  const written: string[] = [];
  for (const file of javaFrameworkFiles(projectName)) {
    const fullPath = path.join(cwd, file.path);
    if (fs.existsSync(fullPath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content.trimEnd() + '\n', 'utf8');
    written.push(file.path);
  }
  return written;
}
