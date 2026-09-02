/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 系统信息 + 日志 REST 路由
 *
 *  GET /api/system/info            — 版本 / 运行环境 / 日志目录与文件列表 / 配置文件路径
 *  GET /api/system/logs            — ?file=<name>，省略取最新。JSON 信封 LogContent
 *  GET /api/system/logs/download   — ?file=<name>。text/plain + attachment，走浏览器原生下载
 */

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path';

import {RUNTIME_CONFIG_PATH} from '../../config/runtimeConfigPersistence.js';
import {getLogDir} from '../../utils/logger.js';
import {sendError, sendJson} from '../middleware/error.js';

/** 单次日志读取上限（尾部截断） */
const MAX_LOG_READ_BYTES = 1 * 1024 * 1024;

/** info 接口返回的日志文件条目上限 */
const MAX_LOG_FILES = 20;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface SystemRoutesConfig {
  /** package.json 版本号；ConsoleServer 读出后注入 */
  version: string;
  /** 进程启动时间戳（ms） */
  startedAt: number;
  /** 运行时配置文件路径，默认 RUNTIME_CONFIG_PATH */
  configPath?: string;
  /** 日志目录，默认 getLogDir()。测试注入 tmpdir。 */
  logDir?: string;
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeMs: number;
  logDir: string;
  logFiles: LogFileInfo[];
  configPath: string;
  configExists: boolean;
}

export interface LogContent {
  fileName: string;
  content: string;
  truncated: boolean;
}

/**
 * 把用户提供的文件名解析为日志目录内的绝对路径。
 * 返回 undefined 表示非法输入（调用方返回 400）。
 *
 * 只接受 `*.log`：listLogFiles 也只广播 `.log`，两边口径一致。
 * 实测修复前 `?file=notes.txt`（logDir 内的真文件）返回 200 + 内容，
 * 一个列表里从不出现、也没理由进面板的文件被读出来了。
 *
 * 注意顺序：**先校验形状，再 basename**。
 * 早先的写法是 `join(logDir, basename(file))` —— 但 `basename('../x.json')`
 * 已经是 `'x.json'` 了，结果永远落在 logDir 内，下面的 relative 检查
 * 永远不触发，`LOG_PATH_FORBIDDEN` 成了不可达代码（三条测试会红）。
 * 虽然穿越本身仍被 basename 挡住（不会真的读出去），但返回的是 404 而不是
 * spec §6 要求的 400，且给人一种“检查生效了”的错觉。
 *
 * 形状校验之后的 relative 检查不是冗余：`file=.` / `file=..` 不含分隔符、
 * 也不绝对，能过上面三道，但 join 后落在 logDir 之外（父目录，即
 * `~/.browsercli`）。实测 `file=..` 在 Windows 上返回 200 + 空内容。
 * 凭据文件仍不可达（`runtime-config.json` 不在 logDir 内，且
 * `../runtime-config.json` 已被形状校验拒掉），但这里不该靠巧合说话。
 */
function resolveLogFile(logDir: string, file: string): string | undefined {
  if (
    !file ||
    !file.endsWith('.log') ||
    isAbsolute(file) ||
    file !== basename(file)
  ) {
    return undefined;
  }
  const root = resolve(logDir);
  const resolved = resolve(join(root, file));
  const rel = relative(root, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return resolved;
}

/** 读取日志文件尾部内容，超出 MAX_LOG_READ_BYTES 则截断 */
function readLogTail(filePath: string): LogContent {
  const stat = statSync(filePath);
  const start = Math.max(0, stat.size - MAX_LOG_READ_BYTES);
  const size = stat.size - start;
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size);
    // 必须按实际读到的字节数切片：statSync 与 readSync 之间日志轮转/截断
    // 会让文件变短，buf 是 Buffer.alloc 零初始化的，剩下的就是 U+0000，
    // 面板会渲染一排 NUL（reviewer 实测：bytesRead=4 / staleSize=10 → "ABCD\u0000…"）。
    const bytesRead = readSync(fd, buf, 0, size, start);
    return {
      fileName: basename(filePath),
      content: buf.subarray(0, bytesRead).toString('utf8'),
      truncated: start > 0,
    };
  } finally {
    closeSync(fd);
  }
}

/** 列出日志文件（mtime 倒序，最多 MAX_LOG_FILES 条）。目录不存在返回 []。 */
function listLogFiles(logDir: string): LogFileInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(logDir);
  } catch (err) {
    // 目录不存在 = 还没产生过日志，是正常状态；
    // 其它错误（EACCES / EIO）必须抛出，由调用方决定后果：
    // /logs 让它冒到 RestRouter.dispatch 转 500；info 自己接住、降级成空列表。
    // （实际错码是 INTERNAL，不是 spec 里写的 LOG_DIR_READ_FAILED —— 要拿到后者
    // 得在路由里自己包一层，本轮不加。）
    // 早先这里是 `catch { return [] }`，把“目录不可读”伪装成“暂无日志文件”，
    // 用户在通用页看到空列表，而日志其实存在且读不出来。
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files = entries
    .filter(name => name.endsWith('.log'))
    .map(name => {
      const full = join(logDir, name);
      // 逐个 stat 也要兜住：readdir 与 stat 之间文件可能被轮转删除
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return null;
        return {name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs};
      } catch {
        return null;
      }
    })
    .filter((f): f is LogFileInfo => f !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files.slice(0, MAX_LOG_FILES);
}

export function createSystemRoutes(
  cfg: SystemRoutesConfig,
): Map<string, RouteHandler> {
  const logDir = cfg.logDir ?? getLogDir();
  const configPath = cfg.configPath ?? RUNTIME_CONFIG_PATH;

  return new Map<string, RouteHandler>([
    [
      'GET /api/system/info',
      (_req, res) => {
        // 日志列表是环境信息里的次要数据：目录读不出来不应该把
        // version / node / pid / configPath 一起赔进去。
        let logFiles: LogFileInfo[] = [];
        try {
          logFiles = listLogFiles(logDir);
        } catch {
          // 保留空列表（与“目录不存在”同构）；错误本身仍由 /api/system/logs 暴露
        }
        sendJson(res, {
          version: cfg.version,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptimeMs: Date.now() - cfg.startedAt,
          logDir,
          logFiles,
          configPath,
          configExists: existsSync(configPath),
        } satisfies SystemInfo);
      },
    ],

    [
      'GET /api/system/logs',
      (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const rawFile = url.searchParams.get('file');

        let target: string;
        if (rawFile) {
          const resolvedPath = resolveLogFile(logDir, rawFile);
          if (!resolvedPath) {
            sendError(res, 'LOG_PATH_FORBIDDEN', '非法的日志文件名', 400);
            return;
          }
          if (!existsSync(resolvedPath)) {
            sendError(res, 'LOG_FILE_NOT_FOUND', '日志文件不存在', 404);
            return;
          }
          target = resolvedPath;
        } else {
          const latest = listLogFiles(logDir)[0];
          if (!latest) {
            sendError(res, 'LOG_FILE_NOT_FOUND', '暂无日志文件', 404);
            return;
          }
          target = join(logDir, latest.name);
        }

        try {
          sendJson(res, readLogTail(target));
        } catch (err) {
          sendError(
            res,
            'LOG_FILE_READ_FAILED',
            err instanceof Error ? err.message : String(err),
            500,
          );
        }
      },
    ],

    [
      'GET /api/system/logs/download',
      (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const rawFile = url.searchParams.get('file') ?? '';
        const target = resolveLogFile(logDir, rawFile);
        if (!target) {
          sendError(res, 'LOG_PATH_FORBIDDEN', '非法的日志文件名', 400);
          return;
        }
        if (!existsSync(target)) {
          sendError(res, 'LOG_FILE_NOT_FOUND', '日志文件不存在', 404);
          return;
        }

        try {
          const {content} = readLogTail(target);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${basename(target)}"`,
          );
          res.end(content);
        } catch (err) {
          sendError(
            res,
            'LOG_FILE_READ_FAILED',
            err instanceof Error ? err.message : String(err),
            500,
          );
        }
      },
    ],
  ]);
}
