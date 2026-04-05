#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import type {RequestHandler, Request, Response} from 'express';

import {sendCommand} from './client.js';

export interface HttpServerOptions {
  port: number;
}

export async function createHttpServer(options: HttpServerOptions) {
  const app = express();
  app.use(express.json());

  // 健康检查
  app.get('/api/status', ((_req: Request, res: Response) => {
    res.json({status: 'ok', pid: process.pid});
  }) as RequestHandler);

  // 调用工具
  app.post('/api/call-tool', ((req: Request, res: Response) => {
    const {tool, args} = req.body;
    sendCommand({
      method: 'invoke_tool',
      tool,
      args,
    })
      .then(result => res.json(result))
      .catch(error => {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  }) as RequestHandler);

  // 调用技能
  app.post('/api/call-skill', ((req: Request, res: Response) => {
    const {skill, args} = req.body;
    sendCommand({
      method: 'invoke_skill',
      skill,
      args,
    })
      .then(result => res.json(result))
      .catch(error => {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  }) as RequestHandler);

  // 列出技能
  app.get('/api/skills', ((_req: Request, res: Response) => {
    sendCommand({method: 'list_skills'})
      .then(result => res.json(result))
      .catch(error => {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  }) as RequestHandler);

  // 列出工具
  app.get('/api/tools', ((_req: Request, res: Response) => {
    sendCommand({method: 'list_tools'})
      .then(result => res.json(result))
      .catch(error => {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  }) as RequestHandler);

  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const s = app.listen(options.port, () => resolve(s));
      s.on('error', reject);
    },
  );

  return server;
}
