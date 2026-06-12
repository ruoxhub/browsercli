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
import {zod} from '../../third_party/index.js';
import {validateOutputPath} from '../../utils/fsSafe.js';
import {ToolCategory} from '../categories.js';
import {
  withOperationTimeout,
  normalizeBrowserRuntimeError,
} from '../shared/browserRuntime.js';
import {errorMessage, sendJson} from '../shared/pageResponse.js';
import {defineTool} from '../ToolDefinition.js';

import type {SessionSnapshot} from './types.js';

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

function prepareSessionStore(): number {
  ensureCleanupLoop();
  return cleanupExpiredSessions();
}

// ─── 加密辅助 ──────────────────────────────────────────

interface EncryptedPayload {
  encrypted: true;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

function getEncryptionKey(): Buffer | undefined {
  const configured = getEnvValue('SESSION_STATE_ENCRYPTION_KEY');
  if (!configured || configured.length === 0) {
    return undefined;
  }
  return createHash('sha256').update(configured).digest();
}

function encryptText(plainText: string): EncryptedPayload {
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

function decryptText(payload: EncryptedPayload): string {
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

// ─── defineTool 定义 ──────────────────────────────────────

/**
 * 保存当前页面会话状态到内存快照。
 */
export const saveSessionState = defineTool({
  name: 'save_session_state',
  description: '保存会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    sessionId: zod.string().optional().describe('会话 ID，省略则自动生成'),
    includeCookies: zod.boolean().optional().describe('是否包含 cookies'),
    includeLocalStorage: zod
      .boolean()
      .optional()
      .describe('是否包含 localStorage'),
    includeSessionStorage: zod
      .boolean()
      .optional()
      .describe('是否包含 sessionStorage'),
  },
  handler: async (request, response, _context) => {
    const {
      sessionId,
      includeCookies,
      includeLocalStorage,
      includeSessionStorage,
    } = request.params;
    try {
      prepareSessionStore();

      const page = _context.getSelectedPage();
      const sid = sessionId ?? `session_${Date.now()}`;
      const cookies = includeCookies
        ? await withOperationTimeout(page.context().cookies(), '读取 cookies')
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
        id: sid,
        savedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
        url: page.url(),
        title: await withOperationTimeout(page.title(), '读取页面标题'),
        cookies: cookies as unknown as Array<Record<string, unknown>>,
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
      };
      sessionSnapshots.set(sid, snapshot);

      sendJson(response, {
        success: true,
        message: `会话已保存: ${sid}`,
        tooltype: 'save_session_state',
        data: {
          sessionId: sid,
          savedAt: snapshot.savedAt,
          url: snapshot.url,
          title: snapshot.title,
          counts: {
            cookies: snapshot.cookies.length,
            localStorage: Object.keys(snapshot.localStorage).length,
            sessionStorage: Object.keys(snapshot.sessionStorage).length,
          },
        },
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `保存会话失败: ${normalizeBrowserRuntimeError(error)}`,
        tooltype: 'save_session_state',
      });
    }
  },
});

/**
 * 从内存快照恢复会话状态到当前页面。
 */
export const restoreSessionState = defineTool({
  name: 'restore_session_state',
  description: '恢复会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    sessionId: zod.string().describe('会话 ID'),
    navigateToSavedUrl: zod
      .boolean()
      .optional()
      .describe('是否导航到保存时的 URL'),
    clearStorageBeforeRestore: zod
      .boolean()
      .optional()
      .describe('恢复前是否清除现有存储'),
  },
  handler: async (request, response, _context) => {
    const {
      sessionId: sid,
      navigateToSavedUrl,
      clearStorageBeforeRestore,
    } = request.params;
    try {
      prepareSessionStore();

      const snapshot = sessionSnapshots.get(sid);
      if (!snapshot) {
        sendJson(response, {
          success: false,
          message: `会话快照未找到: ${sid}`,
          tooltype: 'restore_session_state',
        });
        return;
      }

      const page = _context.getSelectedPage();

      if (navigateToSavedUrl !== false) {
        await page.goto(snapshot.url, {waitUntil: 'networkidle'});
      }

      if (clearStorageBeforeRestore === true) {
        await page.evaluate(() => {
          window.localStorage.clear();
          window.sessionStorage.clear();
        });
        await page.context().clearCookies();
      }

      if (snapshot.cookies.length > 0) {
        const cookiesToAdd = snapshot.cookies.map(
          (c: Record<string, unknown>) => ({
            name: c.name as string,
            value: c.value as string,
            domain: c.domain as string | undefined,
            path: c.path as string | undefined,
          }),
        );
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

      sendJson(response, {
        success: true,
        message: `会话已恢复: ${sid}`,
        tooltype: 'restore_session_state',
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
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `恢复会话失败: ${errorMessage(error)}`,
        tooltype: 'restore_session_state',
      });
    }
  },
});

/**
 * 列出所有内存中的会话快照。
 */
export const listSessionStates = defineTool({
  name: 'list_session_states',
  description: '列出会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: true},
  schema: {},
  handler: async (_request, response, _context) => {
    const removed = prepareSessionStore();

    const sessions = Array.from(sessionSnapshots.values()).map(snapshot => ({
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

    sendJson(response, {
      success: true,
      message: `共 ${sessions.length} 个会话快照`,
      tooltype: 'list_session_states',
      data: {
        total: sessions.length,
        cleanedExpired: removed,
        sessions,
      },
    });
  },
});

/**
 * 删除一个内存中的会话快照。
 */
export const deleteSessionState = defineTool({
  name: 'delete_session_state',
  description: '删除会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    sessionId: zod.string().describe('会话 ID'),
  },
  handler: async (request, response, _context) => {
    const {sessionId: sid} = request.params;
    prepareSessionStore();

    const deleted = sessionSnapshots.delete(sid);

    sendJson(response, {
      success: true,
      message: deleted ? `会话已删除: ${sid}` : `会话不存在: ${sid}`,
      tooltype: 'delete_session_state',
      data: {
        sessionId: sid,
        deleted,
        remaining: sessionSnapshots.size,
      },
    });
  },
});

/**
 * 导出会话快照为 JSON，可选写入文件。
 */
export const dumpSessionState = defineTool({
  name: 'dump_session_state',
  description: '导出会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    sessionId: zod.string().describe('会话 ID'),
    path: zod.string().optional().describe('导出文件路径'),
    pretty: zod.boolean().optional().describe('是否美化输出'),
    encrypt: zod.boolean().optional().describe('是否加密'),
  },
  handler: async (request, response, _context) => {
    const {sessionId: sid, path, pretty, encrypt} = request.params;
    try {
      prepareSessionStore();

      const snapshot = sessionSnapshots.get(sid);
      if (!snapshot) {
        sendJson(response, {
          success: false,
          message: `会话快照未找到: ${sid}`,
          tooltype: 'dump_session_state',
          data: {
            sessionId: sid,
            path: null,
            bytes: 0,
            encrypted: false,
          },
        });
        return;
      }

      const isPretty = pretty !== false;
      const rawJson = JSON.stringify(snapshot, null, isPretty ? 2 : 0);
      const encryptedPayload = encrypt === true ? encryptText(rawJson) : null;
      const json = encryptedPayload
        ? JSON.stringify(encryptedPayload, null, isPretty ? 2 : 0)
        : rawJson;

      if (path) {
        const safePath = validateOutputPath(path);
        await writeFile(safePath, json, 'utf8');
      }

      sendJson(response, {
        success: true,
        message: `会话已导出: ${sid}`,
        tooltype: 'dump_session_state',
        data: {
          sessionId: snapshot.id,
          path: path ?? null,
          bytes: Buffer.byteLength(json, 'utf8'),
          encrypted: encrypt === true,
        },
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `导出会话失败: ${errorMessage(error)}`,
        tooltype: 'dump_session_state',
        data: {
          sessionId: sid,
          path: path ?? null,
          bytes: 0,
          encrypted: encrypt === true,
        },
      });
    }
  },
});

/**
 * 从 JSON 字符串或文件加载会话快照到内存。
 */
export const loadSessionState = defineTool({
  name: 'load_session_state',
  description: '加载会话状态',
  annotations: {category: ToolCategory.PAGES, readOnlyHint: false},
  schema: {
    sessionId: zod.string().optional().describe('会话 ID'),
    path: zod.string().optional().describe('从文件路径加载'),
    snapshotJson: zod.string().optional().describe('从 JSON 字符串加载'),
    overwrite: zod.boolean().optional().describe('是否覆盖已存在的快照'),
  },
  handler: async (request, response, _context) => {
    const {sessionId: sid, path, snapshotJson, overwrite} = request.params;
    try {
      prepareSessionStore();

      if (!path && !snapshotJson && sid) {
        const existingSnapshot = sessionSnapshots.get(sid);
        if (existingSnapshot) {
          sendJson(response, {
            success: true,
            message: `会话已从内存加载: ${sid}`,
            tooltype: 'load_session_state',
            data: {
              sessionId: sid,
              loaded: true,
              source: 'memory',
              counts: {
                cookies: existingSnapshot.cookies.length,
                localStorage: Object.keys(existingSnapshot.localStorage).length,
                sessionStorage: Object.keys(existingSnapshot.sessionStorage)
                  .length,
              },
            },
          });
          return;
        }
        sendJson(response, {
          success: false,
          message: `会话快照未在内存中找到: ${sid}，请提供 path 或 snapshotJson`,
          tooltype: 'load_session_state',
        });
        return;
      }

      const rawJson = path
        ? await readFile(validateOutputPath(path), 'utf8')
        : snapshotJson;
      if (!rawJson) {
        sendJson(response, {
          success: false,
          message: '必须提供 path 或 snapshotJson',
          tooltype: 'load_session_state',
        });
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        sendJson(response, {
          success: false,
          message: '无效的快照 JSON 内容',
          tooltype: 'load_session_state',
        });
        return;
      }

      const normalizedRaw =
        parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>).encrypted === true &&
        (parsed as Record<string, unknown>).algorithm === 'aes-256-gcm'
          ? JSON.parse(decryptText(parsed as EncryptedPayload))
          : parsed;

      const snapshot = normalizeSnapshot(normalizedRaw, sid);
      const targetId = sid ?? snapshot.id;
      const existing = sessionSnapshots.has(targetId);
      if (existing && overwrite !== true) {
        sendJson(response, {
          success: false,
          message: `会话快照已存在: ${targetId}，设置 overwrite=true 覆盖`,
          tooltype: 'load_session_state',
        });
        return;
      }

      const normalized = normalizeSnapshot(
        {...snapshot, id: targetId},
        targetId,
      );
      sessionSnapshots.set(targetId, normalized);

      const source = path ? 'file' : 'json';
      sendJson(response, {
        success: true,
        message: `会话已加载: ${targetId}`,
        tooltype: 'load_session_state',
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
      });
    } catch (error) {
      sendJson(response, {
        success: false,
        message: `加载会话失败: ${errorMessage(error)}`,
        tooltype: 'load_session_state',
      });
    }
  },
});
