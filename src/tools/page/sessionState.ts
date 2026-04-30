/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

import {getEnvValue, getEnvNumber} from '../../config.js';
import {validateOutputPath} from '../../utils/fsSafe.js';
import {
  getActivePageWithGuard,
  normalizeBrowserRuntimeError,
  withOperationTimeout,
} from '../shared/browserRuntime.js';

import type {
  DeleteSessionStateParams,
  DeleteSessionStateResult,
  DumpSessionStateParams,
  DumpSessionStateResult,
  ListSessionStatesData,
  ListSessionStatesParams,
  ListSessionStatesResult,
  LoadSessionStateParams,
  LoadSessionStateResult,
  PageRuntimeServices,
  RestoreSessionStateParams,
  RestoreSessionStateResult,
  SaveSessionStateParams,
  SaveSessionStateResult,
  SessionSnapshot,
} from './types.js';

// ─── 内存存储（与原 src/tools/page.ts 保持一致） ─────────

const sessionSnapshots = new Map<string, SessionSnapshot>();
const sessionTtlMs = Math.max(
  60_000,
  getEnvNumber('SESSION_STATE_TTL_MS') ?? 30 * 60_000,
);
const cleanupIntervalMs = Math.max(
  15_000,
  getEnvNumber('SESSION_STATE_CLEANUP_INTERVAL_MS') ?? 5 * 60_000,
);

let cleanupInitialized = false;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

function cleanupExpiredSessions(now = Date.now()): number {
  let removed = 0;
  for (const [sessionId, snapshot] of sessionSnapshots.entries()) {
    if (Date.parse(snapshot.expiresAt) <= now) {
      sessionSnapshots.delete(sessionId);
      removed += 1;
    }
  }
  return removed;
}

function ensureCleanupLoop(): void {
  if (cleanupInitialized) {
    return;
  }
  cleanupInitialized = true;
  cleanupTimer = setInterval(() => {
    cleanupExpiredSessions();
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();
}

// ─── 加密辅助 ──────────────────────────────────────────

function getEncryptionKey(): Buffer | undefined {
  const configured = getEnvValue('SESSION_STATE_ENCRYPTION_KEY');
  if (!configured || configured.length === 0) {
    return undefined;
  }
  return createHash('sha256').update(configured).digest();
}

function encryptText(plainText: string): {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
} {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('SESSION_STATE_ENCRYPTION_KEY is required for encryption.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptText(payload: {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error('SESSION_STATE_ENCRYPTION_KEY is required for decryption.');
  }
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const encrypted = Buffer.from(payload.data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8',
  );
}

function normalizeSnapshot(
  snapshot: unknown,
  fallbackId?: string,
): SessionSnapshot {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid session snapshot payload: expected object.');
  }
  const raw = snapshot as Partial<SessionSnapshot>;
  const id =
    typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : (fallbackId ?? `session_${Date.now()}`);
  return {
    id,
    savedAt:
      typeof raw.savedAt === 'string' && raw.savedAt.length > 0
        ? raw.savedAt
        : new Date().toISOString(),
    expiresAt:
      typeof raw.expiresAt === 'string' && raw.expiresAt.length > 0
        ? raw.expiresAt
        : new Date(Date.now() + sessionTtlMs).toISOString(),
    url: typeof raw.url === 'string' ? raw.url : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    cookies: Array.isArray(raw.cookies) ? raw.cookies : [],
    localStorage:
      raw.localStorage && typeof raw.localStorage === 'object'
        ? raw.localStorage
        : {},
    sessionStorage:
      raw.sessionStorage && typeof raw.sessionStorage === 'object'
        ? raw.sessionStorage
        : {},
  };
}

// ─── 纯函数 ──────────────────────────────────────────────

/**
 * 保存当前页面会话状态到内存快照（纯函数版本）。
 *
 * @param runtime - Page 运行时服务
 * @param params - 保存参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function saveSessionState(
  runtime: PageRuntimeServices,
  params?: SaveSessionStateParams,
): Promise<SaveSessionStateResult> {
  try {
    ensureCleanupLoop();
    cleanupExpiredSessions();

    const page = await getActivePageWithGuard(runtime);
    const sessionId = params?.sessionId ?? `session_${Date.now()}`;
    const includeCookies = !!params?.includeCookies;
    const includeLocalStorage = !!params?.includeLocalStorage;
    const includeSessionStorage = !!params?.includeSessionStorage;

    const cookies = includeCookies
      ? await withOperationTimeout(
          page.context().cookies(),
          '读取 cookies',
        )
      : [];
    const localStorageData: Record<string, string> = includeLocalStorage
      ? await withOperationTimeout(
          page.evaluate(() => {
            const items: Record<string, string> = {};
            for (let i = 0; i < window.localStorage.length; i++) {
              const key = window.localStorage.key(i);
              if (key) {
                items[key] = window.localStorage.getItem(key) || '';
              }
            }
            return items;
          }),
          '读取 localStorage',
        )
      : {};
    const sessionStorageData: Record<string, string> = includeSessionStorage
      ? await withOperationTimeout(
          page.evaluate(() => {
            const items: Record<string, string> = {};
            for (let i = 0; i < window.sessionStorage.length; i++) {
              const key = window.sessionStorage.key(i);
              if (key) {
                items[key] = window.sessionStorage.getItem(key) || '';
              }
            }
            return items;
          }),
          '读取 sessionStorage',
        )
      : {};

    const snapshot: SessionSnapshot = {
      id: sessionId,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      url: page.url(),
      title: await withOperationTimeout(page.title(), '读取页面标题'),
      cookies: cookies as unknown as Array<Record<string, unknown>>,
      localStorage: localStorageData,
      sessionStorage: sessionStorageData,
    };
    sessionSnapshots.set(sessionId, snapshot);

    return {
      success: true,
      message: `会话已保存: ${sessionId}`,
      tooltype: 'save_session_state',
      logFormat: 'json',
      data: {
        sessionId,
        savedAt: snapshot.savedAt,
        url: snapshot.url,
        title: snapshot.title,
        counts: {
          cookies: snapshot.cookies.length,
          localStorage: Object.keys(snapshot.localStorage).length,
          sessionStorage: Object.keys(snapshot.sessionStorage).length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `保存会话失败: ${normalizeBrowserRuntimeError(error)}`,
      tooltype: 'save_session_state',
      logFormat: 'json',
    };
  }
}

/**
 * 从内存快照恢复会话状态到当前页面（纯函数版本）。
 *
 * @param runtime - Page 运行时服务
 * @param params - 恢复参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function restoreSessionState(
  runtime: PageRuntimeServices,
  params: RestoreSessionStateParams,
): Promise<RestoreSessionStateResult> {
  try {
    ensureCleanupLoop();
    cleanupExpiredSessions();

    const snapshot = sessionSnapshots.get(params.sessionId);
    if (!snapshot) {
      return {
        success: false,
        message: `会话快照未找到: ${params.sessionId}`,
        tooltype: 'restore_session_state',
        logFormat: 'json',
      };
    }

    const page = await runtime.getActivePage();

    if (params.navigateToSavedUrl !== false) {
      await page.goto(snapshot.url, {waitUntil: 'networkidle'});
    }

    if (params.clearStorageBeforeRestore === true) {
      await page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      const existingCookies = await page.context().cookies();
      // Playwright: clearCookies with name/domain filter, or clear all
      await page.context().clearCookies();
    }

    if (snapshot.cookies.length > 0) {
      // Playwright: addCookies expects array of {name, value, domain?, path?, ...}
      const cookiesToAdd = snapshot.cookies.map((c: Record<string, unknown>) => ({
        name: c.name as string,
        value: c.value as string,
        domain: c.domain as string | undefined,
        path: c.path as string | undefined,
      }));
      await page.context().addCookies(cookiesToAdd);
    }
    for (const [key, value] of Object.entries(snapshot.localStorage)) {
      await page.evaluate(
        ({k, v}: {k: string; v: string}) => {
          window.localStorage.setItem(k, v);
        },
        {k: key, v: value},
      );
    }
    for (const [key, value] of Object.entries(snapshot.sessionStorage)) {
      await page.evaluate(
        ({k, v}: {k: string; v: string}) => {
          window.sessionStorage.setItem(k, v);
        },
        {k: key, v: value},
      );
    }

    return {
      success: true,
      message: `会话已恢复: ${params.sessionId}`,
      tooltype: 'restore_session_state',
      logFormat: 'json',
      data: {
        sessionId: snapshot.id,
        restoredAt: new Date().toISOString(),
        url: snapshot.url,
        restored: {
          cookies: snapshot.cookies.length,
          localStorage: Object.keys(snapshot.localStorage).length,
          sessionStorage: Object.keys(snapshot.sessionStorage).length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `恢复会话失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'restore_session_state',
      logFormat: 'json',
    };
  }
}

/**
 * 列出所有内存中的会话快照（纯函数版本）。
 *
 * @param _runtime - Page 运行时服务（未使用）
 * @param _params - 参数（无参数）
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function listSessionStates(
  _runtime?: PageRuntimeServices,
  _params?: ListSessionStatesParams,
): Promise<ListSessionStatesResult> {
  ensureCleanupLoop();
  const removed = cleanupExpiredSessions();

  const sessions: ListSessionStatesData['sessions'] = Array.from(
    sessionSnapshots.values(),
  ).map(snapshot => ({
    sessionId: snapshot.id,
    savedAt: snapshot.savedAt,
    url: snapshot.url,
    title: snapshot.title,
    counts: {
      cookies: snapshot.cookies.length,
      localStorage: Object.keys(snapshot.localStorage).length,
      sessionStorage: Object.keys(snapshot.sessionStorage).length,
    },
    expiresAt: snapshot.expiresAt,
  }));

  return {
    success: true,
    message: `共 ${sessions.length} 个会话快照`,
    tooltype: 'list_session_states',
    logFormat: 'json',
    data: {
      total: sessions.length,
      cleanedExpired: removed,
      sessions,
    },
  };
}

/**
 * 删除一个内存中的会话快照（纯函数版本）。
 *
 * @param _runtime - Page 运行时服务（未使用）
 * @param params - 删除参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function deleteSessionState(
  _runtime: PageRuntimeServices,
  params: DeleteSessionStateParams,
): Promise<DeleteSessionStateResult> {
  ensureCleanupLoop();
  cleanupExpiredSessions();

  const deleted = sessionSnapshots.delete(params.sessionId);

  return {
    success: true,
    message: deleted
      ? `会话已删除: ${params.sessionId}`
      : `会话不存在: ${params.sessionId}`,
    tooltype: 'delete_session_state',
    logFormat: 'json',
    data: {
      sessionId: params.sessionId,
      deleted,
      remaining: sessionSnapshots.size,
    },
  };
}

/**
 * 导出会话快照为 JSON，可选写入文件（纯函数版本）。
 *
 * @param _runtime - Page 运行时服务（未使用）
 * @param params - 导出参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function dumpSessionState(
  _runtime: PageRuntimeServices,
  params: DumpSessionStateParams,
): Promise<DumpSessionStateResult> {
  try {
    ensureCleanupLoop();
    cleanupExpiredSessions();

    const snapshot = sessionSnapshots.get(params.sessionId);
    if (!snapshot) {
      return {
        success: false,
        message: `会话快照未找到: ${params.sessionId}`,
        tooltype: 'dump_session_state',
        logFormat: 'json',
        data: {
          sessionId: params.sessionId,
          path: null,
          bytes: 0,
          encrypted: false,
        },
      };
    }

    const pretty = params.pretty !== false;
    const rawJson = JSON.stringify(snapshot, null, pretty ? 2 : 0);
    const encryptedPayload =
      params.encrypt === true ? encryptText(rawJson) : null;
    const json = encryptedPayload
      ? JSON.stringify(encryptedPayload, null, pretty ? 2 : 0)
      : rawJson;

    if (params.path) {
      const safePath = validateOutputPath(params.path);
      await writeFile(safePath, json, 'utf8');
    }

    return {
      success: true,
      message: `会话已导出: ${params.sessionId}`,
      tooltype: 'dump_session_state',
      logFormat: 'json',
      data: {
        sessionId: snapshot.id,
        path: params.path ?? null,
        bytes: Buffer.byteLength(json, 'utf8'),
        encrypted: params.encrypt === true,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `导出会话失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'dump_session_state',
      logFormat: 'json',
      data: {
        sessionId: params.sessionId,
        path: params.path ?? null,
        bytes: 0,
        encrypted: params.encrypt === true,
      },
    };
  }
}

/**
 * 从 JSON 字符串或文件加载会话快照到内存（纯函数版本）。
 *
 * @param _runtime - Page 运行时服务（未使用）
 * @param params - 加载参数
 * @returns 结构化结果 { success, message, tooltype, logFormat, data }
 */
export async function loadSessionState(
  _runtime: PageRuntimeServices,
  params: LoadSessionStateParams,
): Promise<LoadSessionStateResult> {
  try {
    ensureCleanupLoop();
    cleanupExpiredSessions();

    // 如果仅提供 sessionId，尝试从内存获取
    if (!params.path && !params.snapshotJson && params.sessionId) {
      const existingSnapshot = sessionSnapshots.get(params.sessionId);
      if (existingSnapshot) {
        return {
          success: true,
          message: `会话已从内存加载: ${params.sessionId}`,
          tooltype: 'load_session_state',
          logFormat: 'json',
          data: {
            sessionId: params.sessionId,
            loaded: true,
            source: 'memory',
            counts: {
              cookies: existingSnapshot.cookies.length,
              localStorage: Object.keys(existingSnapshot.localStorage).length,
              sessionStorage: Object.keys(existingSnapshot.sessionStorage)
                .length,
            },
          },
        };
      }
      return {
        success: false,
        message: `会话快照未在内存中找到: ${params.sessionId}，请提供 path 或 snapshotJson`,
        tooltype: 'load_session_state',
        logFormat: 'json',
      };
    }

    const rawJson = params.path
      ? await readFile(validateOutputPath(params.path), 'utf8')
      : params.snapshotJson;
    if (!rawJson) {
      return {
        success: false,
        message: '必须提供 path 或 snapshotJson',
        tooltype: 'load_session_state',
        logFormat: 'json',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return {
        success: false,
        message: '无效的快照 JSON 内容',
        tooltype: 'load_session_state',
        logFormat: 'json',
      };
    }

    const normalizedRaw =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).encrypted === true &&
      (parsed as Record<string, unknown>).algorithm === 'aes-256-gcm'
        ? JSON.parse(decryptText(parsed as Parameters<typeof decryptText>[0]))
        : parsed;

    const snapshot = normalizeSnapshot(normalizedRaw, params.sessionId);
    const targetId = params.sessionId ?? snapshot.id;
    const existing = sessionSnapshots.has(targetId);
    if (existing && params.overwrite !== true) {
      return {
        success: false,
        message: `会话快照已存在: ${targetId}，设置 overwrite=true 覆盖`,
        tooltype: 'load_session_state',
        logFormat: 'json',
      };
    }

    const normalized = normalizeSnapshot({...snapshot, id: targetId}, targetId);
    sessionSnapshots.set(targetId, normalized);

    const source = params.path ? 'file' : 'json';
    return {
      success: true,
      message: `会话已加载: ${targetId}`,
      tooltype: 'load_session_state',
      logFormat: 'json',
      data: {
        sessionId: targetId,
        loaded: true,
        source,
        overwritten: existing,
        counts: {
          cookies: normalized.cookies.length,
          localStorage: Object.keys(normalized.localStorage).length,
          sessionStorage: Object.keys(normalized.sessionStorage).length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `加载会话失败: ${error instanceof Error ? error.message : String(error)}`,
      tooltype: 'load_session_state',
      logFormat: 'json',
    };
  }
}
