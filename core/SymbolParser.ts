import * as fs from 'fs';
import * as path from 'path';

export interface PropertyInfo {
  name: string;
  type: string;
  value?: string;
  docString?: string;
}

export interface ParameterInfo {
  name: string;
  type: string;
}

export interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  docString?: string;
  bodyCode?: string;
}

export interface ClassSymbolInfo {
  name: string;
  extendsClass?: string;
  pageIdentity?: string;
  urlPattern?: string;
  filePath: string;
  properties: PropertyInfo[];
  methods: MethodInfo[];
}

export interface SymbolGraph {
  version: string;
  lastUpdated: string;
  classes: ClassSymbolInfo[];
}

/**
 * Lightweight Python symbol parser for generated Page Object files.
 * It intentionally supports the constrained class/method format produced by WebPilot.
 */
export class SymbolParser {
  public static parseFile(filePath: string): ClassSymbolInfo[] {
    const source = fs.readFileSync(filePath, 'utf8');
    const classes: ClassSymbolInfo[] = [];
    const classPattern = /^class\s+(\w+)(?:\(([^)]+)\))?:\s*$/gm;
    const matches = [...source.matchAll(classPattern)];

    matches.forEach((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? source.length;
      const block = source.slice(start, end);
      const methods: MethodInfo[] = [];
      const methodPattern = /^\s{4}def\s+(\w+)\(([^)]*)\)(?:\s*->\s*([^:]+))?:/gm;
      for (const method of block.matchAll(methodPattern)) {
        const parameters = method[2]
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part && part !== 'self')
          .map((part) => {
            const [name, type = 'Any'] = part.split(':').map((value) => value.trim());
            return { name: name.split('=')[0].trim(), type };
          });
        methods.push({
          name: method[1],
          parameters,
          returnType: method[3]?.trim() ?? 'None',
        });
      }
      classes.push({
        name: match[1],
        extendsClass: match[2]?.split(',')[0].trim(),
        pageIdentity: block.match(/@pageIdentity\s+([^\s\n\r]+)/)?.[1],
        urlPattern: block.match(/@urlPattern\s+([^\n\r]+)/)?.[1]?.trim(),
        filePath,
        properties: [],
        methods,
      });
    });
    return classes;
  }

  private static collectPageFiles(directoryPath: string): string[] {
    if (!fs.existsSync(directoryPath)) return [];
    return fs.readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) return SymbolParser.collectPageFiles(fullPath);
      return entry.name.endsWith('.py') && !entry.name.startsWith('__') ? [fullPath] : [];
    });
  }

  public static generateGraph(directoryPath: string): SymbolGraph {
    const classes = SymbolParser.collectPageFiles(directoryPath).flatMap((filePath) => {
      try {
        return SymbolParser.parseFile(filePath);
      } catch (error) {
        console.error(`[SymbolParser] Error parsing ${filePath}:`, error);
        return [];
      }
    });
    return { version: '2.0.0', lastUpdated: new Date().toISOString(), classes };
  }

  public static saveGraph(graph: SymbolGraph, outputPath: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf8');
  }

  public static loadGraph(inputPath: string): SymbolGraph {
    if (!fs.existsSync(inputPath)) {
      return { version: '2.0.0', lastUpdated: new Date().toISOString(), classes: [] };
    }
    return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  }
}

export class SymbolGraphQuery {
  constructor(private graph: SymbolGraph) {}

  public findPageByUrl(url: string): ClassSymbolInfo | undefined {
    return this.graph.classes.find((item) => {
      if (!item.urlPattern) return false;
      try {
        return new RegExp(item.urlPattern).test(url);
      } catch {
        return url.includes(item.urlPattern);
      }
    });
  }

  public findPageByIdentity(identity: string): ClassSymbolInfo | undefined {
    return this.graph.classes.find((item) => item.pageIdentity === identity);
  }

  public getSymbolsForPrompt(classNames: string[]): Partial<SymbolGraph> {
    return {
      version: this.graph.version,
      classes: this.graph.classes.filter((item) => classNames.includes(item.name)),
    };
  }
}

export class ASTMerger {
  /**
   * Merge generated Python methods by preserving the existing class and appending
   * methods whose names are not already present.
   */
  public static mergeClassContent(existingFilePath: string, generatedContent: string): string {
    const existing = fs.readFileSync(existingFilePath, 'utf8').trimEnd();
    const generatedMethods = ASTMerger.extractMethods(generatedContent);
    const existingNames = new Set(
      [...existing.matchAll(/^\s{4}def\s+(\w+)\(/gm)].map((match) => match[1])
    );
    const additions = generatedMethods.filter((method) => !existingNames.has(method.name));
    if (additions.length === 0) return `${existing}\n`;
    return `${existing}\n\n${additions.map((method) => method.source).join('\n\n')}\n`;
  }

  private static extractMethods(source: string): { name: string; source: string }[] {
    const lines = source.split(/\r?\n/);
    const methods: { name: string; source: string }[] = [];
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(/^\s{4}def\s+(\w+)\(/);
      if (!match) continue;
      const block = [lines[index]];
      index += 1;
      while (index < lines.length && (lines[index].startsWith('    ') || lines[index].trim() === '')) {
        if (/^\s{4}def\s+\w+\(/.test(lines[index])) {
          index -= 1;
          break;
        }
        block.push(lines[index]);
        index += 1;
      }
      methods.push({ name: match[1], source: block.join('\n').trimEnd() });
      index -= 1;
    }
    return methods;
  }
}
