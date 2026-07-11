/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {BrowserContext, Frame, Page} from 'patchright';

/**
 * 泛型页面数据收集器基类
 *
 * 提取自 ToolContextProvider 中 Network/Console/WebSocket 三种收集器的共同模式：
 * - WeakMap<Page, T[][]> 导航分组存储
 * - WeakMap<Page, () => number> 稳定 ID 生成器
 * - 主 frame 导航时自动分割存储（保留最近 N 段历史）
 * - 页面关闭时自动清理监听器和存储
 * - BrowserContext 新页面自动注册
 *
 * 子类只需实现 attachListeners() 和 detachListeners() 来注册/移除具体的事件监听。
 */
export abstract class PageCollector<T extends {stableId: number}> {
  protected storage = new WeakMap<Page, T[][]>();
  protected idGenerators = new WeakMap<Page, () => number>();
  protected readonly maxNavigationSaved: number;

  private frameNavHandlers = new WeakMap<Page, (frame: Frame) => void>();
  private contextPageHandler: ((page: Page) => void) | null = null;
  private context: BrowserContext | null = null;

  constructor(maxNavigationSaved = 3) {
    this.maxNavigationSaved = maxNavigationSaved;
  }

  /**
   * 子类实现：为页面注册具体事件监听，并将收集到的数据 push 到 navigations[0]
   */
  protected abstract attachListeners(page: Page, navigations: T[][]): void;

  /**
   * 子类实现：移除页面的事件监听
   */
  protected abstract detachListeners(page: Page): void;

  /**
   * 子类可覆盖：主 frame 导航时的分割策略
   * 默认行为：在头部插入空数组，保留最近 maxNavigationSaved 段
   *
   * NetworkRequestCollector 覆盖此方法以保留最后一个导航请求到新段
   */
  protected splitOnNavigation(page: Page): void {
    const navigations = this.storage.get(page);
    if (!navigations) return;
    navigations.unshift([]);
    navigations.splice(this.maxNavigationSaved);
  }

  /**
   * 为单个页面注册收集器（幂等：已注册的页面不会重复注册）
   */
  attachToPage(page: Page): void {
    if (this.storage.has(page)) return;

    const idGenerator = this.createIdGenerator();
    this.idGenerators.set(page, idGenerator);
    const navigations: T[][] = [[]];
    this.storage.set(page, navigations);

    this.attachListeners(page, navigations);

    // 主 frame 导航时分割存储
    const onFrameNavigated = (frame: Frame): void => {
      if (frame === page.mainFrame()) {
        this.splitOnNavigation(page);
      }
    };
    page.on('framenavigated', onFrameNavigated);
    this.frameNavHandlers.set(page, onFrameNavigated);

    // 页面关闭时自动清理
    page.once('close', () => {
      this.detachFromPage(page);
    });
  }

  /**
   * 移除页面的事件监听和存储
   */
  detachFromPage(page: Page): void {
    this.detachListeners(page);

    const navHandler = this.frameNavHandlers.get(page);
    if (navHandler) {
      try {
        page.off('framenavigated', navHandler);
      } catch {
        // Page might already be closed
      }
      this.frameNavHandlers.delete(page);
    }

    this.storage.delete(page);
    this.idGenerators.delete(page);
  }

  /**
   * 监听 BrowserContext 的新页面事件，自动注册收集器
   */
  startContextCollection(context: BrowserContext): void {
    this.context = context;

    // 为已有页面注册
    for (const page of context.pages()) {
      this.attachToPage(page);
    }

    // 监听新页面
    const onPage = (page: Page): void => {
      this.attachToPage(page);
    };
    this.contextPageHandler = onPage;
    context.on('page', onPage);
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    if (this.contextPageHandler && this.context) {
      this.context.off('page', this.contextPageHandler);
    }
    this.contextPageHandler = null;
    this.context = null;
    // WeakMap 条目会在 Page GC 时自动清理
  }

  /**
   * 获取页面的收集数据
   * @param includeHistory 是否包含历史导航数据（默认只返回当前导航）
   */
  getData(page: Page, includeHistory = false): T[] {
    const navigations = this.storage.get(page);
    if (!navigations) return [];

    if (!includeHistory) {
      return navigations[0] ?? [];
    }

    const data: T[] = [];
    for (let i = this.maxNavigationSaved - 1; i >= 0; i--) {
      if (navigations[i]) {
        data.push(...navigations[i]!);
      }
    }
    return data;
  }

  /**
   * 返回给定页面的导航分组存储（只读访问）。
   * 主要供 DataCollectorManager 委托查询使用，避免暴露内部 WeakMap。
   */
  getNavigations(page: Page): T[][] | undefined {
    return this.storage.get(page);
  }

  /**
   * 按 stableId 查找数据项（跨所有页面和导航段）
   */
  getById(id: number, pages: Page[]): T | undefined {
    for (const page of pages) {
      const navigations = this.storage.get(page);
      if (!navigations) continue;
      for (const navigation of navigations) {
        const found = navigation.find(item => item.stableId === id);
        if (found) return found;
      }
    }
    return undefined;
  }

  /**
   * 在给定页面集合中按自定义谓词查找首个匹配项。
   * 用于 getNetworkRequestStableId / getConsoleMessageStableId 等场景，
   * 统一收敛跨页面跨导航段遍历逻辑。
   */
  findBy(
    pages: Page[],
    predicate: (item: T) => boolean,
  ): T | undefined {
    for (const page of pages) {
      const navigations = this.storage.get(page);
      if (!navigations) continue;
      for (const navigation of navigations) {
        const found = navigation.find(predicate);
        if (found) return found;
      }
    }
    return undefined;
  }

  /**
   * 清空指定页面的所有导航段数据，并重置稳定 ID 计数器。
   *
   * 用于"清空网络请求缓存"等场景：清空后页面再次触发的新事件会从 1 开始
   * 重新分配 stableId，旧 ID 不再被引用。
   *
   * 监听器和 BrowserContext 级别的新页面自动注册不会受影响。
   *
   * @param page 要清空数据的页面；未注册的页面会被忽略
   */
  clear(page: Page): void {
    if (!this.storage.has(page)) return;
    this.storage.set(page, [[]]);
    this.idGenerators.set(page, this.createIdGenerator());
  }

  /**
   * 测试/注入用：直接写入某页面的导航分组存储。
   * 单元测试中在无法真实触发 Playwright 事件的场景下使用。
   * 生产代码应走 attachToPage / startContextCollection 路径。
   */
  seedPageData(page: Page, navigations: T[][]): void {
    const existing = this.storage.get(page);
    if (existing) {
      // 页面已注册且监听器闭包持有原 outer 数组引用：原地替换内容，
      // 避免替换引用后事件回调写入孤儿数组（与 clear() 同样的坑）。
      existing.length = 0;
      existing.push(...navigations);
    } else {
      this.storage.set(page, navigations);
    }
  }

  /**
   * 创建自增 ID 生成器（到 MAX_SAFE_INTEGER 后归零）
   */
  protected createIdGenerator(): () => number {
    let i = 1;
    return () => {
      if (i === Number.MAX_SAFE_INTEGER) {
        i = 0;
      }
      return i++;
    };
  }
}
