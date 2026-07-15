import * as fs from 'fs';
import * as path from 'path';
import { GeneratedFile } from '../agents/CodegenAgent';
import { SymbolParser } from './SymbolParser';
import { parseSpecImports } from './CodegenValidationBundle';

export interface ReferenceIssue {
  file: string;
  message: string;
  code: 'missing_import' | 'missing_method' | 'non_executable_spec' | 'stub_page_object';
}

export interface ReferenceValidationResult {
  valid: boolean;
  issues: ReferenceIssue[];
}

function isCommentOnlySpec(content: string): boolean {
  const withoutImports = content.replace(/^import[\s\S]*?;$/gm, '').trim();
  const awaits = withoutImports.match(/\bawait\b/g)?.length ?? 0;
  const commentOnlyLines = withoutImports
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('//'));
  return awaits === 0 && commentOnlyLines.length > 0;
}

function parseInstances(specContent: string): Map<string, string> {
  const instances = new Map<string, string>();
  const instanceRe = /const\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = instanceRe.exec(specContent)) !== null) {
    instances.set(match[1], match[2]);
  }
  return instances;
}

function parseMethodCalls(specContent: string): Array<{ variable: string; method: string }> {
  const calls: Array<{ variable: string; method: string }> = [];
  const callRe = /await\s+(\w+)\.(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(specContent)) !== null) {
    if (match[1] === 'page' || match[1] === 'expect') {
      continue;
    }
    calls.push({ variable: match[1], method: match[2] });
  }
  return calls;
}

function methodNamesForClass(
  classFilePath: string,
  className: string,
  filesByPath: Map<string, GeneratedFile>
): Set<string> {
  const normalized = classFilePath.replace(/\\/g, '/');
  const fromBundle = filesByPath.get(normalized);
  if (fromBundle) {
    const methods = new Set<string>();
    // Class methods are public by default in TS; generated/LLM-fixed POMs may omit `public`.
    const methodRe = /(?:public\s+)?async\s+(\w+)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = methodRe.exec(fromBundle.content)) !== null) {
      methods.add(match[1]);
    }
    return methods;
  }

  const fullPath = path.join(process.cwd(), classFilePath);
  if (!fs.existsSync(fullPath)) {
    return new Set();
  }
  try {
    const classes = SymbolParser.parseFile(fullPath);
    const match = classes.find((info) => info.name === className);
    return new Set(match?.methods.map((method) => method.name) || []);
  } catch {
    return new Set();
  }
}

function fileExists(classFilePath: string, filesByPath: Map<string, GeneratedFile>): boolean {
  const normalized = classFilePath.replace(/\\/g, '/');
  return filesByPath.has(normalized) || fs.existsSync(path.join(process.cwd(), classFilePath));
}

/**
 * Validates import paths, POM method references, and that specs contain executable steps.
 */
export class CodegenReferenceValidator {
  public static validate(files: GeneratedFile[]): ReferenceValidationResult {
    const issues: ReferenceIssue[] = [];
    const byPath = new Map(files.map((file) => [file.path.replace(/\\/g, '/'), file]));

    for (const file of files) {
      if (!file.path.endsWith('.spec.ts')) {
        continue;
      }

      if (isCommentOnlySpec(file.content)) {
        issues.push({
          file: file.path,
          code: 'non_executable_spec',
          message:
            'Generated spec contains comment-only steps with no await calls. Re-run with discovery or enriched execution history.',
        });
      }

      const imports = parseSpecImports(file.content, file.path);
      const importByClass = new Map(imports.map((imp) => [imp.className, imp]));
      const instances = parseInstances(file.content);

      for (const imp of imports) {
        const resolved = imp.resolvedPath.replace(/\\/g, '/');
        if (!byPath.has(resolved) && !fileExists(resolved, byPath)) {
          issues.push({
            file: file.path,
            code: 'missing_import',
            message: `Import "${imp.importFrom}" resolves to missing file ${resolved}`,
          });
        }
      }

      for (const call of parseMethodCalls(file.content)) {
        const className = instances.get(call.variable);
        if (!className) {
          continue;
        }
        const imp = importByClass.get(className);
        if (!imp) {
          continue;
        }
        const resolved = imp.resolvedPath.replace(/\\/g, '/');
        const methods = methodNamesForClass(resolved, className, byPath);
        if (methods.size === 0 && fileExists(resolved, byPath)) {
          issues.push({
            file: resolved,
            code: 'stub_page_object',
            message: `${className} has no public methods but spec calls ${call.variable}.${call.method}()`,
          });
          continue;
        }
        if (methods.size > 0 && !methods.has(call.method)) {
          issues.push({
            file: file.path,
            code: 'missing_method',
            message: `${className}.${call.method}() is not defined in ${resolved}`,
          });
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
