/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {createReadStream, existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {WebSocketServer} from 'ws';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function resolveDebuggerLabDir(moduleUrl = import.meta.url) {
  return path.dirname(fileURLToPath(moduleUrl));
}

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
}

function isSafePath(rootDir, targetPath) {
  const relativePath = path.relative(rootDir, targetPath);
  return (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath)
  );
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function serveStaticFile(siteDir, reqPath, res) {
  const normalizedPath = reqPath === '/' ? '/index.html' : reqPath;
  const targetPath = path.resolve(siteDir, `.${normalizedPath}`);

  if (!isSafePath(siteDir, targetPath) || !existsSync(targetPath)) {
    return false;
  }

  const targetStat = await stat(targetPath);
  if (!targetStat.isFile()) {
    return false;
  }

  res.writeHead(200, {'content-type': getMimeType(targetPath)});
  createReadStream(targetPath).pipe(res);
  return true;
}

export async function startDebuggerLabSite(options = {}) {
  const siteDir = options.siteDir ?? resolveDebuggerLabDir();
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8936;

  if (!existsSync(siteDir)) {
    throw new Error(`Debugger Lab 目录不存在: ${siteDir}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(
        req.url ?? '/',
        `http://${req.headers.host ?? '127.0.0.1'}`,
      );

      if (requestUrl.pathname === '/api/ping') {
        writeJson(res, 200, {
          ok: true,
          message: 'pong',
          source: 'debugger-lab-service',
          via: requestUrl.searchParams.get('via') ?? 'unknown',
          time: new Date().toISOString(),
          headers: {
            'x-debugger-lab': req.headers['x-debugger-lab'] ?? null,
            'user-agent': req.headers['user-agent'] ?? null,
          },
          query: Object.fromEntries(requestUrl.searchParams.entries()),
        });
        return;
      }

      if (requestUrl.pathname === '/api/echo' && req.method === 'POST') {
        const chunks = [];
        req.on('data', chunk => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          writeJson(res, 200, {
            ok: true,
            receivedAt: new Date().toISOString(),
            bodyLength: rawBody.length,
            rawBody,
          });
        });
        return;
      }

      const served = await serveStaticFile(siteDir, requestUrl.pathname, res);
      if (!served) {
        writeJson(res, 404, {
          ok: false,
          error: 'NOT_FOUND',
          path: requestUrl.pathname,
        });
      }
    } catch (error) {
      writeJson(res, 500, {
        ok: false,
        error: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const websocketServer = new WebSocketServer({noServer: true});

  websocketServer.on('connection', socket => {
    socket.send(
      JSON.stringify({
        type: 'connected',
        channel: 'debugger-lab',
        at: new Date().toISOString(),
      }),
    );

    socket.on('message', data => {
      socket.send(
        JSON.stringify({
          type: 'echo',
          at: new Date().toISOString(),
          payload: data.toString(),
        }),
      );
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const requestUrl = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? '127.0.0.1'}`,
    );
    if (requestUrl.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(req, socket, head, ws => {
      websocketServer.emit('connection', ws, req);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Debugger Lab 服务启动后未返回有效地址');
  }

  return {
    host,
    port: address.port,
    siteDir,
    async close() {
      await new Promise((resolve, reject) => {
        websocketServer.close(() => {
          server.close(error => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}

function parseCliArgs(rawArgs) {
  const options = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (
      (arg === '--host' || arg === '--port') &&
      next &&
      !next.startsWith('-')
    ) {
      options[arg.slice(2)] = next;
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      'Debugger Lab 本地测试站',
      '',
      '用法:',
      '  node scripts/debugger-lab/server.mjs [--host <host>] [--port <port>]',
      '',
      '示例:',
      '  npm run debugger-lab',
      '  node scripts/debugger-lab/server.mjs --port 8936',
      '',
    ].join('\n'),
  );
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const port =
    options.port === undefined ? undefined : Number.parseInt(options.port, 10);
  if (options.port !== undefined && !Number.isInteger(port)) {
    throw new Error('端口必须是整数');
  }

  const handle = await startDebuggerLabSite({
    host: options.host,
    port,
  });
  const siteUrl = `http://${handle.host}:${handle.port}`;

  process.stdout.write(
    [
      'Debugger Lab 测试站已启动',
      `地址: ${siteUrl}`,
      `目录: ${handle.siteDir}`,
      'WebSocket: ws://<host>:<port>/ws',
      '按 Ctrl+C 停止服务',
      '',
    ].join('\n'),
  );

  await new Promise(resolve => {
    const shutdown = () => {
      void handle.close().finally(resolve);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
