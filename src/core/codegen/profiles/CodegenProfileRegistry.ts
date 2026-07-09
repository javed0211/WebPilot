import { CodegenProfilePlan } from '../GenerationPlan';
import { CodegenProfile } from './CodegenProfile';
import { JavaSeleniumProfile } from './JavaSeleniumProfile';
import { PythonPlaywrightProfile } from './PythonPlaywrightProfile';
import { TypeScriptCypressProfile } from './TypeScriptCypressProfile';
import { TypeScriptPlaywrightProfile } from './TypeScriptPlaywrightProfile';
import { CsharpSeleniumProfile } from './CsharpSeleniumProfile';
import { CsharpPlaywrightProfile } from './CsharpPlaywrightProfile';
import { TypeScriptWebdriverIOProfile } from './TypeScriptWebdriverIOProfile';

const PROFILES: CodegenProfile[] = [
  new TypeScriptPlaywrightProfile(),
  new PythonPlaywrightProfile(),
  new JavaSeleniumProfile(),
  new TypeScriptCypressProfile(),
  new CsharpSeleniumProfile(),
  new CsharpPlaywrightProfile(),
  new TypeScriptWebdriverIOProfile(),
];

export class CodegenProfileRegistry {
  public static all(): CodegenProfile[] {
    return PROFILES;
  }

  public static resolve(profile: CodegenProfilePlan): CodegenProfile {
    const match = PROFILES.find((candidate) => candidate.matches(profile));
    if (match) return match;
    throw new Error(
      `Unsupported codegen profile: ${profile.language}/${profile.automationTool}/${profile.frameworkPattern}`
    );
  }

  public static supportedProfileIds(): string[] {
    return PROFILES.map((profile) => profile.id);
  }
}
