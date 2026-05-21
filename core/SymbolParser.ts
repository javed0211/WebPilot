import * as ts from 'typescript';
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
  bodyCode?: string; // Optional custom body statements
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
 * SymbolParser
 * Extracts classes, properties, methods, and JSDoc metadata from TS page object files.
 */
export class SymbolParser {
  private static getJSDocMetadata(node: ts.Node, sourceFile: ts.SourceFile): { pageIdentity?: string; urlPattern?: string } {
    const meta: { pageIdentity?: string; urlPattern?: string } = {};

    // 1. Try ts.getJSDocTags (Standard Compiler API)
    try {
      const tags = ts.getJSDocTags(node);
      for (const tag of tags) {
        const tagName = tag.tagName.text;
        let commentText = '';
        if (typeof tag.comment === 'string') {
          commentText = tag.comment;
        } else if (Array.isArray(tag.comment)) {
          commentText = tag.comment.map((c: any) => c.text).join('');
        }

        if (tagName === 'pageIdentity') {
          meta.pageIdentity = commentText.trim();
        } else if (tagName === 'urlPattern') {
          meta.urlPattern = commentText.trim();
        }
      }
    } catch {
      // Fallback if getJSDocTags fails
    }

    // 2. Regex Fallback: parse comments directly from node ranges
    if (!meta.pageIdentity || !meta.urlPattern) {
      const sourceText = sourceFile.text;
      const leadingComments = ts.getLeadingCommentRanges(sourceText, node.pos);
      if (leadingComments) {
        for (const range of leadingComments) {
          const commentText = sourceText.substring(range.pos, range.end);
          const identityMatch = commentText.match(/@pageIdentity\s+([^\s\n\r]+)/);
          const urlMatch = commentText.match(/@urlPattern\s+([^\n\r]+)/);

          if (identityMatch && !meta.pageIdentity) {
            meta.pageIdentity = identityMatch[1].trim();
          }
          if (urlMatch && !meta.urlPattern) {
            meta.urlPattern = urlMatch[1].trim();
          }
        }
      }
    }

    return meta;
  }

  public static parseFile(filePath: string): ClassSymbolInfo[] {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    const classes: ClassSymbolInfo[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        let extendsClass: string | undefined;

        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              const types = clause.types;
              if (types.length > 0) {
                extendsClass = types[0].expression.getText(sourceFile);
              }
            }
          }
        }

        const meta = SymbolParser.getJSDocMetadata(node, sourceFile);
        const properties: PropertyInfo[] = [];
        const methods: MethodInfo[] = [];

        node.members.forEach((member) => {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const propName = member.name.getText(sourceFile);
            const propType = member.type ? member.type.getText(sourceFile) : 'any';
            let value: string | undefined;
            if (member.initializer) {
              value = member.initializer.getText(sourceFile);
            }
            properties.push({ name: propName, type: propType, value });
          } else if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            const parameters = member.parameters.map((p) => ({
              name: p.name.getText(sourceFile),
              type: p.type ? p.type.getText(sourceFile) : 'any',
            }));
            const returnType = member.type ? member.type.getText(sourceFile) : 'Promise<void>';
            methods.push({ name: methodName, parameters, returnType });
          }
        });

        classes.push({
          name: className,
          extendsClass,
          pageIdentity: meta.pageIdentity,
          urlPattern: meta.urlPattern,
          filePath,
          properties,
          methods,
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return classes;
  }

  private static collectPageFiles(directoryPath: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(directoryPath)) {
      return results;
    }
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const fullPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...SymbolParser.collectPageFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && entry.name !== 'BasePage.ts') {
        results.push(fullPath);
      }
    }
    return results;
  }

  public static generateGraph(directoryPath: string): SymbolGraph {
    const classes: ClassSymbolInfo[] = [];
    const files = SymbolParser.collectPageFiles(directoryPath);
    files.forEach((fullPath) => {
      try {
        const info = SymbolParser.parseFile(fullPath);
        classes.push(...info);
      } catch (err) {
        console.error(`[SymbolParser] Error parsing ${fullPath}:`, err);
      }
    });

    return {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      classes,
    };
  }

  public static saveGraph(graph: SymbolGraph, outputPath: string): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2), 'utf8');
  }

  public static loadGraph(inputPath: string): SymbolGraph {
    if (!fs.existsSync(inputPath)) {
      return { version: '1.0.0', lastUpdated: new Date().toISOString(), classes: [] };
    }
    return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  }
}

/**
 * SymbolGraphQuery
 * Provides filtering and matching helpers to resolve POMs.
 */
export class SymbolGraphQuery {
  private graph: SymbolGraph;

  constructor(graph: SymbolGraph) {
    this.graph = graph;
  }

  public findPageByUrl(url: string): ClassSymbolInfo | undefined {
    return this.graph.classes.find((c) => {
      if (!c.urlPattern) return false;
      try {
        const regex = new RegExp(c.urlPattern);
        return regex.test(url);
      } catch {
        return url.includes(c.urlPattern);
      }
    });
  }

  public findPageByIdentity(identity: string): ClassSymbolInfo | undefined {
    return this.graph.classes.find((c) => c.pageIdentity === identity);
  }

  public getSymbolsForPrompt(classNames: string[]): Partial<SymbolGraph> {
    const filteredClasses = this.graph.classes.filter((c) => classNames.includes(c.name));
    return {
      version: this.graph.version,
      classes: filteredClasses.map((c) => ({
        name: c.name,
        extendsClass: c.extendsClass,
        pageIdentity: c.pageIdentity,
        urlPattern: c.urlPattern,
        filePath: path.basename(c.filePath),
        properties: c.properties,
        methods: c.methods,
      })),
    };
  }
}

/**
 * ASTMerger
 * Uses the TypeScript AST Compiler API to safely extend existing Page Object classes.
 */
export class ASTMerger {
  public static mergeClass(
    filePath: string,
    newProperties: PropertyInfo[],
    newMethods: MethodInfo[]
  ): string {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true);

    const transformer = (context: ts.TransformationContext) => {
      return (rootNode: ts.SourceFile) => {
        const visit = (node: ts.Node): ts.Node => {
          if (ts.isClassDeclaration(node)) {
            // Find existing members
            const existingPropNames = new Set(
              node.members
                .filter(ts.isPropertyDeclaration)
                .map((m) => m.name.getText(sourceFile))
            );
            const existingMethodNames = new Set(
              node.members
                .filter(ts.isMethodDeclaration)
                .map((m) => m.name.getText(sourceFile))
            );

            // Construct new property declarations
            const propertyNodes = newProperties
              .filter((p) => !existingPropNames.has(p.name))
              .map((p) => {
                const initializer = p.value
                  ? ts.factory.createStringLiteral(p.value.replace(/['"]/g, ''))
                  : undefined;
                return ts.factory.createPropertyDeclaration(
                  [
                    ts.factory.createModifier(ts.SyntaxKind.PrivateKeyword),
                    ts.factory.createModifier(ts.SyntaxKind.ReadonlyKeyword),
                  ],
                  p.name,
                  undefined,
                  ts.factory.createTypeReferenceNode(p.type || 'string', undefined),
                  initializer
                );
              });

            // Construct new method declarations
            const methodNodes = newMethods
              .filter((m) => !existingMethodNames.has(m.name))
              .map((m) => {
                let bodyStatements: ts.Statement[] = [];
                if (m.bodyCode) {
                  const tempFile = ts.createSourceFile('tempBody.ts', m.bodyCode, ts.ScriptTarget.Latest, true);
                  bodyStatements = [...tempFile.statements];
                }

                const params = m.parameters.map((p) =>
                  ts.factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    p.name,
                    undefined,
                    ts.factory.createTypeReferenceNode(p.type || 'string', undefined),
                    undefined
                  )
                );

                return ts.factory.createMethodDeclaration(
                  [
                    ts.factory.createModifier(ts.SyntaxKind.PublicKeyword),
                    ts.factory.createModifier(ts.SyntaxKind.AsyncKeyword),
                  ],
                  undefined,
                  m.name,
                  undefined,
                  undefined,
                  params,
                  ts.factory.createTypeReferenceNode(m.returnType || 'Promise<void>', undefined),
                  ts.factory.createBlock(bodyStatements, true)
                );
              });

            return ts.factory.updateClassDeclaration(
              node,
              node.modifiers,
              node.name,
              node.typeParameters,
              node.heritageClauses,
              [...node.members, ...propertyNodes, ...methodNodes]
            );
          }
          return ts.visitEachChild(node, visit, context);
        };
        return ts.visitNode(rootNode, visit) as ts.SourceFile;
      };
    };

    const result = ts.transform(sourceFile, [transformer]);
    const printer = ts.createPrinter();
    const updatedSourceFile = result.transformed[0];
    return printer.printFile(updatedSourceFile);
  }

  /**
   * Parses newClassContent, extracts non-duplicate members, and merges them into an existing class file.
   */
  public static mergeClassContent(filePath: string, newClassContent: string): string {
    const newSourceFile = ts.createSourceFile(
      'temp.ts',
      newClassContent,
      ts.ScriptTarget.Latest,
      true
    );

    const properties: PropertyInfo[] = [];
    const methods: MethodInfo[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        node.members.forEach((member) => {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const name = member.name.getText(newSourceFile);
            const type = member.type ? member.type.getText(newSourceFile) : 'string';
            const value = member.initializer ? member.initializer.getText(newSourceFile) : undefined;
            properties.push({ name, type, value });
          } else if (ts.isMethodDeclaration(member) && member.name) {
            const name = member.name.getText(newSourceFile);
            const parameters = member.parameters.map((p) => ({
              name: p.name.getText(newSourceFile),
              type: p.type ? p.type.getText(newSourceFile) : 'string',
            }));
            const returnType = member.type ? member.type.getText(newSourceFile) : 'Promise<void>';
            
            let bodyCode: string | undefined;
            if (member.body) {
              const fullBodyText = member.body.getText(newSourceFile);
              // Strip outer braces
              bodyCode = fullBodyText.substring(1, fullBodyText.length - 1).trim();
            }
            methods.push({ name, parameters, returnType, bodyCode });
          }
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(newSourceFile);
    return ASTMerger.mergeClass(filePath, properties, methods);
  }
}
