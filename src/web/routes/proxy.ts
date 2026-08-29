/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {readFileSync} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import os from 'node:os';

import type {MitmModule} from '../../modules/proxy/MitmModule.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';
import type {WsHub} from '../ws/WsHub.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createProxyRoutes(
  mitmModule: MitmModule,
  wsHub: WsHub,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/proxy/status',
      (_req, res) => {
        try {
          const status = mitmModule.status();
          const caManager = mitmModule.getCaManager();
          sendJson(res, {
            ...status.data,
            caInitialized: caManager.isInitialized(),
            caCertPath: caManager.getCaCertPath(),
          });
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'POST /api/proxy/start',
      async (req, res) => {
        let port: number | undefined;
        try {
          const body = (await readJsonBody(req)) as {port?: number};
          if (
            typeof body === 'object' &&
            body !== null &&
            typeof body.port === 'number'
          ) {
            port = body.port;
          }
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          if (code === 'PAYLOAD_TOO_LARGE') {
            sendError(res, code, '请求体超过 1MB 上限', 413);
          } else {
            sendError(res, code, '请求体不是合法 JSON', 400);
          }
          return;
        }

        try {
          const result = await mitmModule.start(port);
          const caManager = mitmModule.getCaManager();
          const currentStatus = mitmModule.status();
          wsHub.broadcast('proxy.status', {
            ...currentStatus.data,
            caInitialized: caManager.isInitialized(),
            caCertPath: caManager.getCaCertPath(),
          });

          if (!result.success) {
            sendError(
              res,
              'PROXY_START_FAILED',
              result.message,
              500,
              result.data,
            );
            return;
          }
          sendJson(res, result.data);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'POST /api/proxy/stop',
      async (_req, res) => {
        try {
          const result = await mitmModule.stop();
          const caManager = mitmModule.getCaManager();
          wsHub.broadcast('proxy.status', {
            ...result.data,
            caInitialized: caManager.isInitialized(),
            caCertPath: caManager.getCaCertPath(),
          });

          if (!result.success) {
            sendError(
              res,
              'PROXY_STOP_FAILED',
              result.message,
              500,
              result.data,
            );
            return;
          }
          sendJson(res, result.data);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    // 旧链路（MITM-only 调试端点）：切片 3 之前 UI 仍读这里，请勿删除。
    // 新链路见 GET /api/session/requests（createSessionRoutes）。
    [
      'GET /api/proxy/requests',
      (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          const urlFilter = url.searchParams.get('urlFilter') ?? undefined;
          const pageIdxRaw = url.searchParams.get('pageIdx');
          const pageSizeRaw = url.searchParams.get('pageSize');
          const pageIdx =
            pageIdxRaw !== null ? Number.parseInt(pageIdxRaw, 10) : undefined;
          const pageSize =
            pageSizeRaw !== null ? Number.parseInt(pageSizeRaw, 10) : undefined;

          const result = mitmModule.listRequests({
            urlFilter,
            pageIdx: Number.isFinite(pageIdx) ? pageIdx : undefined,
            pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
          });
          sendJson(res, result.data);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/proxy/requests/:id',
      async (_req, res, params) => {
        const rawId = params?.id;
        if (!rawId) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const id = Number.parseInt(rawId, 10);
        if (!Number.isFinite(id)) {
          sendError(res, 'BAD_REQUEST', '无效的 :id 路径参数', 400);
          return;
        }
        try {
          const result = await mitmModule.getRequest({id});
          if (!result.success) {
            sendError(res, 'NOT_FOUND', result.message, 404);
            return;
          }
          sendJson(res, result.data);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'DELETE /api/proxy/requests',
      (_req, res) => {
        try {
          const result = mitmModule.clear();
          sendJson(res, result.data);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/proxy/ca/download',
      async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          const format =
            url.searchParams.get('format') === 'der' ? 'der' : 'pem';
          const caManager = mitmModule.getCaManager();
          await caManager.init();

          const isDer = format === 'der';
          const certBuffer = isDer
            ? caManager.getCaCertDer()
            : readFileSync(caManager.getCaCertPath());

          res.statusCode = 200;
          res.setHeader(
            'Content-Type',
            isDer ? 'application/x-x509-ca-cert' : 'application/x-pem-file',
          );
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="mitm-ca.${format}"`,
          );
          res.setHeader('Content-Length', certBuffer.length);
          res.end(certBuffer);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/proxy/ips',
      (_req, res) => {
        try {
          const interfaces = os.networkInterfaces();
          const ips: string[] = [];
          for (const name of Object.keys(interfaces)) {
            const addrs = interfaces[name];
            if (!addrs) continue;
            for (const addr of addrs) {
              if (
                (addr.family === 'IPv4' || (addr.family as unknown) === 4) &&
                !addr.internal
              ) {
                ips.push(addr.address);
              }
            }
          }
          sendJson(res, {ips});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
  ]);
}
