/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Collected file registry — 文件缓存管理与 URL 去重。
 *
 * 提取自 CodeCollector.ts。负责：
 * - 维护 `collectedFilesCache`（完整文件缓存，支持大型网站按需获取）
 * - 维护 `collectedUrls`（去重集合）
 * - 维护缓存大小限制（FIFO 驱逐 + URL 上限清理）
 * - 构造文件元数据（truncation + combo URL 信息）
 *
 * 该模块为纯状态管理对象，不持有浏览器或 CDP 资源。
 */

import type {CodeFile} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import {parseComboUrl} from './comboUrlParser.js';

export interface CollectedFileRegistryOptions {
  maxCollectedUrls?: number;
  maxFilesCacheSize?: number;
  maxFilesPerCollect?: number;
  maxResponseSize?: number;
  maxSingleFileSize?: number;
}

/**
 * 文件缓存注册表。所有文件级状态集中管理，方便 CodeCollector 门面委托。
 */
export class CollectedFileRegistry {
  /** 收集到的完整文件缓存（按 URL 索引），支持后续按需获取 */
  readonly collectedFilesCache = new Map<string, CodeFile>();
  /** 已收集的 URL 集合，用于去重 */
  private collectedUrls = new Set<string>();

  /** 单次收集允许的最大 URL 数量（防止内存泄漏） */
  readonly MAX_COLLECTED_URLS: number;
  /** 文件缓存最大数量（FIFO 驱逐阈值） */
  readonly MAX_FILES_CACHE_SIZE: number;
  /** 单次 collect 返回的文件数量上限（仅在返回阶段使用） */
  readonly MAX_FILES_PER_COLLECT: number;
  /** 单次响应的最大总大小（字节） */
  readonly MAX_RESPONSE_SIZE: number;
  /** 单个文件的最大大小（字节，超出会截断） */
  readonly MAX_SINGLE_FILE_SIZE: number;

  constructor(opts: CollectedFileRegistryOptions = {}) {
    this.MAX_COLLECTED_URLS = opts.maxCollectedUrls ?? 10000;
    this.MAX_FILES_CACHE_SIZE = opts.maxFilesCacheSize ?? 1000;
    this.MAX_FILES_PER_COLLECT = opts.maxFilesPerCollect ?? 200;
    this.MAX_RESPONSE_SIZE = opts.maxResponseSize ?? 512 * 1024;
    this.MAX_SINGLE_FILE_SIZE = opts.maxSingleFileSize ?? 200 * 1024;
  }

  /**
   * URL 是否已被收集（出现在任一缓存中）。
   */
  has(url: string): boolean {
    return this.collectedFilesCache.has(url) || this.collectedUrls.has(url);
  }

  /**
   * URL 是否已记录到去重集合中。
   */
  hasUrl(url: string): boolean {
    return this.collectedUrls.has(url);
  }

  /**
   * 仅记录 URL 到去重集合（不存储文件内容）。
   */
  addUrl(url: string): void {
    this.collectedUrls.add(url);
    this.cleanupCollectedUrls();
  }

  /**
   * 添加文件到缓存。会先检查 FIFO 驱逐，再写入并清理 URL 集合。
   */
  addFile(url: string, file: CodeFile): void {
    this.evictOldestFileIfNeeded();
    this.collectedFilesCache.set(url, file);
    this.collectedUrls.add(url);
    this.cleanupCollectedUrls();
  }

  /**
   * 按 URL 获取单个文件。
   */
  getFile(url: string): CodeFile | undefined {
    return this.collectedFilesCache.get(url);
  }

  /**
   * 获取所有已缓存文件（按插入顺序）。
   */
  getAllFiles(): CodeFile[] {
    return Array.from(this.collectedFilesCache.values());
  }

  /**
   * 构造 combo URL 元数据，保留 truncation 标记
   */
  buildFileMetadata(
    truncated: boolean,
    originalSize: number,
    truncatedSize: number,
    url: string,
  ): Record<string, unknown> | undefined {
    const comboInfo = parseComboUrl(url);
    if (!truncated && !comboInfo) {
      return undefined;
    }
    const metadata: Record<string, unknown> = {};
    if (truncated) {
      metadata.truncated = true;
      metadata.originalSize = originalSize;
      metadata.truncatedSize = truncatedSize;
    }
    if (comboInfo) {
      metadata.combo = true;
      metadata.comboHost = comboInfo.host;
      metadata.comboPrefix = comboInfo.prefix;
      metadata.subFiles = comboInfo.subPaths;
      metadata.subUrls = comboInfo.subUrls;
    }
    return metadata;
  }

  /**
   * 检查是否已达到文件数量上限
   */
  hasReachedFileLimit(currentCount: number): boolean {
    return currentCount >= this.MAX_FILES_PER_COLLECT;
  }

  /**
   * 清空所有缓存（换网站时调用）。
   */
  clear(): void {
    this.collectedFilesCache.clear();
    this.collectedUrls.clear();
  }

  /**
   * 仅清空 URL 去重集合（保留文件缓存）。
   */
  clearUrls(): void {
    this.collectedUrls.clear();
  }

  /**
   * 仅清空文件缓存（保留 URL 去重集合）。返回被清除的文件数量。
   */
  clearFiles(): number {
    const count = this.collectedFilesCache.size;
    this.collectedFilesCache.clear();
    return count;
  }

  /**
   * 返回当前缓存统计。
   */
  getStats(): {
    cacheSize: number;
    urlCount: number;
    maxCollectedUrls: number;
  } {
    return {
      cacheSize: this.collectedFilesCache.size,
      urlCount: this.collectedUrls.size,
      maxCollectedUrls: this.MAX_COLLECTED_URLS,
    };
  }

  // ==================== 🆕 按需获取接口（支持大型网站逆向） ====================

  /**
   * 获取已收集文件的摘要列表（轻量级，不包含文件内容）
   *
   * 🎯 用途：先返回文件列表，让 AI 决定需要哪些文件
   */
  getCollectedFilesSummary(): Array<{
    url: string;
    size: number;
    type: string;
    truncated?: boolean;
    originalSize?: number;
  }> {
    const summaries = Array.from(this.collectedFilesCache.values()).map(
      file => ({
        url: file.url,
        size: file.size,
        type: file.type,
        truncated:
          typeof file.metadata?.truncated === 'boolean'
            ? file.metadata.truncated
            : undefined,
        originalSize:
          typeof file.metadata?.originalSize === 'number'
            ? file.metadata.originalSize
            : undefined,
      }),
    );

    logger.info(`📋 Returning summary of ${summaries.length} collected files`);
    return summaries;
  }

  /**
   * 按 URL 获取单个文件内容
   *
   * @param url 文件 URL
   * @returns 文件内容，如果不存在返回 null
   */
  getFileByUrl(url: string): CodeFile | null {
    const file = this.collectedFilesCache.get(url);
    if (file) {
      logger.info(
        `📄 Returning file: ${url} (${(file.size / 1024).toFixed(2)} KB)`,
      );
      return file;
    }
    logger.warn(`⚠️  File not found: ${url}`);
    return null;
  }

  /**
   * 按 URL 模式批量获取文件
   *
   * @param pattern 正则表达式模式
   * @param limit 最大返回数量（默认20）
   * @param maxTotalSize 最大总大小（默认512KB，防止 MCP token 溢出）
   */
  getFilesByPattern(
    pattern: string,
    limit = 20,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE,
  ): {
    files: CodeFile[];
    totalSize: number;
    matched: number;
    returned: number;
    truncated: boolean;
    warning?: string;
    error?: string;
    message?: string;
  } {
    // 🛡️ Guard: 缓存为空时提前返回友好提示
    if (this.collectedFilesCache.size === 0) {
      return {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
        warning: '脚本缓存为空。请先调用 collect_code 收集脚本后再搜索。',
      };
    }

    // ✅ 修复：添加错误处理，防止无效正则表达式导致崩溃
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      logger.error(`Invalid regex pattern: ${pattern}`, error);
      return {
        files: [],
        totalSize: 0,
        matched: 0,
        returned: 0,
        truncated: false,
        error: 'INVALID_PATTERN',
        message: `无效的正则表达式: ${pattern}`,
      };
    }

    const matched: CodeFile[] = [];

    // 查找所有匹配的文件
    for (const file of this.collectedFilesCache.values()) {
      if (regex.test(file.url)) {
        matched.push(file);
      }
    }

    // 应用限制
    const returned: CodeFile[] = [];
    let totalSize = 0;
    let truncated = false;

    for (let i = 0; i < matched.length && i < limit; i++) {
      const file = matched[i];
      if (file && totalSize + file.size <= maxTotalSize) {
        returned.push(file);
        totalSize += file.size;
      } else {
        truncated = true;
        break;
      }
    }

    if (truncated || matched.length > limit) {
      logger.warn(
        `⚠️  Pattern "${pattern}" matched ${matched.length} files, returning ${returned.length} (limited by size/count)`,
      );
    }

    logger.info(
      `🔍 Pattern "${pattern}": matched ${matched.length}, returning ${returned.length} files (${(totalSize / 1024).toFixed(2)} KB)`,
    );

    return {
      files: returned,
      totalSize,
      matched: matched.length,
      returned: returned.length,
      truncated,
    };
  }

  /**
   * 按优先级获取前 N 个文件
   *
   * @param topN 返回前N个文件（默认10）
   * @param maxTotalSize 最大总大小（默认512KB）
   */
  getTopPriorityFiles(
    topN = 10,
    maxTotalSize: number = this.MAX_RESPONSE_SIZE,
  ): {
    files: CodeFile[];
    totalSize: number;
    totalFiles: number;
  } {
    const allFiles = Array.from(this.collectedFilesCache.values());

    // 计算优先级（复用 SmartCodeCollector 的逻辑）
    const scoredFiles = allFiles.map(file => ({
      file,
      score: this.calculatePriorityScore(file),
    }));

    // 按分数排序
    scoredFiles.sort((a, b) => b.score - a.score);

    // 选取前N个，但不超过总大小限制
    const selected: CodeFile[] = [];
    let totalSize = 0;

    for (let i = 0; i < Math.min(topN, scoredFiles.length); i++) {
      const item = scoredFiles[i];
      if (item && item.file && totalSize + item.file.size <= maxTotalSize) {
        selected.push(item.file);
        totalSize += item.file.size;
      } else {
        break;
      }
    }

    logger.info(
      `⭐ Returning top ${selected.length}/${allFiles.length} priority files (${(totalSize / 1024).toFixed(2)} KB)`,
    );

    return {
      files: selected,
      totalSize,
      totalFiles: allFiles.length,
    };
  }

  /**
   * 计算文件优先级分数（私有方法）
   */
  private calculatePriorityScore(file: CodeFile): number {
    let score = 0;

    // 文件类型加分
    if (file.type === 'inline') score += 10;
    else if (file.type === 'external') score += 5;

    // 文件大小：小文件优先（更可能是核心逻辑）
    if (file.size < 10 * 1024)
      score += 15; // < 10KB
    else if (file.size < 50 * 1024)
      score += 10; // < 50KB
    else if (file.size > 200 * 1024) score -= 10; // > 200KB

    // URL 特征匹配（关键词加分）
    const url = file.url.toLowerCase();
    if (url.includes('main') || url.includes('index') || url.includes('app'))
      score += 20;
    if (
      url.includes('crypto') ||
      url.includes('encrypt') ||
      url.includes('sign')
    )
      score += 30;
    if (url.includes('api') || url.includes('request') || url.includes('ajax'))
      score += 25;
    if (url.includes('core') || url.includes('common') || url.includes('util'))
      score += 15;

    // 第三方库降分
    if (
      url.includes('vendor') ||
      url.includes('lib') ||
      url.includes('jquery') ||
      url.includes('react')
    )
      score -= 20;
    if (url.includes('node_modules') || url.includes('bundle')) score -= 30;

    return score;
  }

  /**
   * 检查并维护 collectedFilesCache 的大小限制（FIFO 策略）
   */
  private evictOldestFileIfNeeded(): void {
    if (this.collectedFilesCache.size >= this.MAX_FILES_CACHE_SIZE) {
      const firstKey = this.collectedFilesCache.keys().next().value;
      if (firstKey) {
        this.collectedFilesCache.delete(firstKey);
        logger.debug(
          `[Cache] Removed oldest file to maintain cache limit: ${firstKey}`,
        );
      }
    }
  }

  /**
   * 清理收集的URL（防止内存泄漏）
   */
  private cleanupCollectedUrls(): void {
    if (this.collectedUrls.size > this.MAX_COLLECTED_URLS) {
      logger.warn(
        `Collected URLs exceeded ${this.MAX_COLLECTED_URLS}, clearing...`,
      );
      // 保留最近的一半
      const urls = Array.from(this.collectedUrls);
      this.collectedUrls.clear();
      urls
        .slice(-Math.floor(this.MAX_COLLECTED_URLS / 2))
        .forEach(url => this.collectedUrls.add(url));
    }
  }
}
