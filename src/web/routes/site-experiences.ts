/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {siteExperienceService} from '../../services/SiteExperienceService.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';

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

export function createSiteExperienceRoutes(): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    [
      'GET /api/site-experiences',
      async (req, res) => {
        try {
          const parsedUrl = new URL(req.url ?? '', 'http://localhost');
          const urlParam = parsedUrl.searchParams.get('url') || undefined;
          const nameParam = parsedUrl.searchParams.get('name') || undefined;

          if (urlParam || nameParam) {
            const results = await siteExperienceService.search({
              url: urlParam,
              name: nameParam,
            });
            sendJson(res, results);
          } else {
            const results = await siteExperienceService.listAll();
            sendJson(res, results);
          }
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'GET /api/site-experiences/:id',
      async (_req, res, params) => {
        const idStr = params?.id;
        if (!idStr) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          sendError(res, 'BAD_REQUEST', '非法的 :id 路径参数，必须为数字', 400);
          return;
        }

        try {
          const result = await siteExperienceService.getById(id);
          if (!result) {
            sendError(res, 'NOT_FOUND', `未找到 ID 为 ${id} 的站点经验`, 404);
            return;
          }
          sendJson(res, result);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'POST /api/site-experiences',
      async (req, res) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          if (code === 'PAYLOAD_TOO_LARGE') {
            sendError(res, code, '请求体超过 1MB 上限', 413);
          } else {
            sendError(res, code, '请求体不是合法 JSON', 400);
          }
          return;
        }

        const domain =
          typeof body.domain === 'string' ? body.domain.trim() : '';
        const name = typeof body.name === 'string' ? body.name.trim() : '';

        if (!domain) {
          sendError(
            res,
            'BAD_REQUEST',
            '创建失败：domain 为必填字段且不能为空',
            400,
          );
          return;
        }
        if (!name) {
          sendError(
            res,
            'BAD_REQUEST',
            '创建失败：name 为必填字段且不能为空',
            400,
          );
          return;
        }

        try {
          const existing = await siteExperienceService.getByDomain(domain);
          if (existing) {
            sendError(
              res,
              'ALREADY_EXISTS',
              `域名 ${domain} 已存在站点经验记录 (ID: ${existing.id})`,
              409,
            );
            return;
          }

          const aliases = Array.isArray(body.aliases)
            ? body.aliases.map(String)
            : [];
          const result = await siteExperienceService.create({
            domain,
            name,
            aliases,
            platformFeatures:
              typeof body.platformFeatures === 'string'
                ? body.platformFeatures
                : null,
            validPatterns:
              typeof body.validPatterns === 'string'
                ? body.validPatterns
                : null,
            knownPitfalls:
              typeof body.knownPitfalls === 'string'
                ? body.knownPitfalls
                : null,
          });

          sendJson(res, result);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'PUT /api/site-experiences/:id',
      async (req, res, params) => {
        const idStr = params?.id;
        if (!idStr) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          sendError(res, 'BAD_REQUEST', '非法的 :id 路径参数，必须为数字', 400);
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any;
        try {
          body = await readJsonBody(req);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = {};
          if (typeof body.name === 'string') {
            updateData.name = body.name.trim();
          }
          if (Array.isArray(body.aliases)) {
            updateData.aliases = body.aliases.map(String);
          }
          if (body.platformFeatures !== undefined) {
            updateData.platformFeatures =
              typeof body.platformFeatures === 'string'
                ? body.platformFeatures
                : null;
          }
          if (body.validPatterns !== undefined) {
            updateData.validPatterns =
              typeof body.validPatterns === 'string'
                ? body.validPatterns
                : null;
          }
          if (body.knownPitfalls !== undefined) {
            updateData.knownPitfalls =
              typeof body.knownPitfalls === 'string'
                ? body.knownPitfalls
                : null;
          }

          const result = await siteExperienceService.update(id, updateData);
          if (!result) {
            sendError(
              res,
              'NOT_FOUND',
              `未找到 ID 为 ${id} 的站点经验，更新失败`,
              404,
            );
            return;
          }

          sendJson(res, result);
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
    [
      'DELETE /api/site-experiences/:id',
      async (_req, res, params) => {
        const idStr = params?.id;
        if (!idStr) {
          sendError(res, 'BAD_REQUEST', '缺少 :id 路径参数', 400);
          return;
        }
        const id = parseInt(idStr, 10);
        if (isNaN(id)) {
          sendError(res, 'BAD_REQUEST', '非法的 :id 路径参数，必须为数字', 400);
          return;
        }

        try {
          const deleted = await siteExperienceService.delete(id);
          if (!deleted) {
            sendError(
              res,
              'NOT_FOUND',
              `未找到 ID 为 ${id} 的站点经验，删除失败`,
              404,
            );
            return;
          }
          sendJson(res, {success: true, id});
        } catch (err) {
          sendUnexpected(res, err);
        }
      },
    ],
  ]);
}
