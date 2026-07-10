/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 代码文件缓存。基于 URL + 选项的哈希键缓存收集结果，支持 TTL 和 LRU 淘汰。
 *
 * @see {@link src/modules/collector/CodeCollector.ts} — collect() 在调用前检查缓存命中
 * @see {@link src/utils/CacheAdapters.ts} — CodeCacheAdapter 注册到 UnifiedCacheManager
 * @see {@link src/utils/UnifiedCacheManager.ts} — 全局缓存管理
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {setImmediate as waitForImmediate} from 'node:timers/promises';

import type {CodeFile, CollectCodeResult} from '../../types/index.js';
import {logger} from '../../utils/logger.js';
import {resolveDefaultCodeCacheDir} from '../../utils/projectPaths.js';

export interface CacheEntry {
  url: string;
  files: CodeFile[];
  totalSize: number;
  collectTime: number;
  timestamp: number;
  hash: string;
}

export interface CacheOptions {
  cacheDir?: string;
  maxAge?: number; // 缓存过期时间（毫秒）
  maxSize?: number; // 最大缓存大小（字节）
}

export class CodeCache {
  private cacheDir: string;
  private maxAge: number;
  private maxSize: number;
  private memoryCache = new Map<string, CacheEntry>();

  // 🆕 内存缓存大小限制（防止内存泄漏）
  private readonly MAX_MEMORY_CACHE_SIZE = 100; // 最多 100 个条目

  constructor(options: CacheOptions = {}) {
    this.cacheDir =
      options.cacheDir || resolveDefaultCodeCacheDir(import.meta.url);
    this.maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 默认24小时
    this.maxSize = options.maxSize || 100 * 1024 * 1024; // 默认100MB
  }

  /**
   * 初始化缓存目录
   */
  async init(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, {recursive: true});
      logger.debug(`Cache directory initialized: ${this.cacheDir}`);
    } catch (error) {
      logger.error('Failed to initialize cache directory:', error);
    }
  }

  /**
   * 生成缓存键
   */
  private generateKey(url: string, options?: Record<string, unknown>): string {
    const data = JSON.stringify({url, options});
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 获取缓存文件路径
   */
  private getCachePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json`);
  }

  /**
   * 检查缓存是否过期
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.maxAge;
  }

  /**
   * 从缓存获取
   */
  async get(
    url: string,
    options?: Record<string, unknown>,
  ): Promise<CollectCodeResult | null> {
    const key = this.generateKey(url, options);

    // 先检查内存缓存
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      if (!this.isExpired(entry)) {
        logger.debug(`Cache hit (memory): ${url}`);
        return {
          files: entry.files,
          dependencies: {nodes: [], edges: []},
          totalSize: entry.totalSize,
          collectTime: entry.collectTime,
        };
      } else {
        this.memoryCache.delete(key);
      }
    }

    // 检查磁盘缓存
    try {
      const cachePath = this.getCachePath(key);
      const data = await fs.readFile(cachePath, 'utf-8');
      const entry: CacheEntry = JSON.parse(data);

      if (this.isExpired(entry)) {
        logger.debug(`Cache expired: ${url}`);
        await fs.unlink(cachePath);
        return null;
      }

      // 加载到内存缓存
      this.memoryCache.set(key, entry);

      logger.debug(`Cache hit (disk): ${url}`);
      return {
        files: entry.files,
        dependencies: {nodes: [], edges: []},
        totalSize: entry.totalSize,
        collectTime: entry.collectTime,
      };
    } catch {
      // 缓存不存在或读取失败
      return null;
    }
  }

  /**
   * 保存到缓存
   */
  async set(
    url: string,
    result: CollectCodeResult,
    options?: Record<string, unknown>,
  ): Promise<void> {
    const key = this.generateKey(url, options);
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(result.files))
      .digest('hex');

    const entry: CacheEntry = {
      url,
      files: result.files,
      totalSize: result.totalSize,
      collectTime: result.collectTime,
      timestamp: Date.now(),
      hash,
    };

    // 保存到内存缓存
    this.memoryCache.set(key, entry);

    // ✅ 修复：限制内存缓存大小（LRU 策略）
    if (this.memoryCache.size > this.MAX_MEMORY_CACHE_SIZE) {
      // 删除最早的条目（Map 保持插入顺序）
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
        logger.debug(`Memory cache evicted: ${firstKey}`);
      }
    }

    // 保存到磁盘缓存
    try {
      const cachePath = this.getCachePath(key);
      await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
      logger.debug(
        `Cache saved: ${url} (${(result.totalSize / 1024).toFixed(2)} KB)`,
      );
    } catch (error) {
      logger.error('Failed to save cache:', error);
    }

    // 检查缓存大小
    await this.cleanup();
  }

  /**
   * 检查缓存文件路径是否为合法的 JSON 缓存文件
   */
  private isJsonCacheFile(file: string): boolean {
    return file.endsWith('.json');
  }

  /**
   * 清理过期缓存
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      let totalSize = 0;
      const entries: Array<{file: string; mtime: Date; size: number}> = [];

      for (const file of files) {
        if (!this.isJsonCacheFile(file)) continue;

        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
        entries.push({
          file: filePath,
          mtime: stats.mtime,
          size: stats.size,
        });
      }

      // 如果总大小超过限制，删除最旧的文件
      if (totalSize > this.maxSize) {
        entries.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

        let removedSize = 0;
        for (const entry of entries) {
          if (totalSize - removedSize <= this.maxSize * 0.8) break;

          await fs.unlink(entry.file);
          removedSize += entry.size;
          logger.debug(`Removed old cache: ${entry.file}`);
        }

        logger.info(`Cache cleanup: removed ${removedSize} bytes`);
      }
    } catch (error) {
      logger.error('Failed to cleanup cache:', error);
    }
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    try {
      this.memoryCache.clear();
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        if (this.isJsonCacheFile(file)) {
          await fs.unlink(path.join(this.cacheDir, file));
        }
      }

      logger.info('All cache cleared');
    } catch (error) {
      logger.error('Failed to clear cache:', error);
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    memoryEntries: number;
    diskEntries: number;
    totalSize: number;
  }> {
    try {
      const files = await fs.readdir(this.cacheDir);
      let totalSize = 0;
      let diskEntries = 0;

      for (const file of files) {
        if (!this.isJsonCacheFile(file)) continue;

        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
        diskEntries++;
      }

      return {
        memoryEntries: this.memoryCache.size,
        diskEntries,
        totalSize,
      };
    } catch (error) {
      logger.error('Failed to get cache stats:', error);
      return {
        memoryEntries: this.memoryCache.size,
        diskEntries: 0,
        totalSize: 0,
      };
    }
  }

  /**
   * 预热缓存（加载常用URL到内存）
   */
  async warmup(urls: string[]): Promise<void> {
    logger.info(`Warming up cache for ${urls.length} URLs...`);

    for (const url of urls) {
      await this.get(url);
    }

    logger.info('Cache warmup completed');
  }

  /**
   * 在缓存的代码文件中搜索
   */
  async searchInCache(
    query: string,
    options?: {
      caseSensitive?: boolean;
      isRegex?: boolean;
      urlFilter?: string;
    },
  ): Promise<
    Array<{
      scriptId: string;
      url?: string;
      lineNumber: number;
      lineContent: string;
    }>
  > {
    const {caseSensitive = false, isRegex = false, urlFilter} = options ?? {};
    const results: Array<{
      scriptId: string;
      url?: string;
      lineNumber: number;
      lineContent: string;
    }> = [];

    let pattern: RegExp;
    try {
      if (isRegex) {
        pattern = new RegExp(query, caseSensitive ? '' : 'i');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, caseSensitive ? '' : 'i');
      }
    } catch {
      return results;
    }

    const SEARCH_LINE_YIELD_INTERVAL = 250;
    const searchEntry = async (files: CodeFile[], entryUrl?: string) => {
      for (const file of files) {
        const fileUrl = file.url ?? entryUrl ?? '';
        if (
          urlFilter &&
          !fileUrl.toLowerCase().includes(urlFilter.toLowerCase())
        ) {
          continue;
        }
        const content = (file as any).content ?? (file as any).source ?? '';
        if (!content) continue;

        const lines = (content as string).split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            results.push({
              scriptId: fileUrl || `cache:line:${i}`,
              url: fileUrl || undefined,
              lineNumber: i,
              lineContent: lines[i],
            });
          }
          // 每处理 SEARCH_LINE_YIELD_INTERVAL 行让出一次事件循环，
          // 让心跳 / 重连 timer 能穿插执行，避免 RPC 因长阻塞被 Sekiro 断开。
          if ((i + 1) % SEARCH_LINE_YIELD_INTERVAL === 0) {
            await waitForImmediate();
          }
        }
        // 单文件处理完也 yield 一次，避免超大单文件长时间冻结事件循环
        await waitForImmediate();
      }
    };

    // 搜索内存缓存
    for (const entry of this.memoryCache.values()) {
      await searchEntry(entry.files, entry.url);
    }

    // 搜索磁盘缓存（跳过已在内存中的条目）
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (!this.isJsonCacheFile(file)) continue;
        try {
          const data = await fs.readFile(
            path.join(this.cacheDir, file),
            'utf-8',
          );
          const entry: CacheEntry = JSON.parse(data);
          if (this.isExpired(entry)) continue;
          await searchEntry(entry.files, entry.url);
        } catch {
          // 跳过无法读取的缓存文件
        }
      }
    } catch {
      // 磁盘搜索失败时返回内存搜索结果
    }

    return results;
  }
}
