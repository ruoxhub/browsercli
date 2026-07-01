/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Page script collector — 页面级脚本收集与依赖分析。
 *
 * 提取自 CodeCollector.ts。负责：
 * - 收集内联 `<script>` 标签（带大小/数量限制）
 * - 收集 Service Worker 脚本
 * - 收集 Web Worker 脚本（通过 Worker 构造函数拦截）
 * - 分析文件依赖关系（ES6 import / CommonJS require / dynamic import）
 *
 * 该模块为无状态工具类，所有方法接收 Page 参数，不持有实例状态。
 * 文件大小/数量限制通过 CollectedFileRegistry 读取。
 */

import type {Page} from '../../third_party/index.js';
import type {CodeFile, DependencyGraph} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

import type {CollectedFileRegistry} from './CollectedFileRegistry.js';

/**
 * 页面脚本收集器。封装内联脚本、Service Worker、Web Worker 的收集逻辑，
 * 以及文件依赖图分析。
 */
export class PageScriptCollector {
  /**
   * 收集内联脚本 - 增强版
   *
   * 🔧 修复：添加大小限制和数量限制，防止超大内联脚本导致 token 溢出
   */
  async collectInlineScripts(
    page: Page,
    registry: CollectedFileRegistry,
  ): Promise<CodeFile[]> {
    const scripts = await page.evaluate((maxSingleSize: number) => {
      const scriptElements = Array.from(
        document.querySelectorAll('script'),
      ) as HTMLScriptElement[];
      return scriptElements
        .filter(script => !script.src && script.textContent)
        .map((script, index) => {
          let content = script.textContent || '';
          const originalSize = content.length;
          let truncated = false;

          // 🔧 限制单个内联脚本大小
          if (content.length > maxSingleSize) {
            content = content.substring(0, maxSingleSize);
            truncated = true;
          }

          return {
            url: `inline-script-${index}`,
            content,
            size: content.length,
            type: 'inline' as const,
            // 额外元数据
            metadata: {
              scriptType: script.type || 'text/javascript',
              async: script.async,
              defer: script.defer,
              integrity: script.integrity || undefined,
              truncated,
              originalSize: truncated ? originalSize : undefined,
            },
          };
        });
    }, registry.MAX_SINGLE_FILE_SIZE);

    // 🔧 限制内联脚本数量
    const limitedScripts = scripts.slice(0, registry.MAX_FILES_PER_COLLECT);

    if (scripts.length > limitedScripts.length) {
      logger.warn(
        `⚠️  Found ${scripts.length} inline scripts, limiting to ${registry.MAX_FILES_PER_COLLECT}`,
      );
    }

    const truncatedCount = limitedScripts.filter(
      s => s.metadata?.truncated,
    ).length;
    if (truncatedCount > 0) {
      logger.warn(
        `⚠️  ${truncatedCount} inline scripts were truncated due to size limits`,
      );
    }

    logger.debug(`Collected ${limitedScripts.length} inline scripts`);
    return limitedScripts;
  }

  /**
   * 收集Service Worker脚本
   */
  async collectServiceWorkers(page: Page): Promise<CodeFile[]> {
    try {
      const serviceWorkers = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) {
          return [];
        }

        const registrations = await navigator.serviceWorker.getRegistrations();
        const workers: Array<{url: string; scope: string; state: string}> = [];

        for (const registration of registrations) {
          const worker =
            registration.active ||
            registration.installing ||
            registration.waiting;
          if (worker && worker.scriptURL) {
            workers.push({
              url: worker.scriptURL,
              scope: registration.scope,
              state: worker.state,
            });
          }
        }

        return workers;
      });

      const files: CodeFile[] = [];

      // ✅ 修复：使用 fetch 而不是 page.goto()，避免破坏页面状态
      for (const worker of serviceWorkers) {
        try {
          // 使用 page.evaluate 中的 fetch，在页面上下文中执行
          const content = await page.evaluate(async url => {
            const response = await fetch(url);
            return await response.text();
          }, worker.url);

          if (content) {
            files.push({
              url: worker.url,
              content,
              size: content.length,
              type: 'service-worker',
            });
            logger.debug(`Collected Service Worker: ${worker.url}`);
          }
        } catch (error) {
          logger.warn(`Failed to collect Service Worker: ${worker.url}`, error);
        }
      }

      return files;
    } catch (error) {
      logger.warn('Service Worker collection failed', error);
      return [];
    }
  }

  /**
   * 收集Web Worker脚本
   */
  async collectWebWorkers(page: Page): Promise<CodeFile[]> {
    try {
      // 注入拦截代码到当前页面（而非 evaluateOnNewDocument，后者仅对后续导航生效）
      await page.evaluate(() => {
        if ((window as any).__workerIntercepted) return;
        (window as any).__workerIntercepted = true;

        const originalWorker = (window as any).Worker;
        const workerUrls: string[] = (window as any).__workerUrls || [];
        (window as any).__workerUrls = workerUrls;

        (window as any).Worker = function (
          scriptURL: string,
          options?: WorkerOptions,
        ) {
          workerUrls.push(scriptURL);
          return new originalWorker(scriptURL, options);
        };
        // 保持原型链
        (window as any).Worker.prototype = originalWorker.prototype;
      });

      // 获取已创建的Worker URL（拦截注入后新创建的 + 无法捕获注入前已创建的）
      const workerUrls = (await page.evaluate(
        () => (window as any).__workerUrls || [],
      )) as string[];

      const files: CodeFile[] = [];

      // ✅ 修复：使用 fetch 而不是 page.goto()，避免破坏页面状态
      for (const url of workerUrls) {
        try {
          // 如果是相对路径，转换为绝对路径
          const absoluteUrl = new URL(url, page.url()).href;

          // 使用 page.evaluate 中的 fetch，在页面上下文中执行
          const content = await page.evaluate(async workerUrl => {
            const response = await fetch(workerUrl);
            return await response.text();
          }, absoluteUrl);

          if (content) {
            files.push({
              url: absoluteUrl,
              content,
              size: content.length,
              type: 'web-worker',
            });
            logger.debug(`Collected Web Worker: ${absoluteUrl}`);
          }
        } catch (error) {
          logger.warn(`Failed to collect Web Worker: ${url}`, error);
        }
      }

      return files;
    } catch (error) {
      logger.warn('Web Worker collection failed', error);
      return [];
    }
  }

  /**
   * 分析文件依赖关系
   */
  analyzeDependencies(files: CodeFile[]): DependencyGraph {
    const nodes: DependencyGraph['nodes'] = [];
    const edges: DependencyGraph['edges'] = [];

    // 为每个文件创建节点
    files.forEach(file => {
      nodes.push({
        id: file.url,
        url: file.url,
        type: file.type,
      });
    });

    // 分析import/require依赖
    files.forEach(file => {
      const dependencies = this.extractDependencies(file.content);

      dependencies.forEach(dep => {
        // 尝试匹配到实际文件
        const targetFile = files.find(
          f =>
            f.url.includes(dep) ||
            f.url.endsWith(dep) ||
            f.url.endsWith(`${dep}.js`),
        );

        if (targetFile) {
          edges.push({
            from: file.url,
            to: targetFile.url,
            type: 'import',
          });
        }
      });
    });

    logger.debug(
      `Dependency graph: ${nodes.length} nodes, ${edges.length} edges`,
    );
    return {nodes, edges};
  }

  /**
   * 从代码中提取依赖
   */
  private extractDependencies(code: string): string[] {
    const dependencies: string[] = [];

    // ES6 import
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    // CommonJS require
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    // Dynamic import
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(code)) !== null) {
      if (match[1]) dependencies.push(match[1]);
    }

    return [...new Set(dependencies)]; // 去重
  }
}
