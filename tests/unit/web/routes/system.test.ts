/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {createSystemRoutes} from '../../../../src/web/routes/system.js';

function mockReqRes(method: string, url: string) {
  const req = {
    method,
    url,
    on(event: string, cb: (chunk?: Buffer) => void) {
      // system 路由不读 body
      if (event === 'end') cb();
    },
  } as never;
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(body?: string | Buffer) {
      this.responseBody = body ?? '';
    },
    responseBody: '' as string | Buffer,
    get headersSent() {
      return false;
    },
  } as never;
  return {
    req,
    res,
    getBody: () =>
      String((res as {responseBody: string | Buffer}).responseBody),
    status: () => (res as {statusCode: number}).statusCode,
    headers: () => (res as {headers: Record<string, string>}).headers,
  };
}

describe('system routes', () => {
  let logDir: string;

  before(() => {
    logDir = mkdtempSync(path.join(os.tmpdir(), 'system-route-test-'));
  });

  after(() => {
    if (existsSync(logDir)) rmSync(logDir, {recursive: true, force: true});
  });

  function routes() {
    return createSystemRoutes({
      version: '9.9.9',
      startedAt: Date.now() - 5000,
      logDir,
      configPath: '/tmp/does-not-exist-runtime-config.json',
    });
  }

  describe('GET /api/system/info', () => {
    it('returns environment fields and log files sorted by mtime desc', () => {
      writeFileSync(path.join(logDir, 'old.log'), 'old', 'utf8');
      writeFileSync(path.join(logDir, 'new.log'), 'new', 'utf8');
      // 保证 mtime 严格递增：直接改写 mtime，避免同毫秒内的平局。
      // 用顶部 import 的 utimesSync —— swc 编译产物是 ESM，
      // 文件内 require('node:fs') 会抛 "require is not defined"（已实测）。
      const past = Date.now() - 60_000;
      utimesSync(path.join(logDir, 'old.log'), new Date(past), new Date(past));

      const handler = routes().get('GET /api/system/info')!;
      const {req, res, getBody} = mockReqRes('GET', '/api/system/info');
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.version, '9.9.9');
      assert.strictEqual(parsed.data.node, process.version);
      assert.strictEqual(parsed.data.platform, process.platform);
      assert.strictEqual(parsed.data.arch, process.arch);
      assert.strictEqual(parsed.data.pid, process.pid);
      assert.ok(parsed.data.uptimeMs >= 5000);
      assert.strictEqual(parsed.data.logDir, logDir);
      assert.strictEqual(
        parsed.data.configPath,
        '/tmp/does-not-exist-runtime-config.json',
      );
      assert.strictEqual(parsed.data.configExists, false);
      assert.deepStrictEqual(
        parsed.data.logFiles.map((f: {name: string}) => f.name).sort(),
        ['new.log', 'old.log'],
      );
      // mtime 倒序：new.log 在前
      assert.strictEqual(parsed.data.logFiles[0].name, 'new.log');
    });

    it('returns empty logFiles when the log directory is absent', () => {
      const missing = path.join(logDir, 'no-such-subdir');
      const handler = createSystemRoutes({
        version: '1.0.0',
        startedAt: Date.now(),
        logDir: missing,
      }).get('GET /api/system/info')!;
      const {req, res, getBody} = mockReqRes('GET', '/api/system/info');
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.data.logFiles, []);
    });
  });

  describe('log path traversal defense', () => {
    it('rejects ../ traversal', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=../runtime-config.json',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_PATH_FORBIDDEN',
      );
    });

    it('rejects absolute paths', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=/etc/passwd',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_PATH_FORBIDDEN',
      );
    });

    // 形状校验单独挡不住 `..`（不含分隔符、也不绝对），join 后会落到
    // logDir 的父目录（= ~/.browsercli）。实测修复前返回 200。
    it('rejects bare .. which resolves outside the log dir', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=..',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_PATH_FORBIDDEN',
      );
    });
  });

  describe('GET /api/system/logs', () => {
    it('returns file content', () => {
      writeFileSync(path.join(logDir, 'read.log'), 'hello log', 'utf8');
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody} = mockReqRes(
        'GET',
        '/api/system/logs?file=read.log',
      );
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.fileName, 'read.log');
      assert.strictEqual(parsed.data.content, 'hello log');
      assert.strictEqual(parsed.data.truncated, false);
    });

    it('returns 404 when the file does not exist', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=nope.log',
      );
      handler(req, res);

      assert.strictEqual(status(), 404);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_FILE_NOT_FOUND',
      );
    });
  });

  describe('GET /api/system/logs/download', () => {
    it('sets attachment headers and returns plain text', () => {
      writeFileSync(path.join(logDir, 'dl.log'), 'download me', 'utf8');
      const handler = routes().get('GET /api/system/logs/download')!;
      const {req, res, getBody, headers} = mockReqRes(
        'GET',
        '/api/system/logs/download?file=dl.log',
      );
      handler(req, res);

      assert.strictEqual(
        headers()['content-type'],
        'text/plain; charset=utf-8',
      );
      assert.strictEqual(
        headers()['content-disposition'],
        'attachment; filename="dl.log"',
      );
      assert.strictEqual(getBody(), 'download me');
    });

    it('returns 400 on traversal attempts', () => {
      const handler = routes().get('GET /api/system/logs/download')!;
      const {req, res, status} = mockReqRes(
        'GET',
        '/api/system/logs/download?file=../secret.log',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
    });
  });
});
