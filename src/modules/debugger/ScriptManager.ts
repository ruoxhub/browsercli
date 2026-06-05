/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 脚本管理器 - 薄封装 CDP Debugger 域
 *
 * 功能:
 * - 获取页面所有已加载的脚本列表
 * - 获取指定脚本的完整源码
 * - 监听脚本加载事件
 *
 * 设计原则:
 * - 薄封装 CDP Debugger.scriptParsed 事件和 Debugger.getScriptSource 方法
 * - 依赖 CodeCollector 获取 Page 实例
 */

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';
import type {CodeCollector} from '../collector/CodeCollector.js';

export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sourceLength?: number;
  source?: string;
}

interface ScriptChunk {
  scriptId: string;
  chunkIndex: number;
  content: string;
  size: number;
}

interface KeywordIndexEntry {
  scriptId: string;
  url: string;
  line: number;
  column: number;
  context: string;
}

interface ScriptParsedEvent {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  length?: number;
}

interface SearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
}

interface SearchMatch {
  scriptId: string;
  url: string;
  line: number;
  column: number;
  matchText: string;
  context: string;
}

interface SearchResult {
  keyword: string;
  totalMatches: number;
  matches: SearchMatch[];
  searchMethod?: 'indexed' | 'regex';
}

const CHUNK_SIZE = 100 * 1024;
const KEYWORD_REGEX = /\b[a-zA-Z_$][a-zA-Z0-9_$]{2,}\b/g;
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;
const INIT_STABLE_ROUNDS = 3;
const INIT_POLL_INTERVAL_MS = 200;
const INIT_MAX_WAIT_MS = 5000;
const KEYWORD_CONTEXT_LINES = 3;
const MAX_HISTORY_LENGTH = 100;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_SCRIPTS = 1000;

export class ScriptManager {
  private cdpSession: CDPSession | null = null;
  private scripts = new Map<string, ScriptInfo>();
  private scriptsByUrl = new Map<string, ScriptInfo[]>();
  private initialized = false;

  private keywordIndex = new Map<string, KeywordIndexEntry[]>();
  private scriptChunks = new Map<string, ScriptChunk[]>();

  private scriptParsedListener: ((params: ScriptParsedEvent) => void) | null = null;

  constructor(private collector: CodeCollector) {}

  async init(): Promise<void> {
    if (this.initialized) {
      logger.warn('ScriptManager already initialized');
      return;
    }

    const page = await this.collector.getActivePage();
    this.cdpSession = await page.context().newCDPSession(page);
    await this.cdpSession.send('Debugger.enable');

    this.scriptParsedListener = params => this.handleScriptParsed(params);
    this.cdpSession.on('Debugger.scriptParsed', this.scriptParsedListener);

    await this.waitForScriptsToStabilize();
    this.initialized = true;
    logger.info(
      `ScriptManager initialized, collected ${this.scripts.size} scripts`,
    );
  }

  private handleScriptParsed(params: ScriptParsedEvent): void {
    const scriptInfo: ScriptInfo = {
      scriptId: params.scriptId,
      url: params.url,
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      sourceLength: params.length,
    };

    this.scripts.set(params.scriptId, scriptInfo);

    if (params.url) {
      const existing = this.scriptsByUrl.get(params.url) ?? [];
      existing.push(scriptInfo);
      this.scriptsByUrl.set(params.url, existing);
    }

    logger.debug(
      `Script parsed: ${params.url || 'inline'} (${params.scriptId})`,
    );
  }

  /**
   * 等待脚本解析事件稳定(替代硬编码延迟)
   * 当启用 Debugger 域时,CDP 会重新触发所有已解析脚本的事件。
   * 通过轮询检测脚本数量是否稳定来判断事件是否完成。
   */
  private async waitForScriptsToStabilize(): Promise<void> {
    let lastCount = 0;
    let stableRounds = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < INIT_MAX_WAIT_MS) {
      await this.delay(INIT_POLL_INTERVAL_MS);
      const currentCount = this.scripts.size;
      if (currentCount === lastCount && currentCount > 0) {
        stableRounds++;
        if (stableRounds >= INIT_STABLE_ROUNDS) return;
      } else {
        stableRounds = 0;
      }
      lastCount = currentCount;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** enable 是 init 的别名,与其他模块保持一致 */
  async enable(): Promise<void> {
    return this.init();
  }

  /**
   * 获取所有已加载的脚本列表
   *
   * 警告:如果 includeSource=true,会一次性加载所有脚本源码,可能导致内存溢出。
   * 建议:对于大型网站,使用 getScriptSource() 按需加载单个脚本。
   *
   * @param includeSource 是否包含源码(默认 false,推荐 false)
   * @param maxScripts 最大脚本数量限制(默认 1000,防止内存溢出)
   */
  async getAllScripts(
    includeSource = false,
    maxScripts = DEFAULT_MAX_SCRIPTS,
  ): Promise<ScriptInfo[]> {
    if (!this.cdpSession) {
      await this.init();
    }

    const scripts = Array.from(this.scripts.values());

    if (scripts.length > maxScripts) {
      logger.warn(
        `Found ${scripts.length} scripts, limiting to ${maxScripts}. Increase maxScripts parameter if needed.`,
      );
    }

    const limitedScripts = scripts.slice(0, maxScripts);

    if (includeSource) {
      await this.loadSourcesForScripts(limitedScripts);
    } else {
      logger.info(
        `getAllScripts: ${limitedScripts.length} scripts (source not included)`,
      );
    }

    return limitedScripts;
  }

  private async loadSourcesForScripts(scripts: ScriptInfo[]): Promise<void> {
    const session = this.cdpSession!;
    logger.warn(
      `Loading source code for ${scripts.length} scripts. This may use significant memory.`,
    );

    let loadedCount = 0;
    let failedCount = 0;

    for (const script of scripts) {
      if (script.source) continue;
      try {
        const {scriptSource} = await session.send('Debugger.getScriptSource', {
          scriptId: script.scriptId,
        });
        script.source = scriptSource;
        loadedCount++;
        if (loadedCount % 10 === 0) {
          logger.debug(
            `Loaded ${loadedCount}/${scripts.length} scripts...`,
          );
        }
      } catch (error) {
        logger.warn(
          `Failed to get source for script ${script.scriptId}:`,
          error,
        );
        failedCount++;
      }
    }

    logger.info(
      `getAllScripts: ${scripts.length} scripts (loaded: ${loadedCount}, failed: ${failedCount})`,
    );
  }

  async getScriptSource(
    scriptId?: string,
    url?: string,
  ): Promise<ScriptInfo | null> {
    if (!scriptId && !url) {
      throw new Error('Either scriptId or url parameter must be provided');
    }

    if (!this.cdpSession) {
      await this.init();
    }

    const targetScript = this.findScript(scriptId, url);
    if (!targetScript) {
      logger.warn(`Script not found: ${scriptId || url}`);
      return null;
    }

    if (!targetScript.source) {
      const loaded = await this.loadScriptSource(targetScript);
      if (!loaded) return null;
    }

    logger.info(
      `getScriptSource: ${targetScript.url || 'inline'} (${targetScript.sourceLength} bytes)`,
    );
    return targetScript;
  }

  private findScript(
    scriptId: string | undefined,
    url: string | undefined,
  ): ScriptInfo | undefined {
    if (scriptId) {
      return this.scripts.get(scriptId);
    }
    if (!url) return undefined;

    const urlPattern = url.replace(/\*/g, '.*');
    let regex: RegExp;
    try {
      regex = new RegExp(urlPattern);
    } catch (error) {
      logger.error(`Invalid URL pattern: ${url}`, error);
      return undefined;
    }

    for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
      if (regex.test(scriptUrl)) {
        return scripts[0];
      }
    }
    return undefined;
  }

  private async loadScriptSource(script: ScriptInfo): Promise<boolean> {
    const session = this.cdpSession!;
    try {
      const {scriptSource} = await session.send('Debugger.getScriptSource', {
        scriptId: script.scriptId,
      });
      script.source = scriptSource;
      script.sourceLength = scriptSource.length;

      this.buildKeywordIndex(script.scriptId, script.url, scriptSource);
      this.chunkScript(script.scriptId, scriptSource);
      return true;
    } catch (error) {
      logger.error(
        `Failed to get script source for ${script.scriptId}:`,
        error,
      );
      return false;
    }
  }

  async findScriptsByUrl(urlPattern: string): Promise<ScriptInfo[]> {
    if (!this.cdpSession) {
      await this.init();
    }

    const pattern = urlPattern.replace(/\*/g, '.*');
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      logger.error(`Invalid URL pattern: ${urlPattern}`, error);
      return [];
    }

    const results: ScriptInfo[] = [];
    for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
      if (regex.test(scriptUrl)) {
        results.push(...scripts);
      }
    }

    logger.info(
      `findScriptsByUrl: ${urlPattern} - found ${results.length} scripts`,
    );
    return results;
  }

  /** 已废弃,使用 clear() 代替 */
  clearCache(): void {
    this.clear();
  }

  async searchInScripts(
    keyword: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    if (!this.cdpSession) {
      await this.init();
    }

    const {
      isRegex = false,
      caseSensitive = false,
      contextLines = DEFAULT_CONTEXT_LINES,
      maxMatches = DEFAULT_MAX_MATCHES,
    } = options;

    const searchRegex = this.compileSearchRegex(keyword, isRegex, caseSensitive);
    if (!searchRegex) {
      return {keyword, totalMatches: 0, matches: []};
    }

    const matches: SearchMatch[] = [];
    const scriptList = await this.getAllScripts(false);
    logger.info(`Searching in ${scriptList.length} scripts...`);

    for (const scriptInfo of scriptList) {
      if (matches.length >= maxMatches) break;

      const script = await this.getScriptSource(scriptInfo.scriptId);
      if (!script || !script.source) continue;

      this.collectMatchesInScript(
        script,
        searchRegex,
        contextLines,
        maxMatches,
        matches,
      );
    }

    logger.info(
      `searchInScripts: "${keyword}" - found ${matches.length} matches`,
    );

    return {keyword, totalMatches: matches.length, matches};
  }

  private compileSearchRegex(
    keyword: string,
    isRegex: boolean,
    caseSensitive: boolean,
  ): RegExp | null {
    const flags = caseSensitive ? 'g' : 'gi';
    try {
      return isRegex
        ? new RegExp(keyword, flags)
        : new RegExp(keyword.replace(REGEX_SPECIAL_CHARS, '\\$&'), flags);
    } catch (error) {
      logger.error(`Invalid search pattern: ${keyword}`, error);
      return null;
    }
  }

  private collectMatchesInScript(
    script: ScriptInfo,
    searchRegex: RegExp,
    contextLines: number,
    maxMatches: number,
    matches: SearchMatch[],
  ): void {
    const lines = script.source!.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) return;

      const line = lines[i];
      if (!line) continue;

      const lineMatches = Array.from(line.matchAll(searchRegex));
      for (const match of lineMatches) {
        if (matches.length >= maxMatches) return;

        const startLine = Math.max(0, i - contextLines);
        const endLine = Math.min(lines.length - 1, i + contextLines);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        matches.push({
          scriptId: script.scriptId,
          url: script.url || 'inline',
          line: i + 1,
          column: match.index || 0,
          matchText: match[0],
          context,
        });
      }
    }
  }

  /**
   * 提取函数及其依赖树
   *
   * 注意:此方法需要 Babel 依赖。如果 Babel 未安装,将抛出错误。
   */
  async extractFunctionTree(
    scriptId: string,
    functionName: string,
    options: {
      maxDepth?: number;
      maxSize?: number; // KB
      includeComments?: boolean;
    } = {},
  ): Promise<{
    mainFunction: string;
    code: string;
    functions: Array<{
      name: string;
      code: string;
      dependencies: string[];
      startLine: number;
      endLine: number;
      size: number;
    }>;
    callGraph: Record<string, string[]>;
    totalSize: number;
    extractedCount: number;
  }> {
    const {maxDepth = 3, maxSize = 500, includeComments = true} = options;

    const script = await this.getScriptSource(scriptId);
    if (!script || !script.source) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const babel = await this.loadBabel();
    const ast = this.parseScriptWithBabel(babel, script.source, scriptId);

    const {allFunctions, callGraph} = this.collectFunctions(
      babel,
      ast,
      includeComments,
    );

    const extracted = this.collectDependenciesByLevel(
      allFunctions,
      functionName,
      maxDepth,
    );

    const functions = Array.from(extracted)
      .map(name => allFunctions.get(name)!)
      .filter(Boolean);

    const code = functions.map(f => f.code).join('\n\n');
    const totalSize = code.length;

    if (totalSize > maxSize * 1024) {
      logger.warn(
        `Extracted code size (${(totalSize / 1024).toFixed(2)}KB) exceeds limit (${maxSize}KB)`,
      );
    }

    logger.info(
      `extractFunctionTree: ${functionName} - extracted ${functions.length} functions (${(totalSize / 1024).toFixed(2)}KB)`,
    );

    return {
      mainFunction: functionName,
      code,
      functions,
      callGraph,
      totalSize,
      extractedCount: functions.length,
    };
  }

  private async loadBabel(): Promise<{
    parser: any;
    traverse: any;
    generate: any;
    t: any;
  }> {
    try {
      const parser = await import('@babel/parser');
      const traverse = (await import('@babel/traverse')).default;
      const generate = (await import('@babel/generator')).default;
      const t = await import('@babel/types');
      return {parser, traverse, generate, t};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load Babel dependencies. Please install: npm install @babel/parser @babel/traverse @babel/generator @babel/types\nError: ${message}`,
      );
    }
  }

  private parseScriptWithBabel(
    babel: {parser: any},
    source: string,
    scriptId: string,
  ): unknown {
    try {
      return babel.parser.parse(source, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse script ${scriptId}: ${message}`);
    }
  }

  private collectFunctions(
    babel: {traverse: any; generate: any; t: any},
    ast: unknown,
    includeComments: boolean,
  ): {
    allFunctions: Map<
      string,
      {
        name: string;
        code: string;
        dependencies: string[];
        startLine: number;
        endLine: number;
        size: number;
      }
    >;
    callGraph: Record<string, string[]>;
  } {
    const allFunctions = new Map<
      string,
      {
        name: string;
        code: string;
        dependencies: string[];
        startLine: number;
        endLine: number;
        size: number;
      }
    >();
    const callGraph: Record<string, string[]> = {};

    const extractDependencies = (path: any): string[] => {
      const deps = new Set<string>();
      path.traverse({
        CallExpression(callPath: any) {
          if (babel.t.isIdentifier(callPath.node.callee)) {
            deps.add(callPath.node.callee.name);
          }
        },
      });
      return Array.from(deps);
    };

    babel.traverse(ast, {
      FunctionDeclaration(path: any) {
        const name = path.node.id?.name;
        if (!name) return;

        const funcCode = babel.generate(path.node, {
          comments: includeComments,
        }).code;
        const deps = extractDependencies(path);

        allFunctions.set(name, {
          name,
          code: funcCode,
          startLine: path.node.loc?.start.line || 0,
          endLine: path.node.loc?.end.line || 0,
          dependencies: deps,
          size: funcCode.length,
        });
        callGraph[name] = deps;
      },
      VariableDeclarator(path: any) {
        if (
          babel.t.isIdentifier(path.node.id) &&
          (babel.t.isFunctionExpression(path.node.init) ||
            babel.t.isArrowFunctionExpression(path.node.init))
        ) {
          const name = path.node.id.name;
          const funcCode = babel.generate(path.node, {
            comments: includeComments,
          }).code;
          const deps = extractDependencies(path);

          allFunctions.set(name, {
            name,
            code: funcCode,
            startLine: path.node.loc?.start.line || 0,
            endLine: path.node.loc?.end.line || 0,
            dependencies: deps,
            size: funcCode.length,
          });
          callGraph[name] = deps;
        }
      },
    });

    return {allFunctions, callGraph};
  }

  private collectDependenciesByLevel(
    allFunctions: Map<string, {dependencies: string[]}>,
    functionName: string,
    maxDepth: number,
  ): Set<string> {
    const extracted = new Set<string>();
    let currentLevel = [functionName];
    let currentDepth = 0;

    while (currentLevel.length > 0 && currentDepth < maxDepth) {
      const nextLevel: string[] = [];

      for (const current of currentLevel) {
        if (extracted.has(current)) continue;
        const func = allFunctions.get(current);
        if (!func) continue;

        extracted.add(current);
        for (const dep of func.dependencies) {
          if (!extracted.has(dep) && allFunctions.has(dep)) {
            nextLevel.push(dep);
          }
        }
      }

      currentLevel = nextLevel;
      currentDepth++;
    }

    return extracted;
  }

  /** 清除所有数据(换网站时调用) */
  clear(): void {
    this.scripts.clear();
    this.scriptsByUrl.clear();
    this.keywordIndex.clear();
    this.scriptChunks.clear();
    logger.info('ScriptManager cleared - ready for new website');
  }

  async close(): Promise<void> {
    this.clear();

    if (this.cdpSession && this.scriptParsedListener) {
      try {
        this.cdpSession.off('Debugger.scriptParsed', this.scriptParsedListener);
        logger.debug('Event listener removed');
      } catch (error) {
        logger.warn('Failed to remove event listener:', error);
      }
      this.scriptParsedListener = null;
    }

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Debugger.disable');
        await this.cdpSession.detach();
        logger.info('CDP session closed');
      } catch (error) {
        logger.warn('Failed to close CDP session:', error);
      }
      this.cdpSession = null;
    }

    this.initialized = false;
    logger.info('ScriptManager closed');
  }

  getStats(): {
    totalScripts: number;
    totalUrls: number;
    indexedKeywords: number;
    totalChunks: number;
  } {
    let totalChunks = 0;
    for (const chunks of this.scriptChunks.values()) {
      totalChunks += chunks.length;
    }

    return {
      totalScripts: this.scripts.size,
      totalUrls: this.scriptsByUrl.size,
      indexedKeywords: this.keywordIndex.size,
      totalChunks,
    };
  }

  /** 建立关键词索引(在获取脚本源码时自动调用) */
  private buildKeywordIndex(
    scriptId: string,
    url: string,
    content: string,
  ): void {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const matches = Array.from(line.matchAll(KEYWORD_REGEX));
      for (const match of matches) {
        const keyword = match[0].toLowerCase();
        const startLine = Math.max(0, i - KEYWORD_CONTEXT_LINES);
        const endLine = Math.min(lines.length - 1, i + KEYWORD_CONTEXT_LINES);
        const context = lines.slice(startLine, endLine + 1).join('\n');

        const entry: KeywordIndexEntry = {
          scriptId,
          url,
          line: i + 1,
          column: match.index || 0,
          context,
        };

        const existing = this.keywordIndex.get(keyword) ?? [];
        existing.push(entry);
        this.keywordIndex.set(keyword, existing);
      }
    }

    logger.debug(`Indexed ${this.keywordIndex.size} keywords for ${url}`);
  }

  /** 分片存储脚本(在获取脚本源码时自动调用) */
  private chunkScript(scriptId: string, content: string): void {
    const chunks: ScriptChunk[] = [];
    let offset = 0;
    let chunkIndex = 0;

    while (offset < content.length) {
      const chunk = content.substring(offset, offset + CHUNK_SIZE);
      chunks.push({
        scriptId,
        chunkIndex,
        content: chunk,
        size: chunk.length,
      });
      offset += CHUNK_SIZE;
      chunkIndex++;
    }

    this.scriptChunks.set(scriptId, chunks);
    logger.debug(`Chunked script ${scriptId} into ${chunks.length} chunks`);
  }

  getScriptChunk(scriptId: string, chunkIndex: number): string | null {
    const chunks = this.scriptChunks.get(scriptId);
    if (!chunks || chunkIndex >= chunks.length) {
      return null;
    }
    const chunk = chunks[chunkIndex];
    return chunk ? chunk.content : null;
  }

  /**
   * 增强的搜索(使用内存索引,避免重复加载脚本源码)
   */
  async searchInScriptsEnhanced(
    keyword: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const {isRegex = false, caseSensitive = false, maxMatches = DEFAULT_MAX_MATCHES} =
      options;

    if (isRegex) {
      const result = await this.searchInScripts(keyword, options);
      return {...result, searchMethod: 'regex'};
    }

    const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
    const matches: SearchMatch[] = [];

    for (const [indexedKeyword, entries] of this.keywordIndex.entries()) {
      if (!indexedKeyword.includes(searchTerm)) continue;

      for (const entry of entries) {
        matches.push({
          scriptId: entry.scriptId,
          url: entry.url,
          line: entry.line,
          column: entry.column,
          matchText: indexedKeyword,
          context: entry.context,
        });
        if (matches.length >= maxMatches) break;
      }
      if (matches.length >= maxMatches) break;
    }

    logger.info(
      `Enhanced search (indexed) found ${matches.length} matches for "${keyword}"`,
    );

    return {
      keyword,
      totalMatches: matches.length,
      matches,
      searchMethod: 'indexed',
    };
  }
}
