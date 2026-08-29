/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';

import {logger} from '../../utils/logger.js';

import {CaManager, resolveMitmCertsDir} from './CaManager.js';
import {MitmProxyServer} from './MitmProxyServer.js';
import {ProxyStore} from './ProxyStore.js';
import type {
  CapturedExchange,
  CapturedRequest,
  ClearMitmRequestsData,
  ExportMitmCaData,
  ExportMitmCaParams,
  GetMitmRequestData,
  GetMitmRequestParams,
  ListMitmRequestsData,
  ListMitmRequestsParams,
  MitmMethodResult,
  MitmProxyStatusData,
  StartMitmProxyData,
} from './types.js';

const DEFAULT_PORT = 8888;

/**
 * MitmModule — MITM 抓包门面。协调 CaManager / MitmProxyServer / ProxyStore。
 * 通过 runtime.mitmModule 访问。
 */
export class MitmModule {
  private readonly store: ProxyStore;
  private readonly caManager: CaManager;
  private server: MitmProxyServer | null = null;

  /**
   * @param certsDir CA 证书目录
   * @param onExchange 可选的 exchange 水槽（切片 2 的 Session 抓包链路）。
   *   缺省表示只走旧链路；水槽内抛错被吞掉，不影响 ProxyStore（spec §4 / R3）。
   */
  constructor(
    certsDir: string = resolveMitmCertsDir(),
    private readonly onExchange?: (exchange: CapturedExchange) => void,
  ) {
    this.store = new ProxyStore();
    this.caManager = new CaManager(certsDir);
  }

  getStore(): ProxyStore {
    return this.store;
  }

  /**
   * 单条 exchange 的落点：先旧链路（ProxyStore），再新链路（水槽）。
   * 顺序不可换 —— 新链路失败时旧链路必须已经落好（spec §4 / R3）。
   */
  recordExchange(exchange: CapturedExchange): void {
    this.store.add(exchange);
    if (!this.onExchange) return;
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
  ): Promise<MitmMethodResult<StartMitmProxyData>> {
    try {
      await this.caManager.init();
      if (!this.server) {
        this.server = new MitmProxyServer(this.caManager, exchange => {
          this.recordExchange(exchange);
        });
      }
      await this.server.start(port);
      return {
        success: true,
        message: `MITM 代理已启动，端口 ${this.server.getPort()}`,
        data: {
          port: this.server.getPort()!,
          caCertPath: this.caManager.getCaCertPath(),
          caInitialized: this.caManager.isInitialized(),
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
        },
      };
    }
  }

  async stop(): Promise<MitmMethodResult<MitmProxyStatusData>> {
    try {
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

    if (params.urlFilter) {
      const filter = params.urlFilter.toLowerCase();
      records = records.filter(r => r.url.toLowerCase().includes(filter));
    }

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

    return {
      success: true,
      message: `捕获记录 id=${params.id} 获取成功`,
      data: {
        ...this.toRequestData(record),
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

  private statusData(): MitmProxyStatusData {
    return {
      running: this.server?.isRunning() ?? false,
      port: this.server?.getPort() ?? null,
      capturedCount: this.store.size(),
    };
  }

  private toRequestData(r: CapturedRequest): GetMitmRequestData {
    return {...r};
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
    };
  }
}
