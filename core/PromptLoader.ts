import * as fs from 'fs';
import * as path from 'path';

const PROMPTS_ROOT = path.join(process.cwd(), 'prompts');

/**
 * Loads editable Markdown prompts from `prompts/` (see prompts/README.md).
 */
export class PromptLoader {
  public static readonly root = PROMPTS_ROOT;

  public static load(relativePath: string): string {
    const full = path.join(PROMPTS_ROOT, relativePath);
    if (!fs.existsSync(full)) {
      throw new Error(`Prompt file not found: prompts/${relativePath}`);
    }
    return fs.readFileSync(full, 'utf8');
  }

  public static tryLoad(relativePath: string, fallback = ''): string {
    const full = path.join(PROMPTS_ROOT, relativePath);
    if (!fs.existsSync(full)) {
      return fallback;
    }
    return fs.readFileSync(full, 'utf8');
  }

  public static loadWithVars(relativePath: string, vars: Record<string, string>): string {
    let text = this.load(relativePath);
    for (const [key, value] of Object.entries(vars)) {
      text = text.split(`{{${key}}}`).join(value);
    }
    return text;
  }

  /** Locator rules + framework guidelines + automationexercise catalog. */
  public static loadFrameworkRules(): string {
    return [
      '=== LOCATOR STRICT RULES (mandatory) ===',
      this.load('shared/locator-strict-rules.md'),
      '',
      '=== FRAMEWORK GUIDELINES ===',
      this.load('shared/framework-guidelines.md'),
      '',
      '=== AUTOMATION EXERCISE CATALOG ===',
      this.load('shared/automationexercise-catalog.md'),
    ].join('\n');
  }
}
