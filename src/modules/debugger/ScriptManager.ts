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

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setImmediate as waitForImmediate} from 'node:timers/promises';

import type {CDPSession} from '../../third_party/index.js';
import {logger} from '../../utils/logger.js';
import {matchesWildcardPattern} from '../../utils/matchesWildcardPattern.js';

export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sourceLength?: number;
  sourcePath?: string;
  hash?: string;
  sourceMapURL?: string;
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
  hash?: string;
  sourceMapURL?: string;
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
  /** 与 DebuggerContext.SearchMatch 兼容的别名 */
  lineNumber: number;
  /** 与 DebuggerContext.SearchMatch 兼容的别名 */
  lineContent: string;
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
const KEYWORD_CONTEXT_LINES = 3;
const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_SCRIPTS = 1000;

/** 源码批量加载并发数。 */
const SOURCE_LOAD_BATCH_SIZE = 8;
/** 关键词索引条目上限,超出后淘汰最旧条目,防止内存膨胀。 */
const MAX_KEYWORD_INDEX_ENTRIES = 50000;
/** 搜索时每处理多少行让出事件循环一次,避免长时间阻塞。 */
const SEARCH_LINE_YIELD_INTERVAL = 250;
/** 搜索时每处理多少个脚本让出事件循环一次。 */
const SEARCH_SCRIPT_YIELD_INTERVAL = 10;
/** 单条 match context 的截断阈值(字符数)。 */
const MATCH_CONTEXT_MAX_CHARS = 2000;
/** 关键词索引 context 的截断阈值(字符数)。 */
const KEYWORD_CONTEXT_MAX_CHARS = 1000;
/** 上下文截断时围绕 match 提取的窗口大小。 */
const CONTEXT_SNIPPET_WINDOW = 100;

export class ScriptManager {
  private scripts = new Map<string, ScriptInfo>();
  private scriptsByUrl = new Map<string, ScriptInfo[]>();

  private keywordIndex = new Map<string, KeywordIndexEntry[]>();
  private scriptChunks = new Map<string, ScriptChunk[]>();

  private scriptParsedListener: ((params: ScriptParsedEvent) => void) | null =
    null;

  private cacheDir: string | null = null;

  constructor(private getCDPSession: () => CDPSession) {
    this.purgeCache();
  }

  /** 实例化时清空缓存目录,防止上次异常退出后残留文件堆积。 */
  private purgeCache(): void {
    const dir = path.join(os.tmpdir(), 'browsercli-scripts');
    if (!fs.existsSync(dir)) return;

    let removed = 0;
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith('.js')) continue;
        try {
          fs.unlinkSync(path.join(dir, entry));
          removed++;
        } catch {
          // 单文件删除失败不影响其他文件清理
        }
      }
    } catch {
      // 目录读取失败时静默跳过
    }

    if (removed > 0) {
      logger.info(`Purged ${removed} stale script cache file(s) from ${dir}`);
    }
  }

  /** 注册 Debugger.scriptParsed 监听器。由 facade 在 init 时调用。 */
  attachListeners(session: CDPSession): void {
    this.scriptParsedListener = params => this.handleScriptParsed(params);
    session.on('Debugger.scriptParsed', this.scriptParsedListener);
  }

  /** 注销 Debugger.scriptParsed 监听器。由 facade 在 disable 时调用。 */
  detachListeners(session: CDPSession): void {
    if (this.scriptParsedListener) {
      session.off('Debugger.scriptParsed', this.scriptParsedListener);
      this.scriptParsedListener = null;
    }
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
      hash: params.hash,
      sourceMapURL: params.sourceMapURL,
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
   *
   * 监听器由 facade 在 Debugger.enable 之前通过 attachListeners 持续挂载,
   * scriptParsed 事件会持续累加进 scripts/scripsByUrl 索引。当前实现不
   * 再阻塞等待"稳定"——历史上靠轮询 scripts.size 是否变化来判定,但这
   * 会引入最多 5s 的伪延迟,且无法保证后续页面不会再加载新脚本。调用方
   * 应按需读取索引,或在明确需要快照时自行 sleep。
   */
  private async waitForScriptsToStabilize(): Promise<void> {
    let lastCount = 0;
    let stableRounds = 0;
    const startTime = Date.now();
    const pollInterval = 200;
    const maxWait = 5000;
    const requiredStableRounds = 3;

    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      const currentCount = this.scripts.size;
      if (currentCount === lastCount && currentCount > 0) {
        stableRounds++;
        if (stableRounds >= requiredStableRounds) return;
      } else {
        stableRounds = 0;
      }
      lastCount = currentCount;
    }
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
  /** 同步获取所有已加载脚本(不加载源码)。 */
  getAllScriptsSync(): ScriptInfo[] {
    return Array.from(this.scripts.values());
  }

  /** 按 scriptId 获取脚本信息。 */
  getScriptById(scriptId: string): ScriptInfo | undefined {
    return this.scripts.get(scriptId);
  }

  /** 按 URL 精确匹配获取脚本列表。 */
  getScriptsByUrl(url: string): ScriptInfo[] {
    return this.scriptsByUrl.get(url) ?? [];
  }

  /** 从临时缓存读取脚本源码内容。 */
  getScriptContent(scriptId: string): string | null {
    return this.readSource(scriptId);
  }

  /** 获取 beautified 版本的脚本源码（懒缓存）。 */
  async getBeautifiedScriptSource(
    scriptId: string,
    beautify: (source: string) => string,
  ): Promise<string> {
    const script = await this.getScriptSource(scriptId);
    if (!script) {
      throw new Error(`Script source not found: ${scriptId}`);
    }
    if (!script.sourcePath) {
      const loadError = (script as any).loadError;
      if (loadError) {
        throw new Error(
          `Failed to get script source for ${scriptId}: ${loadError.message || loadError}`,
        );
      }
      throw new Error(`Script source not found: ${scriptId}`);
    }
    const source = this.readSource(scriptId);
    if (!source) {
      throw new Error(`Script source file missing: ${scriptId}`);
    }
    try {
      return beautify(source);
    } catch {
      return source;
    }
  }

  async getAllScripts(
    includeSource = false,
    maxScripts = DEFAULT_MAX_SCRIPTS,
  ): Promise<ScriptInfo[]> {
    this.getCDPSession(); // 触发 requireSession 校验

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
    const session = this.getCDPSession();
    logger.warn(
      `Loading source code for ${scripts.length} scripts. This may use significant memory.`,
    );

    let loadedCount = 0;
    let failedCount = 0;
    const missingScripts = scripts.filter(script => !script.sourcePath);
    const total = missingScripts.length;

    for (
      let batchStart = 0;
      batchStart < total;
      batchStart += SOURCE_LOAD_BATCH_SIZE
    ) {
      const batch = missingScripts.slice(
        batchStart,
        batchStart + SOURCE_LOAD_BATCH_SIZE,
      );
      const settled = await Promise.allSettled(
        batch.map(async script => {
          const loaded = await this.loadScriptSourceInternal(script, session);
          if (loaded) {
            loadedCount++;
            if (loadedCount % 10 === 0) {
              logger.debug(
                `Loaded ${loadedCount}/${scripts.length} scripts...`,
              );
            }
          } else {
            failedCount++;
          }
        }),
      );

      for (const result of settled) {
        if (result.status === 'rejected') {
          failedCount++;
        }
      }

      // 每批之间让出事件循环,避免在大型站点上长时间阻塞
      await waitForImmediate();
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

    this.getCDPSession(); // 触发 requireSession 校验

    const targetScript = this.findScript(scriptId, url);
    if (!targetScript) {
      logger.warn(`Script not found: ${scriptId || url}`);
      return null;
    }

    if (!targetScript.sourcePath) {
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

    for (const [scriptUrl, scripts] of this.scriptsByUrl.entries()) {
      if (matchesWildcardPattern(scriptUrl, url)) {
        return scripts[0];
      }
    }
    return undefined;
  }

  /**
   * 内部加载单个脚本源码并建立索引/分片。
   *
   * 与 loadScriptSource 的区别:前者复用调用方传入的 session,避免在
   * 批量加载场景下重复 getCDPSession() 触发校验;后者作为公开入口
   * 自行校验并加载,失败时把错误挂到 script.loadError 上供外层感知。
   */
  private async loadScriptSourceInternal(
    script: ScriptInfo,
    session: CDPSession,
  ): Promise<boolean> {
    if (script.sourcePath) {
      return true;
    }

    try {
      const {scriptSource} = await session.send('Debugger.getScriptSource', {
        scriptId: script.scriptId,
      });
      if (script.url) {
        const filePath = this.cacheFilePath(script.url);
        this.ensureCacheDir();
        fs.writeFileSync(filePath, scriptSource, 'utf-8');
        script.sourcePath = filePath;
      }
      script.sourceLength = scriptSource.length;

      this.buildKeywordIndex(script.scriptId, script.url, scriptSource);
      this.chunkScript(script.scriptId, scriptSource);
      return true;
    } catch (error) {
      logger.warn(`Failed to get source for script ${script.scriptId}:`, error);
      return false;
    }
  }

  private async loadScriptSource(script: ScriptInfo): Promise<boolean> {
    const session = this.getCDPSession();
    const loaded = await this.loadScriptSourceInternal(script, session);
    if (!loaded) {
      // 记录错误详情到 script 对象上,便于外层感知底层 CDP 协议错误
      const error = new Error(
        `Failed to get script source for ${script.scriptId}`,
      );
      (script as any).loadError = error;
      logger.error(`Failed to get script source for ${script.scriptId}`);
    }
    return loaded;
  }

  async findScriptsByUrl(urlPattern: string): Promise<ScriptInfo[]> {
    this.getCDPSession(); // 触发 requireSession 校验

    const results: ScriptInfo[] = [];
    for (const [url, scripts] of this.scriptsByUrl.entries()) {
      if (matchesWildcardPattern(url, urlPattern)) {
        results.push(...scripts);
      }
    }

    logger.info(
      `findScriptsByUrl: ${urlPattern} - found ${results.length} scripts`,
    );
    return results;
  }

  /**
   * 返回脚本源码的本地文件路径。
   *
   * - 未传 filePath 时返回内置临时缓存路径（os.tmpdir()/browsercli-scripts）。
   * - 传 filePath 时，将已加载的源码内容写入该自定义路径（自动创建父目录、
   *   解析为绝对路径）并返回之，便于调用方在固定位置持久化脚本。
   *
   * 返回 null 表示脚本未找到或源码加载/写入失败。
   */
  async getScriptSourcePath(
    scriptId: string,
    filePath?: string,
  ): Promise<string | null> {
    const script = await this.getScriptSource(scriptId);
    if (!script?.sourcePath) return null;

    if (!filePath) {
      return script.sourcePath;
    }

    const content = this.readSource(scriptId);
    if (content === null) return null;

    const resolved = path.resolve(filePath);
    try {
      fs.mkdirSync(path.dirname(resolved), {recursive: true});
      fs.writeFileSync(resolved, content, 'utf-8');
      return resolved;
    } catch (error) {
      logger.warn(`Failed to write script ${scriptId} to ${resolved}:`, error);
      return null;
    }
  }

  /** 已废弃,使用 clear() 代替 */
  clearCache(): void {
    this.clear();
  }

  private readSource(scriptId: string): string | null {
    const script = this.scripts.get(scriptId);
    if (!script?.sourcePath) return null;
    try {
      return fs.readFileSync(script.sourcePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private ensureCacheDir(): string {
    if (this.cacheDir) return this.cacheDir;
    this.cacheDir = path.join(os.tmpdir(), 'browsercli-scripts');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, {recursive: true});
    }
    return this.cacheDir;
  }

  private cacheFilePath(url: string): string {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return path.join(this.ensureCacheDir(), `${hash}.js`);
  }

  async searchInScripts(
    keyword: string,
    options: SearchOptions = {},
  ): Promise<SearchResult> {
    const session = this.getCDPSession();

    const {
      isRegex = false,
      caseSensitive = false,
      contextLines = DEFAULT_CONTEXT_LINES,
      maxMatches = DEFAULT_MAX_MATCHES,
    } = options;

    const searchRegex = this.compileSearchRegex(
      keyword,
      isRegex,
      caseSensitive,
    );
    if (!searchRegex) {
      return {keyword, totalMatches: 0, matches: []};
    }

    const allScripts = this.getAllScriptsSync().slice(0, DEFAULT_MAX_SCRIPTS);
    const cachedScripts: ScriptInfo[] = [];
    const uncachedScripts: ScriptInfo[] = [];

    for (const script of allScripts) {
      if (script.sourcePath) {
        cachedScripts.push(script);
      } else {
        uncachedScripts.push(script);
      }
    }

    logger.info(
      `Searching in ${allScripts.length} scripts (${cachedScripts.length} cached, ${uncachedScripts.length} uncached)...`,
    );

    const matches: SearchMatch[] = [];

    // Phase 1: 已缓存脚本直接本地搜索（零额外开销）
    for (const [i, script] of cachedScripts.entries()) {
      if (matches.length >= maxMatches) break;
      await this.collectMatchesInScript(
        script,
        searchRegex,
        contextLines,
        maxMatches,
        matches,
      );
      if ((i + 1) % SEARCH_SCRIPT_YIELD_INTERVAL === 0) {
        await waitForImmediate();
      }
    }

    // Phase 2: 未缓存脚本用 CDP Debugger.searchInContent 预筛
    if (matches.length < maxMatches && uncachedScripts.length > 0) {
      const cdpHits = await this.preFilterViaCDP(
        session,
        uncachedScripts,
        keyword,
        isRegex,
        caseSensitive,
      );

      logger.info(
        `CDP pre-filter: ${cdpHits.length}/${uncachedScripts.length} scripts matched`,
      );

      // 只对 CDP 命中的脚本加载源码并做精细搜索
      for (const [i, script] of cdpHits.entries()) {
        if (matches.length >= maxMatches) break;
        const loaded = await this.loadScriptSourceInternal(script, session);
        if (!loaded) continue;
        await this.collectMatchesInScript(
          script,
          searchRegex,
          contextLines,
          maxMatches,
          matches,
        );
        if ((i + 1) % SEARCH_SCRIPT_YIELD_INTERVAL === 0) {
          await waitForImmediate();
        }
      }
    }

    logger.info(
      `searchInScripts: "${keyword}" - found ${matches.length} matches`,
    );

    return {keyword, totalMatches: matches.length, matches};
  }

  /**
   * 使用 CDP Debugger.searchInContent 批量预筛未缓存脚本。
   * 返回包含匹配结果的脚本列表（仅 lineNumber/lineContent，不含 column/context）。
   * 并发控制与 yield 避免阻塞事件循环。
   */
  private async preFilterViaCDP(
    session: CDPSession,
    scripts: ScriptInfo[],
    query: string,
    isRegex: boolean,
    caseSensitive: boolean,
  ): Promise<ScriptInfo[]> {
    const hits: ScriptInfo[] = [];

    for (
      let batchStart = 0;
      batchStart < scripts.length;
      batchStart += SOURCE_LOAD_BATCH_SIZE
    ) {
      const batch = scripts.slice(
        batchStart,
        batchStart + SOURCE_LOAD_BATCH_SIZE,
      );

      const settled = await Promise.allSettled(
        batch.map(async script => {
          try {
            const result = await session.send('Debugger.searchInContent', {
              scriptId: script.scriptId,
              query,
              caseSensitive,
              isRegex,
            });
            if (
              result &&
              Array.isArray(result.result) &&
              result.result.length > 0
            ) {
              return script;
            }
          } catch {
            // CDP 搜索失败时静默跳过，后续不会加载该脚本
          }
          return null;
        }),
      );

      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) {
          hits.push(r.value);
        }
      }

      await waitForImmediate();
    }

    return hits;
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

  private async collectMatchesInScript(
    script: ScriptInfo,
    searchRegex: RegExp,
    contextLines: number,
    maxMatches: number,
    matches: SearchMatch[],
  ): Promise<void> {
    const source = this.readSource(script.scriptId);
    if (!source) return;
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxMatches) return;

      const line = lines[i];
      if (!line) continue;

      const lineMatches = Array.from(line.matchAll(searchRegex));
      for (const match of lineMatches) {
        if (matches.length >= maxMatches) return;

        const startLine = Math.max(0, i - contextLines);
        const endLine = Math.min(lines.length - 1, i + contextLines);
        let context = lines.slice(startLine, endLine + 1).join('\n');

        // 大型单行 bundle 的 context 可能极长,截断为围绕 match 的窗口
        if (context.length > MATCH_CONTEXT_MAX_CHARS) {
          const matchIndex = match.index || 0;
          const snippetStart = Math.max(0, matchIndex - CONTEXT_SNIPPET_WINDOW);
          const snippetEnd = Math.min(
            line.length,
            matchIndex + CONTEXT_SNIPPET_WINDOW,
          );
          context =
            (snippetStart > 0 ? '...' : '') +
            line.substring(snippetStart, snippetEnd) +
            (snippetEnd < line.length ? '...' : '');
        }

        matches.push({
          scriptId: script.scriptId,
          url: script.url || 'inline',
          line: i + 1,
          column: match.index || 0,
          matchText: match[0],
          context,
          lineNumber: i + 1,
          lineContent: line,
        });
      }

      // 每处理 SEARCH_LINE_YIELD_INTERVAL 行让出一次事件循环
      if ((i + 1) % SEARCH_LINE_YIELD_INTERVAL === 0) {
        await waitForImmediate();
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
    if (!script || !script.sourcePath) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const source = this.readSource(scriptId);
    if (!source) {
      throw new Error(`Script source file missing: ${scriptId}`);
    }

    const babel = await this.loadBabel();
    const ast = this.parseScriptWithBabel(babel, source, scriptId);

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
    // 删除所有脚本临时文件
    for (const script of this.scripts.values()) {
      if (script.sourcePath) {
        try {
          fs.unlinkSync(script.sourcePath);
        } catch {
          // 忽略文件不存在或权限错误
        }
      }
    }
    this.scripts.clear();
    this.scriptsByUrl.clear();
    this.keywordIndex.clear();
    this.scriptChunks.clear();
    logger.info('ScriptManager cleared - ready for new website');
  }

  async close(): Promise<void> {
    this.clear();
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
        let context = lines.slice(startLine, endLine + 1).join('\n');

        // 大型单行 bundle 的 context 可能极长,截断为围绕 match 的窗口
        if (context.length > KEYWORD_CONTEXT_MAX_CHARS) {
          const matchIndex = match.index || 0;
          const snippetStart = Math.max(0, matchIndex - 50);
          const snippetEnd = Math.min(line.length, matchIndex + 50);
          context =
            (snippetStart > 0 ? '...' : '') +
            line.substring(snippetStart, snippetEnd) +
            (snippetEnd < line.length ? '...' : '');
        }

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

    // 关键词索引超出容量时淘汰最旧条目,防止内存膨胀
    if (this.keywordIndex.size > MAX_KEYWORD_INDEX_ENTRIES) {
      const excess = this.keywordIndex.size - MAX_KEYWORD_INDEX_ENTRIES;
      let evicted = 0;
      for (const [key] of this.keywordIndex) {
        if (evicted >= excess) break;
        this.keywordIndex.delete(key);
        evicted++;
      }
      logger.debug(
        `Keyword index pruned ${evicted} entries (cap: ${MAX_KEYWORD_INDEX_ENTRIES})`,
      );
    }
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
    const {
      isRegex = false,
      caseSensitive = false,
      maxMatches = DEFAULT_MAX_MATCHES,
    } = options;

    if (isRegex) {
      const result = await this.searchInScripts(keyword, options);
      return {...result, searchMethod: 'regex'};
    }

    const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
    const matches: SearchMatch[] = [];

    for (const [indexedKeyword, entries] of this.keywordIndex.entries()) {
      if (!indexedKeyword.includes(searchTerm)) continue;

      for (const entry of entries) {
        // 从 context 中提取第一行作为 lineContent 兼容字段
        const firstLine = entry.context.split('\n')[0] || '';
        matches.push({
          scriptId: entry.scriptId,
          url: entry.url,
          line: entry.line,
          column: entry.column,
          matchText: indexedKeyword,
          context: entry.context,
          lineNumber: entry.line,
          lineContent: firstLine,
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
