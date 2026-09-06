/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';

import {getEnvValue} from '../../config/resolver.js';
import {logger} from '../../utils/logger.js';
import type {BuiltReplayRequest} from '../network/NetworkTypes.js';
import {formatCurl, stripManagedHeaders} from '../network/replayEngine.js';

import {CaManager, resolveMitmCertsDir} from './CaManager.js';
import {normalizeHost} from './hostFilter.js';
import {MitmProxyServer} from './MitmProxyServer.js';
import {
  ProcessConnectionTracker,
  type ProcessInfo,
} from './ProcessConnectionTracker.js';
import {ProxyStore} from './ProxyStore.js';
import {MitmRuleEngine, matchesPredicate} from './rewrite.js';
import {SystemProxyManager} from './SystemProxyManager.js';
import type {
  AddHostFilterData,
  AddHostFilterParams,
  AddMitmRuleData,
  AddMitmRuleParams,
  CapturedExchange,
  CapturedRequest,
  ClearHostFiltersData,
  ClearMitmRequestsData,
  ClearMitmRulesData,
  ExportMitmCaData,
  ExportMitmCaParams,
  ExportMitmHarData,
  ExportMitmHarParams,
  GetMitmRequestData,
  GetMitmRequestParams,
  ListHostFiltersData,
  ListMitmRequestsData,
  ListMitmRequestsParams,
  ListMitmRulesData,
  LocalAppsConfig,
  LocalAppsStatus,
  MitmMethodResult,
  MitmProxyStatusData,
  MitmRewriteRule,
  RemoveHostFilterData,
  RemoveHostFilterParams,
  RemoveMitmRuleData,
  RemoveMitmRuleParams,
  StartMitmProxyData,
} from './types.js';

const DEFAULT_PORT = 8888;
const HAR_VERSION = '1.2';

/**
 * MitmModule — MITM 抓包门面。协调 CaManager / MitmProxyServer / ProxyStore /
 * MitmRuleEngine。通过 runtime.mitmModule 访问。
 */
export class MitmModule {
  private readonly store: ProxyStore;
  private readonly caManager: CaManager;
  private readonly rules: MitmRuleEngine;
  private readonly allowHosts = new Set<string>();
  private readonly blockHosts = new Set<string>();
  private server: MitmProxyServer | null = null;
  private readonly systemProxy: SystemProxyManager;
  private readonly processTracker: ProcessConnectionTracker;
  private localApps: LocalAppsConfig = {
    enabled: false,
    targets: [],
    systemProxyActive: false,
  };
  private systemProxyUnsupported = false;

  /**
   * @param certsDir CA 证书目录
   * @param onExchange 可选的 exchange 水槽（Session 抓包链路）。
   *   缺省表示只走旧链路；水槽内抛错被吞掉，不影响 ProxyStore（spec §4 / R3）。
   * @param systemProxy 可选的系统代理管理器（测试注入用）。
   * @param processTracker 可选的进程连接跟踪器（测试注入用）。
   */
  constructor(
    certsDir: string = resolveMitmCertsDir(),
    private readonly onExchange?: (exchange: CapturedExchange) => void,
    systemProxy?: SystemProxyManager,
    processTracker?: ProcessConnectionTracker,
  ) {
    this.store = new ProxyStore();
    this.caManager = new CaManager(certsDir);
    this.rules = new MitmRuleEngine();
    this.systemProxy = systemProxy ?? new SystemProxyManager();
    this.processTracker = processTracker ?? new ProcessConnectionTracker();
  }

  getSystemProxyManager(): SystemProxyManager {
    return this.systemProxy;
  }

  async restoreSystemProxy(): Promise<void> {
    await this.systemProxy.restore();
  }

  restoreSystemProxySync(): void {
    this.systemProxy.restoreSync();
  }

  getProcessConnectionTracker(): ProcessConnectionTracker {
    return this.processTracker;
  }

  getLocalAppsStatus(): LocalAppsStatus {
    return {
      ...this.localApps,
      trackerDegraded: this.processTracker.isDegraded(),
      systemProxyUnsupported:
        this.systemProxyUnsupported || process.platform !== 'win32',
    };
  }

  async configureLocalApps(params: {
    enabled?: boolean;
    targets?: string[];
    port?: number;
  }): Promise<MitmMethodResult<LocalAppsStatus>> {
    try {
      if (params.targets !== undefined) this.localApps.targets = params.targets;
      if (params.enabled === undefined) {
        return {
          success: true,
          message: 'Local Apps 配置已更新',
          data: this.getLocalAppsStatus(),
        };
      }
      if (params.enabled) {
        if (!this.server) {
          const started = await this.start(params.port);
          if (!started.success) {
            return {
              success: false,
              message: started.message,
              data: this.getLocalAppsStatus(),
            };
          }
        }
        const port = this.server?.getPort();
        if (port === null || port === undefined) {
          throw new Error('代理端口未知');
        }
        await this.systemProxy.enable(port);
        this.processTracker.startBackgroundRefresh();
        this.localApps.enabled = true;
        this.localApps.systemProxyActive = true;
      } else {
        await this.systemProxy.restore();
        this.processTracker.stopBackgroundRefresh();
        this.localApps.enabled = false;
        this.localApps.systemProxyActive = false;
      }
      return {
        success: true,
        message: `Local Apps 已${params.enabled ? '开启' : '关闭'}`,
        data: this.getLocalAppsStatus(),
      };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('systemProxyUnsupported')
      ) {
        this.systemProxyUnsupported = true;
      }
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
        data: this.getLocalAppsStatus(),
      };
    }
  }

  async listLocalProcesses(): Promise<
    MitmMethodResult<{processes: ProcessInfo[]}>
  > {
    const processes = await this.processTracker.listActiveNetworkProcesses();
    return {
      success: true,
      message: `共 ${processes.length} 个联网进程`,
      data: {processes},
    };
  }

  getStore(): ProxyStore {
    return this.store;
  }

  getRuleEngine(): MitmRuleEngine {
    return this.rules;
  }

  // ─── 域名过滤 ──────────────────────────────

  /**
   * 是否旁路该 host（白名单优先，黑名单次之，两空不过滤）。
   * 语义对齐 ProxyPin host_filter.dart:23-46。
   */
  shouldBypass(host: string): boolean {
    const normalized = normalizeHost(host);
    if (!normalized) return false;

    if (this.allowHosts.size > 0) {
      for (const entry of this.allowHosts) {
        if (normalized.includes(entry)) return false;
      }
      return true;
    }
    if (this.blockHosts.size > 0) {
      for (const entry of this.blockHosts) {
        if (normalized.includes(entry)) return true;
      }
    }
    return false;
  }

  addHostFilter(
    params: AddHostFilterParams,
  ): MitmMethodResult<AddHostFilterData> {
    const host = normalizeHost(params.host);
    if (!host) {
      return {
        success: false,
        message: 'host 不能为空',
        data: {action: params.action, host: ''},
      };
    }
    (params.action === 'allow' ? this.allowHosts : this.blockHosts).add(host);
    return {
      success: true,
      message: `已${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`,
      data: {action: params.action, host},
    };
  }

  removeHostFilter(
    params: RemoveHostFilterParams,
  ): MitmMethodResult<RemoveHostFilterData> {
    const host = normalizeHost(params.host);
    const removed = (
      params.action === 'allow' ? this.allowHosts : this.blockHosts
    ).delete(host);
    return {
      success: removed,
      message: removed
        ? `已移除${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`
        : `未找到${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`,
      data: {removed},
    };
  }

  listHostFilters(): MitmMethodResult<ListHostFiltersData> {
    return {
      success: true,
      message: `白名单 ${this.allowHosts.size} 条，黑名单 ${this.blockHosts.size} 条`,
      data: {
        allow: [...this.allowHosts],
        block: [...this.blockHosts],
      },
    };
  }

  clearHostFilters(): MitmMethodResult<ClearHostFiltersData> {
    const clearedCount = this.allowHosts.size + this.blockHosts.size;
    this.allowHosts.clear();
    this.blockHosts.clear();
    return {
      success: true,
      message: `已清空 ${clearedCount} 条域名过滤`,
      data: {clearedCount},
    };
  }

  /**
   * 单条 exchange 的落点：先旧链路（ProxyStore），再新链路（水槽）。
   * 顺序不可换 —— 新链路失败时旧链路必须已经落好（spec §4 / R3）。
   *
   * 被改写规则命中的 exchange（modified=true）**不喂 Session 水槽**：
   * Session 侧是「真实流量」证据链，被改流量只留 ProxyStore 并带
   * appliedRuleIds 供追溯（gap-analysis §6 Evidence-first）。
   * ponytail: Session 侧尚无 modified 列，需 user_version=2 迁移才能承载。
   */
  recordExchange(exchange: CapturedExchange): void {
    this.store.add(exchange);
    if (!this.onExchange || exchange.modified) return;
    try {
      this.onExchange(exchange);
    } catch (error) {
      logger.warn('[MitmModule] Session 水槽摄入失败，已忽略', error);
    }
  }

  getCaManager(): CaManager {
    return this.caManager;
  }

  async start(
    port: number = DEFAULT_PORT,
    upstreamProxy?: string,
  ): Promise<MitmMethodResult<StartMitmProxyData>> {
    const effectiveUpstreamProxy =
      upstreamProxy ??
      getEnvValue('BROWSER_MITM_UPSTREAM_PROXY') ??
      getEnvValue('ALL_PROXY');

    try {
      await this.caManager.init();
      if (!this.server) {
        this.server = new MitmProxyServer(
          this.caManager,
          exchange => {
            this.recordExchange(exchange);
          },
          this.rules,
          host => this.shouldBypass(host),
          effectiveUpstreamProxy,
          this.processTracker,
          () => this.localApps,
        );
      }
      await this.server.start(port);
      const upstreamNote = this.server.getUpstreamProxy()
        ? `（上游代理：${this.server.getUpstreamProxy()}）`
        : '';
      return {
        success: true,
        message: `MITM 代理已启动，端口 ${this.server.getPort()}${upstreamNote}`,
        data: {
          port: this.server.getPort() ?? port,
          caCertPath: this.caManager.getCaCertPath(),
          caInitialized: this.caManager.isInitialized(),
          upstreamProxy: this.server.getUpstreamProxy(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `启动 MITM 代理失败：${error instanceof Error ? error.message : String(error)}`,
        data: {
          port,
          caCertPath: this.caManager.getCaCertPath(),
          caInitialized: this.caManager.isInitialized(),
          upstreamProxy: effectiveUpstreamProxy ?? null,
        },
      };
    }
  }

  async stop(): Promise<MitmMethodResult<MitmProxyStatusData>> {
    try {
      if (this.localApps.enabled || this.systemProxy.isActive()) {
        try {
          await this.systemProxy.restore();
        } catch {
          /* 已尽力 */
        }
        this.processTracker.stopBackgroundRefresh();
        this.localApps.enabled = false;
        this.localApps.systemProxyActive = false;
      }
      await this.server?.stop();
      this.server = null;
      return {
        success: true,
        message: 'MITM 代理已停止',
        data: this.statusData(),
      };
    } catch (error) {
      return {
        success: false,
        message: `停止 MITM 代理失败：${error instanceof Error ? error.message : String(error)}`,
        data: this.statusData(),
      };
    }
  }

  status(): MitmMethodResult<MitmProxyStatusData> {
    return {
      success: true,
      message: this.server?.isRunning()
        ? `MITM 代理运行中，端口 ${this.server.getPort()}`
        : 'MITM 代理未运行',
      data: this.statusData(),
    };
  }

  listRequests(
    params: ListMitmRequestsParams = {},
  ): MitmMethodResult<ListMitmRequestsData> {
    let records = this.store.list();

    records = records.filter(r => {
      return matchesPredicate(
        {
          urlFilter: params.urlFilter,
          method: params.method,
          host: params.host,
          statusCode: params.statusCode,
          headerContains: params.headerContains,
          bodyContains: params.bodyContains,
        },
        {
          method: r.method,
          url: r.url,
          headers: r.requestHeaders,
          requestBody: r.requestBody,
          responseBody: r.responseBody,
          statusCode: r.statusCode,
        },
      );
    });

    const pageIdx = params.pageIdx ?? 0;
    const pageSize = params.pageSize;
    const total = records.length;
    const paged = pageSize
      ? records.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize)
      : records;

    return {
      success: true,
      message: `共 ${total} 条捕获记录，返回 ${paged.length} 条`,
      data: {
        requests: paged.map(r => ({
          id: r.id,
          method: r.method,
          url: r.url,
          statusCode: r.statusCode,
          contentType: r.contentType,
          timestamp: r.timestamp,
          modified: r.modified,
          truncated: r.truncated,
        })),
        total,
        pageIdx,
        pageSize,
      },
    };
  }

  async getRequest(
    params: GetMitmRequestParams,
  ): Promise<MitmMethodResult<GetMitmRequestData>> {
    const record = this.store.get(params.id);
    if (!record) {
      return {
        success: false,
        message: `未找到 id=${params.id} 的捕获记录`,
        data: this.emptyRequestData(params.id),
      };
    }

    if (params.saveTo) {
      try {
        await writeFile(params.saveTo, record.responseBody ?? '', 'utf-8');
      } catch (error) {
        return {
          success: false,
          message: `保存响应到 ${params.saveTo} 失败：${error instanceof Error ? error.message : String(error)}`,
          data: {...this.toRequestData(record), savedPath: undefined},
        };
      }
    }

    const data = this.toRequestData(record);
    if (params.format === 'curl') {
      data.curl = this.requestCurl(record);
    }

    return {
      success: true,
      message: `捕获记录 id=${params.id} 获取成功`,
      data: {
        ...data,
        ...(params.saveTo !== undefined && {savedPath: params.saveTo}),
      },
    };
  }

  clear(): MitmMethodResult<ClearMitmRequestsData> {
    const cleared = this.store.size();
    this.store.clear();
    return {
      success: true,
      message: `已清空 ${cleared} 条捕获记录`,
      data: {clearedCount: cleared},
    };
  }

  async exportCa(
    params: ExportMitmCaParams,
  ): Promise<MitmMethodResult<ExportMitmCaData>> {
    try {
      await this.caManager.init();
      const data =
        params.format === 'der'
          ? this.caManager.getCaCertDer()
          : readFileSync(this.caManager.getCaCertPath());
      await writeFile(params.outputPath, data);
      return {
        success: true,
        message: `CA 证书已导出到 ${params.outputPath}`,
        data: {
          format: params.format,
          outputPath: params.outputPath,
          bytes: data.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `导出 CA 证书失败：${error instanceof Error ? error.message : String(error)}`,
        data: {format: params.format, outputPath: params.outputPath, bytes: 0},
      };
    }
  }

  // ─── 改写规则管理 ──────────────────────────────

  addRule(params: AddMitmRuleParams): MitmMethodResult<AddMitmRuleData> {
    const rule: MitmRewriteRule = {
      id: params.id ?? this.rules.nextRuleId(),
      action: params.action,
      enabled: params.enabled ?? true,
      ...(params.urlFilter !== undefined && {urlFilter: params.urlFilter}),
      ...(params.method !== undefined && {method: params.method}),
      ...(params.host !== undefined && {host: params.host}),
      ...(params.headerContains !== undefined && {
        headerContains: params.headerContains,
      }),
      ...(params.bodyContains !== undefined && {
        bodyContains: params.bodyContains,
      }),
    };
    this.rules.addRule(rule);
    return {
      success: true,
      message: `改写规则 ${rule.id} 已生效`,
      data: {rule},
    };
  }

  listRules(): MitmMethodResult<ListMitmRulesData> {
    const rules = this.rules.listRules();
    return {
      success: true,
      message: `共 ${rules.length} 条改写规则`,
      data: {rules},
    };
  }

  removeRule(
    params: RemoveMitmRuleParams,
  ): MitmMethodResult<RemoveMitmRuleData> {
    const removed = this.rules.removeRule(params.id);
    return {
      success: removed,
      message: removed ? `已移除规则 ${params.id}` : `未找到规则 ${params.id}`,
      data: {removed},
    };
  }

  clearRules(): MitmMethodResult<ClearMitmRulesData> {
    const clearedCount = this.rules.clearRules();
    return {
      success: true,
      message: `已清空 ${clearedCount} 条改写规则`,
      data: {clearedCount},
    };
  }

  // ─── HAR 导出 ──────────────────────────────

  async exportHar(
    params: ExportMitmHarParams = {},
  ): Promise<MitmMethodResult<ExportMitmHarData>> {
    const records = this.store.list();
    const har = this.buildHar(records);
    if (params.outputPath) {
      try {
        await writeFile(
          params.outputPath,
          JSON.stringify(har, null, 2),
          'utf-8',
        );
      } catch (error) {
        return {
          success: false,
          message: `写 HAR 到 ${params.outputPath} 失败：${error instanceof Error ? error.message : String(error)}`,
          data: {
            har,
            entryCount: records.length,
            outputPath: params.outputPath,
          },
        };
      }
    }
    return {
      success: true,
      message: `已导出 ${records.length} 条为 HAR`,
      data: {
        har,
        entryCount: records.length,
        ...(params.outputPath !== undefined && {outputPath: params.outputPath}),
      },
    };
  }

  private buildHar(records: CapturedRequest[]): Record<string, unknown> {
    const entries = records.map(r => this.harEntry(r));
    return {
      log: {
        version: HAR_VERSION,
        creator: {name: 'proxycli-mitm', version: '0.1.0'},
        entries,
      },
    };
  }

  private harEntry(r: CapturedRequest): Record<string, unknown> {
    const responseBodyText = r.responseBody ?? '';
    const isTextBody = r.responseBody !== null && !this.isBinary(r);
    return {
      startedDateTime: new Date(r.timestamp).toISOString(),
      time: 0,
      request: {
        method: r.method,
        url: r.url,
        httpVersion: 'HTTP/1.1',
        headers: this.headersToHar(r.requestHeaders),
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: r.requestBody ? r.requestBody.length : 0,
        ...(r.requestBody !== null &&
          r.method !== 'GET' && {
            postData: {mimeType: r.contentType ?? '', text: r.requestBody},
          }),
      },
      response: {
        status: r.statusCode,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        headers: this.headersToHar(r.responseHeaders),
        cookies: [],
        content: {
          size:
            r.responseBodySize ?? (r.responseBody ? r.responseBody.length : 0),
          mimeType: r.contentType ?? '',
          ...(isTextBody && {text: responseBodyText}),
          ...(r.responseBodyBase64 && {
            text: r.responseBodyBase64,
            encoding: 'base64',
          }),
        },
        redirectURL: r.responseHeaders['location'] ?? '',
        headersSize: -1,
        bodySize:
          r.responseBodySize ?? (r.responseBody ? r.responseBody.length : 0),
      },
      cache: {},
      timings: {send: 0, wait: 0, receive: 0},
      _mitm: {
        modified: r.modified,
        truncated: r.truncated,
        isStatic: r.isStatic,
        isWebSocket: r.isWebSocket,
        ...(r.appliedRuleIds && {appliedRuleIds: r.appliedRuleIds}),
      },
    };
  }

  private isBinary(r: CapturedRequest): boolean {
    return r.contentType
      ? /^(image|font|audio|video)\//.test(r.contentType) ||
          [
            'application/octet-stream',
            'application/pdf',
            'application/zip',
          ].includes(r.contentType)
      : false;
  }

  private headersToHar(headers: Record<string, string>): unknown[] {
    return Object.entries(headers).map(([name, value]) => ({name, value}));
  }

  /** 复用 network 的 formatCurl 生成 curl 命令（语义与重放一致）。 */
  private requestCurl(r: CapturedRequest): string {
    const built: BuiltReplayRequest = {
      method: r.method,
      url: r.url,
      headers: stripManagedHeaders(r.requestHeaders),
      ...(r.requestBody !== null && {body: r.requestBody}),
    };
    return formatCurl(built, {includeCookies: false});
  }

  private statusData(): MitmProxyStatusData {
    return {
      running: this.server?.isRunning() ?? false,
      port: this.server?.getPort() ?? null,
      capturedCount: this.store.size(),
      upstreamProxy: this.server?.getUpstreamProxy() ?? null,
    };
  }

  private toRequestData(r: CapturedRequest): GetMitmRequestData {
    return {
      ...r,
      ...(r.responseBodySize !== undefined && {
        responseBodySize: r.responseBodySize,
      }),
      ...(r.responseBodyBase64 !== undefined && {
        responseBodyBase64: r.responseBodyBase64,
      }),
      ...(r.appliedRuleIds !== undefined && {
        appliedRuleIds: r.appliedRuleIds,
      }),
    };
  }

  private emptyRequestData(id: number): GetMitmRequestData {
    return {
      id,
      requestId: '',
      method: '',
      url: '',
      requestHeaders: {},
      requestBody: null,
      statusCode: 0,
      responseHeaders: {},
      responseBody: null,
      contentType: null,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: 0,
      modified: false,
    };
  }
}
