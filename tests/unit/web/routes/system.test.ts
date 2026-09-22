/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtempSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, describe, it} from 'node:test';

import {createSystemRoutes} from '../../../../src/web/routes/system.js';

const ONE_MIB = 1024 * 1024;

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
  const tmpDirs: string[] = [];

  /**
   * 每条用例一个独立 tmpdir（而不是整个 describe 共享一个）。
   * 早先共享目录时，info 用例断言“目录里恰好只有 new.log/old.log”，
   * 只是因为它恰好排在写 read.log / dl.log 的用例前面才通过 —— 顺序一换就红。
   */
  function freshLogDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'system-route-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  /** 把 mtime 往前挪 `ms`，用来造出确定的新旧顺序（同毫秒会平局）。 */
  function age(file: string, ms: number): void {
    const past = Date.now() - ms;
    // 用顶部 import 的 utimesSync —— swc 编译产物是 ESM，
    // 文件内 require('node:fs') 会抛 "require is not defined"（已实测）。
    utimesSync(file, new Date(past), new Date(past));
  }

  function routes(logDir: string) {
    return createSystemRoutes({
      version: '9.9.9',
      startedAt: Date.now() - 5000,
      logDir,
      configPath: '/tmp/does-not-exist-runtime-config.json',
    });
  }

  /** 取 handler、直接调用，返回读响应的三个 getter。 */
  function call(logDir: string, url: string) {
    const handler = routes(logDir).get(`GET ${url.split('?')[0]}`)!;
    const mock = mockReqRes('GET', url);
    handler(mock.req, mock.res);
    return mock;
  }

  /** 解析响应体（沿用原测试里 `JSON.parse(getBody())` 的宽松程度）。 */
  function json(mock: ReturnType<typeof call>) {
    return JSON.parse(mock.getBody());
  }

  after(() => {
    for (const dir of tmpDirs) rmSync(dir, {recursive: true, force: true});
  });

  describe('GET /api/system/info', () => {
    it('returns environment fields and log files sorted by mtime desc', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'old.log'), 'old', 'utf8');
      writeFileSync(path.join(logDir, 'new.log'), 'new', 'utf8');
      age(path.join(logDir, 'old.log'), 60_000);

      const parsed = json(call(logDir, '/api/system/info'));
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
        parsed.data.logFiles.map((f: {name: string}) => f.name),
        ['new.log', 'old.log'],
      );
      // mtime 倒序：new.log 在前
      assert.strictEqual(parsed.data.logFiles[0].name, 'new.log');
    });

    it('returns empty logFiles when the log directory is absent', () => {
      const missing = path.join(freshLogDir(), 'no-such-subdir');
      const parsed = json(call(missing, '/api/system/info'));
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.data.logFiles, []);
    });

    it('caps the list at 20 files and skips non-.log entries', () => {
      const logDir = freshLogDir();
      for (let i = 0; i < 21; i++) {
        const name = `f${String(i).padStart(2, '0')}.log`;
        writeFileSync(path.join(logDir, name), name, 'utf8');
        age(path.join(logDir, name), i * 1000);
      }
      // 目录里混进非日志文件：既不该进列表，也不该能被读出来
      writeFileSync(path.join(logDir, 'notes.txt'), 'txt', 'utf8');
      writeFileSync(path.join(logDir, 'runtime-config.json'), '{}', 'utf8');

      const parsed = json(call(logDir, '/api/system/info'));
      const names: string[] = parsed.data.logFiles.map(
        (f: {name: string}) => f.name,
      );
      assert.strictEqual(names.length, 20);
      assert.ok(names.every(name => name.endsWith('.log')));
      assert.ok(!names.includes('f20.log')); // 最旧的那条被切掉
      assert.strictEqual(names[0], 'f00.log'); // mtime 倒序，f00 最新
    });

    // 日志列表只是环境信息里的次要数据：目录读不出来（这里用 ENOTDIR 模拟 ——
    // 把 logDir 指向一个普通文件）不该把 version / node / pid / configPath 一起带走。
    // 修复前 handler 直接抛 ENOTDIR → RestRouter 转 500 INTERNAL，整个 payload 丢光。
    it('still returns 200 with an empty file list when the log dir is unreadable', () => {
      const notADir = path.join(freshLogDir(), 'afile');
      writeFileSync(notADir, 'not a directory', 'utf8');

      const mock = call(notADir, '/api/system/info');
      const parsed = json(mock);

      assert.strictEqual(mock.status(), 200);
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.data.logFiles, []);
      assert.strictEqual(parsed.data.version, '9.9.9');
      assert.strictEqual(parsed.data.node, process.version);
      assert.strictEqual(parsed.data.pid, process.pid);
      assert.strictEqual(parsed.data.logDir, notADir);
      assert.strictEqual(parsed.data.configExists, false);
      assert.ok(parsed.data.uptimeMs >= 5000);
    });
  });

  describe('log path traversal defense', () => {
    it('rejects ../ traversal', () => {
      const mock = call(
        freshLogDir(),
        '/api/system/logs?file=../runtime-config.json',
      );
      assert.strictEqual(mock.status(), 400);
      assert.strictEqual(json(mock).error?.code, 'LOG_PATH_FORBIDDEN');
    });

    it('rejects absolute paths', () => {
      const mock = call(freshLogDir(), '/api/system/logs?file=/etc/passwd');
      assert.strictEqual(mock.status(), 400);
      assert.strictEqual(json(mock).error?.code, 'LOG_PATH_FORBIDDEN');
    });

    // 形状校验单独挡不住 `..`（不含分隔符、也不绝对），join 后会落到
    // logDir 的父目录（= ~/.browsercli）。实测修复前返回 200。
    it('rejects bare .. which resolves outside the log dir', () => {
      const mock = call(freshLogDir(), '/api/system/logs?file=..');
      assert.strictEqual(mock.status(), 400);
      assert.strictEqual(json(mock).error?.code, 'LOG_PATH_FORBIDDEN');
    });

    // listLogFiles 只广播 *.log，但修复前 `?file=notes.txt` 能把目录里
    // 任意真文件读出来（实测 200 + 全文）。现在两边口径一致。
    it('rejects a real non-.log file inside the log dir', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'notes.txt'), 'SECRET-NOTES', 'utf8');
      const mock = call(logDir, '/api/system/logs?file=notes.txt');

      assert.strictEqual(mock.status(), 400);
      assert.strictEqual(json(mock).error?.code, 'LOG_PATH_FORBIDDEN');
      assert.ok(!mock.getBody().includes('SECRET-NOTES'));
    });
  });

  describe('GET /api/system/logs', () => {
    it('returns file content', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'read.log'), 'hello log', 'utf8');
      const parsed = json(call(logDir, '/api/system/logs?file=read.log'));

      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.fileName, 'read.log');
      assert.strictEqual(parsed.data.content, 'hello log');
      assert.strictEqual(parsed.data.truncated, false);
    });

    it('returns 404 when the file does not exist', () => {
      const mock = call(freshLogDir(), '/api/system/logs?file=nope.log');
      assert.strictEqual(mock.status(), 404);
      assert.strictEqual(json(mock).error?.code, 'LOG_FILE_NOT_FOUND');
    });

    // 面板初次进「日志」区走的就是这条无 file 的路径，此前零覆盖。
    it('falls back to the newest log when file is omitted', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'older.log'), 'older body', 'utf8');
      writeFileSync(path.join(logDir, 'latest.log'), 'latest body', 'utf8');
      age(path.join(logDir, 'older.log'), 60_000);

      const parsed = json(call(logDir, '/api/system/logs'));
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.fileName, 'latest.log');
      assert.strictEqual(parsed.data.content, 'latest body');
      assert.strictEqual(parsed.data.truncated, false);
    });

    it('returns 404 when the log dir has no .log file', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'notes.txt'), 'txt', 'utf8');
      const mock = call(logDir, '/api/system/logs');

      assert.strictEqual(mock.status(), 404);
      assert.strictEqual(json(mock).error?.code, 'LOG_FILE_NOT_FOUND');
    });

    // Task 2 遗留补测：/logs 对非 ENOENT 的目录错误必须**传播**（抛出 →
    // RestRouter 兜底 500 INTERNAL），不能被吞成空列表 —— 那会把 info 的
    // 降级语义（见上方 info 用例）扭到 logs 头上，用户再也无从得知日志目录坏了。
    // 这里把 logDir 指向一个普通文件：readdirSync 抛 ENOTDIR（非 ENOENT）。
    it('propagates a non-ENOENT log dir error to the caller', () => {
      const logDir = freshLogDir();
      const notADir = path.join(logDir, 'plain-file.log');
      writeFileSync(notADir, 'x', 'utf8');
      const handler = routes(notADir).get('GET /api/system/logs')!;
      const mock = mockReqRes('GET', '/api/system/logs');
      assert.throws(() => handler(mock.req, mock.res), /ENOTDIR/);
    });

    it('truncates to the last 1 MiB for a larger file', () => {
      const logDir = freshLogDir();
      const suffix = Buffer.from('TAIL-MARKER-OK', 'utf8');
      const file = path.join(logDir, 'big.log');
      writeFileSync(file, Buffer.concat([Buffer.alloc(ONE_MIB, 0x41), suffix]));

      const parsed = json(call(logDir, '/api/system/logs?file=big.log'));
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.truncated, true);
      assert.ok(parsed.data.content.length <= ONE_MIB);
      assert.ok(parsed.data.content.endsWith('TAIL-MARKER-OK'));
      assert.ok(parsed.data.content.startsWith('A'));
      // 短读（statSync 与 readSync 之间文件变短）留下的 NUL 填充也归到这里断
      assert.ok(!parsed.data.content.includes('\u0000'));
    });
  });

  describe('GET /api/system/logs/download', () => {
    it('sets attachment headers and returns plain text', () => {
      const logDir = freshLogDir();
      writeFileSync(path.join(logDir, 'dl.log'), 'download me', 'utf8');
      const mock = call(logDir, '/api/system/logs/download?file=dl.log');

      assert.strictEqual(mock.status(), 200);
      assert.strictEqual(
        mock.headers()['content-type'],
        'text/plain; charset=utf-8',
      );
      assert.strictEqual(
        mock.headers()['content-disposition'],
        'attachment; filename="dl.log"',
      );
      assert.strictEqual(mock.getBody(), 'download me');
    });

    it('returns 400 on traversal attempts', () => {
      const mock = call(
        freshLogDir(),
        '/api/system/logs/download?file=../secret.log',
      );
      assert.strictEqual(mock.status(), 400);
    });

    it('returns 404 for a missing .log file', () => {
      const mock = call(
        freshLogDir(),
        '/api/system/logs/download?file=nope.log',
      );
      assert.strictEqual(mock.status(), 404);
      assert.strictEqual(json(mock).error?.code, 'LOG_FILE_NOT_FOUND');
    });
  });
});
