/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 代码理解模块 - AI辅助代码语义理解
 *
 * 职责分工：
 * - CodeAnalyzer.ts        主流程、结构分析、技术栈、业务逻辑
 * - CodeAnalyzerDataFlow.ts 污点分析（sources / sinks / sanitizers / taintPaths）
 * - SecurityCodeAnalyzer.ts 安全风险规则检测 + sanitizer 工具
 * - QualityAnalyzer.ts      质量评分、复杂度、模式检测、重复代码
 */

import * as parser from '@babel/parser';
import traverseImport from '@babel/traverse';
const traverse =
  (traverseImport as unknown as {default?: typeof traverseImport}).default ??
  traverseImport;
import type * as t from '@babel/types';

import type {LLMService} from '../../services/LLMService.js';
import type {
  UnderstandCodeOptions,
  UnderstandCodeResult,
  CodeStructure,
  TechStack,
  BusinessLogic,
  DataFlow,
  SecurityRisk,
  FunctionInfo,
  ClassInfo,
  CallGraph,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import {
  analyzeDataFlowInternal,
  checkTaintedArguments as checkTaintedArgumentsImpl,
  enhanceTaintAnalysisWithLLM as enhanceTaintAnalysisWithLLMImpl,
} from './CodeAnalyzerDataFlow.js';
import {
  analyzeComplexityMetricsInternal,
  calculateCodeSimilarity as calculateCodeSimilarityImpl,
  calculateQualityScoreInternal,
  computeASTHash as computeASTHashImpl,
  detectCodePatternsInternal,
  detectDuplicateCodeInternal,
  normalizeCode as normalizeCodeImpl,
} from './QualityAnalyzer.js';
import {
  checkSanitizer as checkSanitizerImpl,
  getMemberExpressionName as getMemberExpressionNameImpl,
  identifySecurityRisksInternal,
} from './SecurityCodeAnalyzer.js';

export class CodeAnalyzer {
  private llm: LLMService;
  private lastParseResult:
    | {
        code: string;
        ast: t.File | null;
        error: unknown;
        warningLogged: boolean;
      }
    | undefined;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  // ── helpers that live here (use this) ─────────────────

  private stripHtmlWrappers(code: string): string {
    const htmlMarkers = ['<!DOCTYPE', '<html', '<head', '<body', '<script'];
    const isLikelyHtml = htmlMarkers.some(marker => {
      const idx = code.indexOf(marker);
      return idx >= 0 && idx < 200;
    });
    if (!isLikelyHtml) return code;

    const scriptBlocks: string[] = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(code)) !== null) {
      const content = match[1].trim();
      if (content.length > 0) scriptBlocks.push(content);
    }

    if (scriptBlocks.length > 0) {
      logger.info(`Stripped HTML wrapper, extracted ${scriptBlocks.length} <script> blocks`);
      return scriptBlocks.join('\n\n');
    }
    return code;
  }

  private parseCodeAst(code: string, warningMessage: string): t.File | null {
    if (this.lastParseResult?.code === code) {
      if (!this.lastParseResult.ast && !this.lastParseResult.warningLogged) {
        logger.warn(warningMessage, this.lastParseResult.error);
        this.lastParseResult.warningLogged = true;
      }
      return this.lastParseResult.ast;
    }

    const parseableCode = this.stripHtmlWrappers(code);

    try {
      const ast = parser.parse(parseableCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
      this.lastParseResult = {
        code,
        ast,
        error: null,
        warningLogged: false,
      };
      return ast;
    } catch (error) {
      this.lastParseResult = {
        code,
        ast: null,
        error,
        warningLogged: true,
      };
      logger.warn(warningMessage, error);
      return null;
    }
  }

  // ── public API ────────────────────────────────────────

  async understand(
    options: UnderstandCodeOptions,
  ): Promise<UnderstandCodeResult> {
    logger.info('Starting code understanding...');
    const startTime = Date.now();

    try {
      const {code, context, focus = 'all'} = options;
      const ast = this.parseCodeAst(code, 'Failed to parse code structure');

      const structure = await this.analyzeStructure(code, ast);
      logger.debug('Code structure analyzed');

      const aiAnalysis = await this.aiAnalyze(code, focus);
      logger.debug('AI analysis completed');

      const techStack = this.detectTechStack(code, aiAnalysis);
      logger.debug('Tech stack detected');

      const businessLogic = this.extractBusinessLogic(aiAnalysis, context);
      logger.debug('Business logic extracted');

      const dataFlow = await this.analyzeDataFlow(code, ast);
      logger.debug('Data flow analyzed');

      const securityRisks = this.identifySecurityRisks(code, aiAnalysis, ast);
      logger.debug('Security risks identified');

      const {patterns, antiPatterns} = this.detectCodePatterns(code, ast);
      logger.debug(
        `Detected ${patterns.length} patterns and ${antiPatterns.length} anti-patterns`,
      );

      const complexityMetrics = this.analyzeComplexityMetrics(code, ast);
      logger.debug('Complexity metrics calculated');

      const qualityScore = this.calculateQualityScore(
        structure,
        securityRisks,
        aiAnalysis,
        complexityMetrics,
        antiPatterns,
      );

      const duration = Date.now() - startTime;
      logger.success(`Code understanding completed in ${duration}ms`);

      return {
        structure,
        techStack,
        businessLogic,
        dataFlow,
        securityRisks,
        qualityScore,
        codePatterns: patterns,
        antiPatterns,
        complexityMetrics,
      };
    } catch (error) {
      logger.error('Code understanding failed', error);
      throw error;
    }
  }

  // ── structure ─────────────────────────────────────────

  private async analyzeStructure(
    code: string,
    ast: t.File | null = this.parseCodeAst(
      code,
      'Failed to parse code structure',
    ),
  ): Promise<CodeStructure> {
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];

    if (ast) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;

      traverse(ast, {
        FunctionDeclaration(path) {
          const node = path.node;
          functions.push({
            name: node.id?.name || 'anonymous',
            params: node.params.map(p =>
              p.type === 'Identifier' ? p.name : 'unknown',
            ),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        FunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'anonymous';

          if (
            parent.type === 'VariableDeclarator' &&
            parent.id.type === 'Identifier'
          ) {
            name = parent.id.name;
          } else if (
            parent.type === 'AssignmentExpression' &&
            parent.left.type === 'Identifier'
          ) {
            name = parent.left.name;
          }

          functions.push({
            name,
            params: node.params.map(p =>
              p.type === 'Identifier' ? p.name : 'unknown',
            ),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ArrowFunctionExpression(path) {
          const node = path.node;
          const parent = path.parent;
          let name = 'arrow';

          if (
            parent.type === 'VariableDeclarator' &&
            parent.id.type === 'Identifier'
          ) {
            name = parent.id.name;
          }

          functions.push({
            name,
            params: node.params.map(p =>
              p.type === 'Identifier' ? p.name : 'unknown',
            ),
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
            complexity: self.calculateComplexity(path),
          });
        },

        ClassDeclaration(path) {
          const node = path.node;
          const methods: FunctionInfo[] = [];
          const properties: ClassInfo['properties'] = [];

          path.traverse({
            ClassMethod(methodPath) {
              const method = methodPath.node;
              methods.push({
                name:
                  method.key.type === 'Identifier'
                    ? method.key.name
                    : 'unknown',
                params: method.params.map(p =>
                  p.type === 'Identifier' ? p.name : 'unknown',
                ),
                location: {
                  file: 'current',
                  line: method.loc?.start.line || 0,
                  column: method.loc?.start.column,
                },
                complexity: 1,
              });
            },
            ClassProperty(propertyPath) {
              const property = propertyPath.node;
              if (property.key.type === 'Identifier') {
                properties.push({
                  name: property.key.name,
                  type: undefined,
                  value: undefined,
                });
              }
            },
          });

          classes.push({
            name: node.id?.name || 'anonymous',
            methods,
            properties,
            location: {
              file: 'current',
              line: node.loc?.start.line || 0,
              column: node.loc?.start.column,
            },
          });
        },
      });
    }

    const modules = this.analyzeModules(code, ast);
    const callGraph = this.buildCallGraph(functions, code, ast);

    return {
      functions,
      classes,
      modules,
      callGraph,
    };
  }

  private analyzeModules(
    code: string,
    ast: t.File | null = this.parseCodeAst(code, 'Module analysis failed'),
  ): CodeStructure['modules'] {
    const modules: CodeStructure['modules'] = [];

    if (ast) {
      const imports: string[] = [];
      const exports: string[] = [];

      traverse(ast, {
        ImportDeclaration(path) {
          imports.push(path.node.source.value);
        },
        ExportNamedDeclaration(path) {
          if (path.node.source) {
            exports.push(path.node.source.value);
          }
        },
        ExportDefaultDeclaration() {
          exports.push('default');
        },
      });

      if (imports.length > 0 || exports.length > 0) {
        modules.push({
          name: 'current',
          imports,
          exports,
        });
      }
    }

    return modules;
  }

  private buildCallGraph(
    functions: FunctionInfo[],
    code: string,
    ast: t.File | null = this.parseCodeAst(
      code,
      'Call graph construction failed',
    ),
  ): CallGraph {
    const nodes: CallGraph['nodes'] = functions.map(fn => ({
      id: fn.name,
      name: fn.name,
      type: 'function' as const,
    }));

    const edges: CallGraph['edges'] = [];

    if (ast) {
      let currentFunction = '';

      traverse(ast, {
        FunctionDeclaration(path) {
          currentFunction = path.node.id?.name || '';
        },
        FunctionExpression(path) {
          const parent = path.parent;
          if (
            parent.type === 'VariableDeclarator' &&
            parent.id.type === 'Identifier'
          ) {
            currentFunction = parent.id.name;
          }
        },
        CallExpression(path) {
          if (currentFunction) {
            const callee = path.node.callee;
            let calledFunction = '';

            if (callee.type === 'Identifier') {
              calledFunction = callee.name;
            } else if (
              callee.type === 'MemberExpression' &&
              callee.property.type === 'Identifier'
            ) {
              calledFunction = callee.property.name;
            }

            if (
              calledFunction &&
              functions.some(f => f.name === calledFunction)
            ) {
              edges.push({
                from: currentFunction,
                to: calledFunction,
              });
            }
          }
        },
      });
    }

    return {nodes, edges};
  }

  private calculateComplexity(path: unknown): number {
    let complexity = 1;

    // 使用any类型绕过类型检查
    const anyPath = path as any;

    if (anyPath.traverse) {
      anyPath.traverse({
        IfStatement() {
          complexity++;
        },
        SwitchCase() {
          complexity++;
        },
        ForStatement() {
          complexity++;
        },
        WhileStatement() {
          complexity++;
        },
        DoWhileStatement() {
          complexity++;
        },
        ConditionalExpression() {
          complexity++;
        },
        LogicalExpression(logicalPath: any) {
          if (
            logicalPath.node.operator === '&&' ||
            logicalPath.node.operator === '||'
          ) {
            complexity++;
          }
        },
        CatchClause() {
          complexity++;
        },
      });
    }

    return complexity;
  }

  // ── AI ────────────────────────────────────────────────

  private async aiAnalyze(
    code: string,
    focus: string,
  ): Promise<Record<string, unknown>> {
    try {
      const messages = this.llm.generateCodeAnalysisPrompt(code, focus);
      const response = await this.llm.chat(messages, {
        temperature: 0.3,
        maxTokens: 2000,
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      }

      return {rawAnalysis: response.content};
    } catch (error) {
      logger.warn('AI analysis failed, using fallback', error);
      return {};
    }
  }

  private detectTechStack(
    code: string,
    aiAnalysis: Record<string, unknown>,
  ): TechStack {
    const techStack: TechStack = {
      other: [],
    };

    if (aiAnalysis.techStack && typeof aiAnalysis.techStack === 'object') {
      const ts = aiAnalysis.techStack as Record<string, unknown>;
      techStack.framework = ts.framework as string | undefined;
      techStack.bundler = ts.bundler as string | undefined;
      if (Array.isArray(ts.libraries)) {
        techStack.other = ts.libraries as string[];
      }
    }

    if (
      code.includes('React.') ||
      code.includes('useState') ||
      code.includes('useEffect')
    ) {
      techStack.framework = 'React';
    } else if (code.includes('Vue.') || code.includes('createApp')) {
      techStack.framework = 'Vue';
    } else if (code.includes('@angular/')) {
      techStack.framework = 'Angular';
    }

    if (code.includes('__webpack_require__')) {
      techStack.bundler = 'Webpack';
    }

    const cryptoLibs: string[] = [];
    if (code.includes('CryptoJS')) cryptoLibs.push('CryptoJS');
    if (code.includes('JSEncrypt')) cryptoLibs.push('JSEncrypt');
    if (code.includes('crypto-js')) cryptoLibs.push('crypto-js');
    if (cryptoLibs.length > 0) {
      techStack.cryptoLibrary = cryptoLibs;
    }

    return techStack;
  }

  private extractBusinessLogic(
    aiAnalysis: Record<string, unknown>,
    context?: Record<string, unknown>,
  ): BusinessLogic {
    const businessLogic: BusinessLogic = {
      mainFeatures: [],
      entities: [],
      rules: [],
      dataModel: {},
    };

    if (
      aiAnalysis.businessLogic &&
      typeof aiAnalysis.businessLogic === 'object'
    ) {
      const bl = aiAnalysis.businessLogic as Record<string, unknown>;
      if (Array.isArray(bl.mainFeatures)) {
        businessLogic.mainFeatures = bl.mainFeatures as string[];
      }
      if (typeof bl.dataFlow === 'string') {
        businessLogic.rules.push(bl.dataFlow);
      }
    }

    if (context) {
      businessLogic.dataModel = {...businessLogic.dataModel, ...context};
    }

    return businessLogic;
  }

  // ── delegates: data flow ──────────────────────────────

  private async analyzeDataFlow(
    code: string,
    ast: t.File | null = this.parseCodeAst(code, 'Data flow analysis failed'),
  ): Promise<DataFlow> {
    const result = analyzeDataFlowInternal(code, ast);

    if (result.taintPaths.length > 0 && this.llm) {
      try {
        await enhanceTaintAnalysisWithLLMImpl(
          this.llm as any,
          code,
          result.sources,
          result.sinks,
          result.taintPaths,
        );
      } catch (error) {
        logger.warn('LLM-enhanced taint analysis failed', error);
      }
    }

    return result;
  }

  private checkTaintedArguments(
    args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder>,
    taintMap: Map<string, {sourceType: string; sourceLine: number}>,
    taintPaths: DataFlow['taintPaths'],
    _funcName: string,
    line: number,
  ): void {
    checkTaintedArgumentsImpl(args, taintMap, taintPaths, _funcName, line);
  }

  private async enhanceTaintAnalysisWithLLM(
    code: string,
    sources: DataFlow['sources'],
    sinks: DataFlow['sinks'],
    taintPaths: DataFlow['taintPaths'],
  ): Promise<void> {
    await enhanceTaintAnalysisWithLLMImpl(
      this.llm as any,
      code,
      sources,
      sinks,
      taintPaths,
    );
  }

  // ── delegates: security ───────────────────────────────

  private checkSanitizer(
    node: t.CallExpression,
    sanitizers: Set<string>,
  ): boolean {
    return checkSanitizerImpl(node, sanitizers);
  }

  private getMemberExpressionName(node: t.MemberExpression): string {
    return getMemberExpressionNameImpl(node);
  }

  private identifySecurityRisks(
    code: string,
    aiAnalysis: Record<string, unknown>,
    ast: t.File | null = this.parseCodeAst(
      code,
      'Static security analysis failed',
    ),
  ): SecurityRisk[] {
    return identifySecurityRisksInternal(code, aiAnalysis, ast);
  }

  // ── delegates: quality ────────────────────────────────

  private calculateQualityScore(
    structure: CodeStructure,
    securityRisks: SecurityRisk[],
    aiAnalysis: Record<string, unknown>,
    complexityMetrics?: {
      cyclomaticComplexity: number;
      cognitiveComplexity: number;
      maintainabilityIndex: number;
    },
    antiPatterns?: Array<{severity: string}>,
  ): number {
    return calculateQualityScoreInternal(
      structure,
      securityRisks,
      aiAnalysis,
      complexityMetrics,
      antiPatterns,
    );
  }

  private detectCodePatterns(
    code: string,
    ast: t.File | null = this.parseCodeAst(
      code,
      'Code pattern detection failed',
    ),
  ): {
    patterns: Array<{name: string; location: number; description: string}>;
    antiPatterns: Array<{
      name: string;
      location: number;
      severity: string;
      recommendation: string;
    }>;
  } {
    return detectCodePatternsInternal(code, ast);
  }

  private analyzeComplexityMetrics(
    code: string,
    ast: t.File | null = this.parseCodeAst(
      code,
      'Complexity metrics calculation failed',
    ),
  ): {
    cyclomaticComplexity: number;
    cognitiveComplexity: number;
    maintainabilityIndex: number;
    halsteadMetrics: {
      vocabulary: number;
      length: number;
      difficulty: number;
      effort: number;
    };
  } {
    return analyzeComplexityMetricsInternal(code, ast);
  }

  private detectDuplicateCode(ast: t.File): Array<{
    location: number;
    duplicateLocation: number;
    similarity: number;
  }> {
    return detectDuplicateCodeInternal(ast);
  }

  private computeASTHash(node: t.Node): string {
    return computeASTHashImpl(node);
  }

  private normalizeCode(node: t.Node): string {
    return normalizeCodeImpl(node);
  }

  private calculateCodeSimilarity(code1: string, code2: string): number {
    return calculateCodeSimilarityImpl(code1, code2);
  }
}
