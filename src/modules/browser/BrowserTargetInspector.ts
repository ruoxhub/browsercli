import {createHash} from 'node:crypto';

import type {Browser, CDPSession} from 'patchright';

import type {CodeFile} from '../../types/index.js';
import {ErrorCodes, ToolError} from '../../utils/errors.js';
import {logger} from '../../utils/logger.js';
import {DEFAULT_COLLECTION_LIMITS} from '../collector/CollectedFileRegistry.js';

import {mapCDPError} from './CDPErrorMapper.js';
import {TargetSessionRouter} from './TargetSessionRouter.js';

const SCRIPT_TARGET_TYPES = new Set([
  'page',
  'iframe',
  'worker',
  'shared_worker',
  'service_worker',
]);

interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
  openerId?: string;
}

interface ParsedScript {
  scriptId: string;
  url?: string;
  hash?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  sourceMapURL?: string;
  scriptLanguage?: string;
}

export interface TargetSummary extends TargetInfo {
  canDumpScripts: boolean;
}

export interface ScriptFailure {
  scriptId: string;
  url: string;
  reason: string;
  recoverable: boolean;
}

export interface DumpTargetScriptsResult {
  target: TargetSummary;
  scripts: CodeFile[];
  failures: ScriptFailure[];
  stats: {
    observed: number;
    returned: number;
    duplicates: number;
    failed: number;
    truncated: number;
    omitted: number;
    originalBytes: number;
    returnedBytes: number;
  };
  partial: boolean;
  warnings: string[];
}

export interface BrowserTargetInspectorOptions {
  commandTimeoutMs?: number;
  idleWindowMs?: number;
  maxObservationMs?: number;
  sourceConcurrency?: number;
  maxFiles?: number;
  maxSingleFileBytes?: number;
  maxResponseBytes?: number;
  maxScriptCacheBytes?: number;
}

interface ResolvedOptions {
  commandTimeoutMs: number;
  idleWindowMs: number;
  maxObservationMs: number;
  sourceConcurrency: number;
  maxFiles: number;
  maxSingleFileBytes: number;
  maxResponseBytes: number;
  maxScriptCacheBytes: number;
}

function truncateUtf8(
  content: string,
  maxBytes: number,
): {content: string; originalBytes: number; returnedBytes: number} {
  const originalBytes = Buffer.byteLength(content, 'utf8');
  if (originalBytes <= maxBytes) {
    return {content, originalBytes, returnedBytes: originalBytes};
  }
  let returnedBytes = 0;
  let end = 0;
  for (const char of content) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (returnedBytes + charBytes > maxBytes) break;
    returnedBytes += charBytes;
    end += char.length;
  }
  return {content: content.slice(0, end), originalBytes, returnedBytes};
}

export class BrowserTargetInspector {
  private readonly options: ResolvedOptions;
  private readonly inFlight = new Map<
    string,
    Promise<DumpTargetScriptsResult>
  >();

  constructor(
    private readonly getBrowser: () => Browser | null,
    options: BrowserTargetInspectorOptions = {},
  ) {
    this.options = {
      commandTimeoutMs: options.commandTimeoutMs ?? 5_000,
      idleWindowMs: options.idleWindowMs ?? 75,
      maxObservationMs: options.maxObservationMs ?? 1_000,
      sourceConcurrency: options.sourceConcurrency ?? 4,
      maxFiles:
        options.maxFiles ?? DEFAULT_COLLECTION_LIMITS.maxFilesPerCollect,
      maxSingleFileBytes:
        options.maxSingleFileBytes ??
        DEFAULT_COLLECTION_LIMITS.maxSingleFileSize,
      maxResponseBytes:
        options.maxResponseBytes ?? DEFAULT_COLLECTION_LIMITS.maxResponseSize,
      maxScriptCacheBytes: options.maxScriptCacheBytes ?? 2 * 1024 * 1024,
    };
  }

  async listTargets(): Promise<TargetSummary[]> {
    const browser = this.requireChromium();
    const root = await this.withTimeout(
      browser.newBrowserCDPSession(),
      '创建 browser-level CDP session',
    );
    try {
      const response = await this.rootSend<{targetInfos: TargetInfo[]}>(
        root,
        'Target.getTargets',
      );
      return response.targetInfos.map(info => this.toSummary(info));
    } finally {
      await this.cleanup('root session detach', () => root.detach(), []);
    }
  }

  dumpScripts(targetId: string): Promise<DumpTargetScriptsResult> {
    const existing = this.inFlight.get(targetId);
    if (existing) return existing;
    const pending = this.dumpScriptsOnce(targetId).finally(() => {
      this.inFlight.delete(targetId);
    });
    this.inFlight.set(targetId, pending);
    return pending;
  }

  private async dumpScriptsOnce(
    targetId: string,
  ): Promise<DumpTargetScriptsResult> {
    const browser = this.requireChromium();
    const warnings: string[] = [];
    let root: CDPSession | undefined;
    let router: TargetSessionRouter | undefined;
    let sessionId: string | undefined;
    let removeListener: (() => void) | undefined;
    let primaryError: unknown;
    let result: DumpTargetScriptsResult | undefined;
    try {
      root = await this.withTimeout(
        browser.newBrowserCDPSession(),
        '创建 browser-level CDP session',
      );
      router = new TargetSessionRouter(root, this.options.commandTimeoutMs);
      const listed = await this.rootSend<{targetInfos: TargetInfo[]}>(
        root,
        'Target.getTargets',
        undefined,
        {targetId},
      );
      const targetInfo = listed.targetInfos.find(
        item => item.targetId === targetId,
      );
      if (!targetInfo) {
        throw mapCDPError(new Error('No target with given id found'), {
          targetId,
        });
      }
      const target = this.toSummary(targetInfo);
      if (!target.canDumpScripts) {
        throw new ToolError(
          ErrorCodes.VALIDATION,
          `Target 类型 ${target.type} 不支持脚本快照`,
          {targetId, targetType: target.type},
          false,
        );
      }
      const attached = await this.rootSend<{sessionId: string}>(
        root,
        'Target.attachToTarget',
        {targetId, flatten: false},
        {targetId},
      );
      sessionId = attached.sessionId;
      router.registerSession(sessionId, targetId);

      const parsed: ParsedScript[] = [];
      let omittedEvents = 0;
      let lastObserved = Date.now();
      const maxObserved = this.options.maxFiles * 4;
      removeListener = router.on(sessionId, 'Debugger.scriptParsed', params => {
        lastObserved = Date.now();
        if (parsed.length >= maxObserved) {
          omittedEvents++;
          return;
        }
        parsed.push(params as unknown as ParsedScript);
      });
      await router.send(sessionId, 'Debugger.enable', {
        maxScriptsCacheSize: this.options.maxScriptCacheBytes,
      });
      await this.waitForIdle(() => lastObserved);
      removeListener();
      removeListener = undefined;
      result = await this.buildSnapshot(
        router,
        sessionId,
        target,
        parsed,
        omittedEvents,
        warnings,
      );
      await this.cleanup(
        'Debugger.disable',
        () => router!.send(sessionId!, 'Debugger.disable'),
        warnings,
      );
    } catch (error) {
      primaryError = error;
    } finally {
      removeListener?.();
      if (router && sessionId) {
        router.unregisterSession(sessionId);
      }
      if (root && sessionId) {
        await this.cleanup(
          'Target.detachFromTarget',
          () =>
            this.rootSend(
              root!,
              'Target.detachFromTarget',
              {sessionId},
              {
                targetId,
                sessionId,
              },
            ),
          warnings,
        );
      }
      router?.dispose();
      if (root) {
        await this.cleanup(
          'root session detach',
          () => root!.detach(),
          warnings,
        );
      }
    }
    if (primaryError) {
      const mapped = mapCDPError(primaryError, {targetId, sessionId});
      if (
        mapped instanceof ToolError &&
        warnings.length > 0 &&
        mapped.context
      ) {
        mapped.context.cleanupWarnings = warnings;
      }
      throw mapped;
    }
    if (!result) throw new Error('Target snapshot did not produce a result');
    result.warnings.push(...warnings);
    return result;
  }

  private async buildSnapshot(
    router: TargetSessionRouter,
    sessionId: string,
    target: TargetSummary,
    observed: ParsedScript[],
    initiallyOmitted: number,
    warnings: string[],
  ): Promise<DumpTargetScriptsResult> {
    const scripts: CodeFile[] = [];
    const failures: ScriptFailure[] = [];
    const deduped = new Map<string, CodeFile>();
    let duplicates = 0;
    let truncated = 0;
    let omitted = initiallyOmitted;
    let originalBytes = 0;
    let returnedBytes = 0;
    const eligible: ParsedScript[] = [];
    for (const parsed of observed) {
      if (parsed.scriptLanguage === 'WebAssembly') {
        omitted++;
        warnings.push(`跳过 WebAssembly 脚本 ${parsed.scriptId}`);
      } else {
        eligible.push(parsed);
      }
    }

    for (
      let offset = 0;
      offset < eligible.length;
      offset += this.options.sourceConcurrency
    ) {
      if (
        scripts.length >= this.options.maxFiles ||
        returnedBytes >= this.options.maxResponseBytes
      ) {
        omitted += eligible.length - offset;
        break;
      }
      const batch = eligible.slice(
        offset,
        offset + this.options.sourceConcurrency,
      );
      const sources = await Promise.all(
        batch.map(async parsed => {
          try {
            const value = await router.send<{scriptSource: string}>(
              sessionId,
              'Debugger.getScriptSource',
              {scriptId: parsed.scriptId},
            );
            return {parsed, source: value.scriptSource};
          } catch (error) {
            return {parsed, error};
          }
        }),
      );
      for (let index = 0; index < sources.length; index++) {
        const item = sources[index]!;
        const effectiveUrl =
          item.parsed.url ||
          `target://${target.targetId}/script/${item.parsed.scriptId}`;
        if ('error' in item) {
          const formatted = mapCDPError(item.error, {
            targetId: target.targetId,
            sessionId,
          });
          failures.push({
            scriptId: item.parsed.scriptId,
            url: effectiveUrl,
            reason: formatted.message,
            recoverable:
              formatted instanceof ToolError ? formatted.recoverable : false,
          });
          continue;
        }
        const source = item.source ?? '';
        const contentHash =
          item.parsed.hash || createHash('sha256').update(source).digest('hex');
        const dedupeKey = `${effectiveUrl}\u0000${contentHash}`;
        const duplicate = deduped.get(dedupeKey);
        if (duplicate) {
          duplicates++;
          const ids = duplicate.metadata?.scriptIds as string[];
          ids.push(item.parsed.scriptId);
          continue;
        }
        if (
          scripts.length >= this.options.maxFiles ||
          returnedBytes >= this.options.maxResponseBytes
        ) {
          omitted +=
            sources.length - index + eligible.length - (offset + batch.length);
          offset = eligible.length;
          break;
        }
        const remaining = this.options.maxResponseBytes - returnedBytes;
        const limited = truncateUtf8(
          source,
          Math.min(this.options.maxSingleFileBytes, remaining),
        );
        originalBytes += limited.originalBytes;
        returnedBytes += limited.returnedBytes;
        const wasTruncated = limited.returnedBytes < limited.originalBytes;
        if (wasTruncated) truncated++;
        const file: CodeFile = {
          url: effectiveUrl,
          content: limited.content,
          size: limited.returnedBytes,
          type: this.codeFileType(target),
          metadata: {
            source: 'target-cdp',
            targetId: target.targetId,
            targetType: target.type,
            scriptIds: [item.parsed.scriptId],
            cdpHash: item.parsed.hash,
            startLine: item.parsed.startLine,
            startColumn: item.parsed.startColumn,
            endLine: item.parsed.endLine,
            endColumn: item.parsed.endColumn,
            sourceMapURL: item.parsed.sourceMapURL,
            truncated: wasTruncated,
            originalSize: limited.originalBytes,
            truncatedSize: limited.returnedBytes,
          },
        };
        scripts.push(file);
        deduped.set(dedupeKey, file);
      }
    }
    const stats = {
      observed: observed.length,
      returned: scripts.length,
      duplicates,
      failed: failures.length,
      truncated,
      omitted,
      originalBytes,
      returnedBytes,
    };
    return {
      target,
      scripts,
      failures,
      stats,
      partial: failures.length > 0 || truncated > 0 || omitted > 0,
      warnings: [],
    };
  }

  private requireChromium(): Browser {
    const browser = this.getBrowser();
    if (!browser) {
      throw new ToolError(
        ErrorCodes.PREREQUISITE,
        '浏览器尚未连接',
        undefined,
        true,
      );
    }
    if (!browser.isConnected()) {
      throw new ToolError(
        ErrorCodes.PREREQUISITE,
        '浏览器连接已断开',
        undefined,
        true,
      );
    }
    if (browser.browserType().name() !== 'chromium') {
      throw new ToolError(
        ErrorCodes.VALIDATION,
        'Target 脚本快照仅支持 Chromium',
        {browserType: browser.browserType().name()},
        false,
      );
    }
    return browser;
  }

  private toSummary(info: TargetInfo): TargetSummary {
    return {...info, canDumpScripts: SCRIPT_TARGET_TYPES.has(info.type)};
  }

  private codeFileType(target: TargetSummary): CodeFile['type'] {
    if (target.type === 'service_worker') return 'service-worker';
    if (target.type === 'worker' || target.type === 'shared_worker') {
      return 'web-worker';
    }
    return target.url ? 'external' : 'dynamic';
  }

  private async rootSend<T extends Record<string, unknown>>(
    root: CDPSession,
    method: string,
    params?: Record<string, unknown>,
    context: {targetId?: string; sessionId?: string} = {},
  ): Promise<T> {
    try {
      return await this.withTimeout(
        root.send(method as never, params as never) as Promise<T>,
        method,
      );
    } catch (error) {
      throw mapCDPError(error, context);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    operation: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new ToolError(
                  ErrorCodes.TIMEOUT,
                  `${operation} 超时；请缩小操作范围后重试。`,
                  {operation},
                  true,
                ),
              ),
            this.options.commandTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async cleanup(
    label: string,
    fn: () => Promise<unknown>,
    warnings: string[],
  ): Promise<void> {
    try {
      await this.withTimeout(Promise.resolve().then(fn), label);
    } catch (error) {
      const warning = `${label} cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(warning);
      logger.warn(warning);
    }
  }

  private async waitForIdle(lastObserved: () => number): Promise<void> {
    const started = Date.now();
    while (
      Date.now() - started < this.options.maxObservationMs &&
      Date.now() - lastObserved() < this.options.idleWindowMs
    ) {
      const remaining =
        this.options.idleWindowMs - (Date.now() - lastObserved());
      await new Promise(resolve => setTimeout(resolve, Math.max(1, remaining)));
    }
  }
}
