import { generatedSpecsDir } from '../codegen/GeneratedPaths';

export interface NextStepBlock {
  title: string;
  lines: string[];
}

export class AuthoringOutput {
  public static block(block: NextStepBlock): string {
    const lines = [`${block.title}:`, ...block.lines.map((line) => `  - ${line}`)];
    return lines.join('\n');
  }

  public static createdTest(filePath: string, options: { runCommand: string }): NextStepBlock {
    return {
      title: 'Next steps',
      lines: [
        `Review ${filePath}`,
        `Run ${options.runCommand}`,
        'Open runtime/reports/html/index.html after the run',
      ],
    };
  }

  public static runComplete(options: {
    passed: number;
    failed: number;
    reportPath?: string;
    manifestPath?: string;
    codegenEnabled?: boolean;
    phaseLines?: string[];
  }): NextStepBlock {
    const lines = [
      `${options.passed} passed, ${options.failed} failed`,
      options.reportPath ? `Report: ${options.reportPath}` : 'Report: run again with --report to generate HTML',
      options.manifestPath ? `Artifacts: ${options.manifestPath}` : 'Artifacts: runtime/reports/',
    ];
    if (options.phaseLines?.length) {
      lines.push(...options.phaseLines);
    }
    if (options.codegenEnabled) {
      const specsDir = generatedSpecsDir();
      lines.push(`Generated tests: ${specsDir}/`);
      lines.push(`Replay: webpilot replay ${specsDir}`);
    } else {
      lines.push('Generate code: add --codegen or set codegen: true in the scenario file');
    }
    return { title: 'Run summary', lines };
  }
}
