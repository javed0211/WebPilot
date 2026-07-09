import * as fs from 'fs';
import * as path from 'path';

export const CSHARP_SELENIUM_PATHS = {
  csproj: 'tests/WebPilot.Tests/WebPilot.Tests.csproj',
  basePage: 'tests/WebPilot.Tests/Generated/Pages/BasePage.cs',
  baseTest: 'tests/WebPilot.Tests/Support/BaseTest.cs',
  configManager: 'tests/WebPilot.Tests/Support/ConfigManager.cs',
  sampleTest: 'tests/WebPilot.Tests/Generated/AutomationExerciseSmokeTests.cs',
} as const;

export const CSHARP_PLAYWRIGHT_PATHS = {
  csproj: 'tests/WebPilot.Playwright.Tests/WebPilot.Playwright.Tests.csproj',
  basePage: 'tests/WebPilot.Playwright.Tests/Generated/Pages/BasePage.cs',
  configManager: 'tests/WebPilot.Playwright.Tests/Support/ConfigManager.cs',
  sampleTest: 'tests/WebPilot.Playwright.Tests/Generated/AutomationExerciseSmokeTests.cs',
} as const;

export function isFullCsharpSelenium(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'csharp' && profile.automationTool === 'selenium';
}

export function isFullCsharpPlaywright(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return profile.language === 'csharp' && profile.automationTool === 'playwright';
}

export function isFullCsharpProfile(profile: {
  language: string;
  automationTool: string;
}): boolean {
  return isFullCsharpSelenium(profile) || isFullCsharpPlaywright(profile);
}

export function buildCsharpSeleniumCsproj(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>WebPilot.Tests</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
    <PackageReference Include="Selenium.WebDriver" Version="4.27.0" />
    <PackageReference Include="Selenium.Support" Version="4.27.0" />
  </ItemGroup>
</Project>
`;
}

export const CSHARP_BASE_PAGE = `using OpenQA.Selenium;
using OpenQA.Selenium.Support.UI;

namespace WebPilot.Tests.Generated.Pages;

/// <summary>Shared Selenium helpers for WebPilot-generated page objects.</summary>
public class BasePage
{
    protected readonly IWebDriver Driver;
    protected readonly WebDriverWait Wait;

    public BasePage(IWebDriver driver)
    {
        Driver = driver;
        Wait = new WebDriverWait(driver, TimeSpan.FromSeconds(10));
    }

    public void Navigate(string url) => Driver.Navigate().GoToUrl(url);

    public void Click(By locator) => Wait.Until(d => d.FindElement(locator)).Click();

    public void Fill(By locator, string value)
    {
        var field = Wait.Until(d => d.FindElement(locator));
        field.Clear();
        field.SendKeys(value);
    }

    public void AssertElementVisible(By locator) =>
        Wait.Until(d => d.FindElement(locator).Displayed);
}
`;

export const CSHARP_BASE_TEST = `using NUnit.Framework;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

namespace WebPilot.Tests.Support;

/// <summary>NUnit lifecycle for WebPilot-generated Selenium tests.</summary>
public abstract class BaseTest
{
    protected IWebDriver Driver = null!;

    [SetUp]
    public void SetUp()
    {
        var options = new ChromeOptions();
        options.AddArgument("--remote-allow-origins=*");
        Driver = new ChromeDriver(options);
        Driver.Manage().Window.Maximize();
    }

    [TearDown]
    public void TearDown()
    {
        Driver?.Quit();
    }
}
`;

export const CSHARP_CONFIG_MANAGER = `using System.Text.Json;
using System.Text.RegularExpressions;

namespace WebPilot.Tests.Support;

/// <summary>Load WebPilot environment JSON (resources/config/environments/&lt;env&gt;.json).</summary>
public static class ConfigManager
{
    private static JsonDocument? _cached;

    public static JsonElement GetConfig()
    {
        if (_cached != null)
        {
            return _cached.RootElement.Clone();
        }

        var env = Environment.GetEnvironmentVariable("ENV") ?? "qa";
        var configPath = Path.Combine("resources", "config", "environments", $"{env}.json");
        if (!File.Exists(configPath))
        {
            throw new FileNotFoundException($"Configuration file not found for environment \"{env}\": {configPath}");
        }

        var raw = File.ReadAllText(configPath);
        var resolved = ResolveEnvVars(raw);
        _cached = JsonDocument.Parse(resolved);
        return _cached.RootElement.Clone();
    }

    public static string GetBaseUrl()
    {
        var config = GetConfig();
        return config.TryGetProperty("baseUrl", out var baseUrl) ? baseUrl.GetString() ?? string.Empty : string.Empty;
    }

    private static string ResolveEnvVars(string input) =>
        Regex.Replace(input, "\\\\$\\\\{(\\\\w+)\\\\}", match =>
        {
            var name = match.Groups[1].Value;
            return Environment.GetEnvironmentVariable(name) ?? match.Value;
        });
}
`;

export const CSHARP_SAMPLE_TEST = `using NUnit.Framework;
using WebPilot.Tests.Generated.Pages;
using WebPilot.Tests.Support;

namespace WebPilot.Tests.Generated;

public class AutomationExerciseSmokeTests : BaseTest
{
    [Test]
    public void OpensHomePage()
    {
        var home = new BasePage(Driver);
        home.Navigate("https://automationexercise.com/");
        Assert.That(Driver.Title, Does.Contain("Automation Exercise"));
    }
}
`;

export function buildCsharpPlaywrightCsproj(): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>WebPilot.Playwright.Tests</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="Microsoft.Playwright.NUnit" Version="1.49.0" />
    <PackageReference Include="NUnit" Version="4.2.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.6.0" />
  </ItemGroup>
</Project>
`;
}

export const CSHARP_PLAYWRIGHT_BASE_PAGE = `using Microsoft.Playwright;

namespace WebPilot.Playwright.Tests.Generated.Pages;

/// <summary>Shared Playwright helpers for WebPilot-generated page objects.</summary>
public class BasePage
{
    protected readonly IPage Page;

    public BasePage(IPage page) => Page = page;

    public async Task Navigate(string url) => await Page.GotoAsync(url);

    public async Task Click(ILocator locator) => await locator.ClickAsync();

    public async Task Fill(ILocator locator, string value) => await locator.FillAsync(value);

    public async Task AssertVisible(ILocator locator) =>
        await Assertions.Expect(locator).ToBeVisibleAsync();
}
`;

export const CSHARP_PLAYWRIGHT_CONFIG_MANAGER = `using System.Text.Json;
using System.Text.RegularExpressions;

namespace WebPilot.Playwright.Tests.Support;

/// <summary>Load WebPilot environment JSON (resources/config/environments/&lt;env&gt;.json).</summary>
public static class ConfigManager
{
    private static JsonDocument? _cached;

    public static JsonElement GetConfig()
    {
        if (_cached != null)
        {
            return _cached.RootElement.Clone();
        }

        var env = Environment.GetEnvironmentVariable("ENV") ?? "qa";
        var configPath = Path.Combine("resources", "config", "environments", $"{env}.json");
        if (!File.Exists(configPath))
        {
            throw new FileNotFoundException($"Configuration file not found for environment \"{env}\": {configPath}");
        }

        var raw = File.ReadAllText(configPath);
        var resolved = ResolveEnvVars(raw);
        _cached = JsonDocument.Parse(resolved);
        return _cached.RootElement.Clone();
    }

    public static string GetBaseUrl()
    {
        var config = GetConfig();
        return config.TryGetProperty("baseUrl", out var baseUrl) ? baseUrl.GetString() ?? string.Empty : string.Empty;
    }

    private static string ResolveEnvVars(string input) =>
        Regex.Replace(input, "\\\\$\\\\{(\\\\w+)\\\\}", match =>
        {
            var name = match.Groups[1].Value;
            return Environment.GetEnvironmentVariable(name) ?? match.Value;
        });
}
`;

export const CSHARP_PLAYWRIGHT_SAMPLE_TEST = `using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Microsoft.Playwright.NUnit;
using WebPilot.Playwright.Tests.Generated.Pages;

namespace WebPilot.Playwright.Tests.Generated;

[Parallelizable(ParallelScope.Self)]
public class AutomationExerciseSmokeTests : PageTest
{
    [Test]
    public async Task OpensHomePage()
    {
        var home = new BasePage(Page);
        await home.Navigate("https://automationexercise.com/");
        await Expect(Page).ToHaveTitleAsync(new Regex("Automation Exercise", RegexOptions.IgnoreCase));
    }
}
`;

export interface CsharpFrameworkFile {
  path: string;
  content: string;
}

export function csharpSeleniumFrameworkFiles(): CsharpFrameworkFile[] {
  return [
    { path: CSHARP_SELENIUM_PATHS.csproj, content: buildCsharpSeleniumCsproj() },
    { path: CSHARP_SELENIUM_PATHS.basePage, content: CSHARP_BASE_PAGE },
    { path: CSHARP_SELENIUM_PATHS.baseTest, content: CSHARP_BASE_TEST },
    { path: CSHARP_SELENIUM_PATHS.configManager, content: CSHARP_CONFIG_MANAGER },
    { path: CSHARP_SELENIUM_PATHS.sampleTest, content: CSHARP_SAMPLE_TEST },
  ];
}

export function csharpPlaywrightFrameworkFiles(): CsharpFrameworkFile[] {
  return [
    { path: CSHARP_PLAYWRIGHT_PATHS.csproj, content: buildCsharpPlaywrightCsproj() },
    { path: CSHARP_PLAYWRIGHT_PATHS.basePage, content: CSHARP_PLAYWRIGHT_BASE_PAGE },
    { path: CSHARP_PLAYWRIGHT_PATHS.configManager, content: CSHARP_PLAYWRIGHT_CONFIG_MANAGER },
    { path: CSHARP_PLAYWRIGHT_PATHS.sampleTest, content: CSHARP_PLAYWRIGHT_SAMPLE_TEST },
  ];
}

export function readCsharpProjectName(cwd = process.cwd()): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name) {
      return pkg.name;
    }
  } catch {
    // ignore
  }
  return 'webpilot-project';
}

export function ensureCsharpSeleniumFramework(cwd = process.cwd()): string[] {
  const written: string[] = [];
  for (const file of csharpSeleniumFrameworkFiles()) {
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

export function ensureCsharpPlaywrightFramework(cwd = process.cwd()): string[] {
  const written: string[] = [];
  for (const file of csharpPlaywrightFrameworkFiles()) {
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
