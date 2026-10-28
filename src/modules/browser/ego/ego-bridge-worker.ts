/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Standalone CDP WebSocket bridge for the ego lite browser.
 *
 * This file executes inside ego lite's embedded Node runtime, not inside
 * browsercli's process, so it must stay dependency free: only `node:` built-ins
 * are imported and nothing from `src/` is referenced.
 *
 * ego lite exposes no TCP debugging port. It exposes raw CDP through the native
 * `globalThis.ego` binding (`sendCDPMessage` / `onCDPMessage`), which this worker
 * republishes as a standard CDP endpoint so Playwright/Patchright can
 * `connectOverCDP()` without any security approval prompt.
 */

import {createHash, randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {Duplex} from 'node:stream';

/** Line prefix the EgoBridgeManager parses off stdout. */
export const READY_PREFIX = '[ego-bridge:ready]';

const WS_ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 256 * 1024 * 1024;
/** Used when ego lite does not advertise a Chromium build. */
const FALLBACK_VERSION = '141.0.7390.0';
/** Chromium majors below this are ego app versions (0.6.1.13), not Chromium. */
const MIN_CHROMIUM_MAJOR = 100;
const V8_VERSION = '14.1';
/** Suffixes tried when a task-space name is already held by a user space. */
const MAX_TASK_SPACE_ATTEMPTS = 8;
/** Reported as `EGO_TASK_SPACE_NAME_IN_USE` when a name belongs to the user. */
const NAME_IN_USE = 'EGO_TASK_SPACE_NAME_IN_USE';
const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

/**
 * The `Target.*` events the client may see, and where each one carries the
 * target it is about. Deliberately an allow-list: an event shape not listed here
 * has no known target attribution, so it is dropped rather than guessed at.
 */
const TARGET_LIFECYCLE_EVENTS = new Map<
  string,
  (params: CdpParams | undefined) => unknown[]
>([
  [
    'Target.attachedToTarget',
    params => [params?.targetInfo?.targetId, params?.sessionId],
  ],
  [
    'Target.detachedFromTarget',
    params => [params?.sessionId, params?.targetId],
  ],
  ['Target.targetCreated', params => [params?.targetInfo?.targetId]],
  ['Target.targetInfoChanged', params => [params?.targetInfo?.targetId]],
  ['Target.targetDestroyed', params => [params?.targetId]],
]);

/** Client requests that make the native side attach to new targets. */
const WHITELIST_REFRESH_REQUESTS = new Set([
  'Target.setAutoAttach',
  'Target.setDiscoverTargets',
]);

/** The native bindings ego lite injects into its embedded Node runtime. */
export interface EgoNativeBindings {
  sendCDPMessage(message: string): void;
  onCDPMessage: ((message: string) => void) | undefined;
  onSendCDPMessageError:
    | ((message: string, errorCode?: string) => void)
    | undefined;
  getBrowserVersion?: () => unknown;
  listTabs?: () => Promise<unknown>;
  listTaskSpaces?: () => Promise<unknown>;
  createTaskSpace?: (name: string) => Promise<unknown>;
  useTaskSpace?: (id: number) => unknown;
  closeTaskSpace?: () => Promise<unknown>;
  completeTaskSpace?: () => Promise<unknown>;
}

/** Retention policy hook, shaped like ego-browser's `task.finish({keep})`. */
export type EgoTaskFinish = (options: {
  keep: 'all' | string[];
}) => Promise<unknown> | unknown;

export interface EgoBridgeOptions {
  ego: EgoNativeBindings;
  /** Defaults to `browsercli-<workspace hash>` derived from `process.cwd()`. */
  taskSpaceName?: string;
  keepPage?: boolean;
  /**
   * The target ids this bridge may forward `Target.*` events for.
   *
   * `undefined` (not supplied) disables the firewall — tests only. Supplied is
   * the production contract: the returned list is authoritative, so an empty
   * list means this space owns no tabs yet and every `Target.*` event is denied.
   * It is cached; see `refreshOwnTargets`.
   */
  listOwnTargetIds?: () => Promise<string[]>;
  /** injectable task-finish hook; defaults to the native lifecycle bindings */
  finishTask?: EgoTaskFinish;
  log?: (line: string) => void;
  /** injected so tests can drive the lifecycle without a live browser */
  onReady?: (wsEndpoint: string) => void;
}

export interface EgoBridge {
  /** resolves once the socket is listening; wsEndpoint matches ws://127.0.0.1:<port>/devtools/browser/<guid> */
  start(): Promise<{wsEndpoint: string}>;
  /** runs the cleanup policy (task.finish({keep:...})) then closes the server; idempotent */
  stop(): Promise<void>;
}

interface WsClient {
  send(text: string): void;
  close(): void;
}

interface CdpParams {
  sessionId?: unknown;
  targetId?: unknown;
  targetInfo?: {targetId?: unknown};
}

interface CdpMessage {
  id?: unknown;
  method?: unknown;
  sessionId?: unknown;
  params?: CdpParams;
}

interface EgoTaskSpace {
  id?: unknown;
  name?: unknown;
  error?: unknown;
  error_code?: unknown;
  ownership?: unknown;
}

function toText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function readVersion(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  const version = (value as {currentVersion?: unknown} | null | undefined)
    ?.currentVersion;
  return typeof version === 'string' && version.length > 0
    ? version
    : undefined;
}

/**
 * The Chromium build this bridge reports to Patchright.
 *
 * `ego.getBrowserVersion()` reports ego's own app version (e.g. `0.6.1.13`).
 * Patchright parses the major out of `product` and gates protocol behaviour on
 * it (`majorVersion() >= 143`), so an ego app version would make every such
 * branch permanently false. Only a plausible Chromium major is trusted here;
 * anything else falls back to a real Chromium build.
 */
function chromiumVersionString(version: string | undefined): string {
  if (version === undefined) return FALLBACK_VERSION;
  const [major] = version.split('.');
  return major !== undefined &&
    /^\d+$/.test(major) &&
    Number(major) >= MIN_CHROMIUM_MAJOR
    ? version
    : FALLBACK_VERSION;
}

function chromiumMajor(version: string): string {
  return version.split('.')[0] ?? FALLBACK_VERSION;
}

/** Patchright's `_platform()` reads the UA, so it has to match the real host. */
function platformUserAgentToken(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Macintosh; Intel Mac OS X 10_15_7';
    case 'win32':
      return 'Windows NT 10.0; Win64; x64';
    default:
      return 'X11; Linux x86_64';
  }
}

/** Stable task-space name for a workspace directory. */
export function workspaceTaskSpaceName(cwd: string): string {
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
  return `browsercli-${hash}`;
}

/**
 * `listOwnTargetIds` backed by `ego.listTabs()`, which is task-space scoped and
 * therefore returns exactly the tabs this agent owns.
 *
 * ego resolves `{error, error_code}` (rather than throwing) when the user holds
 * control; that means the agent may see none of them, so it maps to an empty
 * list — which denies every `Target.*` event.
 */
export async function listTabsOwnTargetIds(
  ego: EgoNativeBindings,
): Promise<string[]> {
  if (typeof ego.listTabs !== 'function') return [];
  const result = (await ego.listTabs()) as
    | {tabs?: unknown; error?: unknown}
    | null
    | undefined;
  if (!result || result.error !== undefined) return [];
  if (!Array.isArray(result.tabs)) return [];
  const ids: string[] = [];
  for (const tab of result.tabs) {
    const targetId = asString(
      (tab as {targetId?: unknown} | undefined)?.targetId,
    );
    if (targetId !== undefined) ids.push(targetId);
  }
  return ids;
}

/**
 * Minimal RFC6455 server side: client frames are always masked, server frames
 * are never masked, and text payloads may arrive as continuation frames.
 * No extension is negotiated, so `permessage-deflate` never appears here.
 */
function serveWebSocket(
  socket: Duplex,
  onText: (text: string) => void,
  log: (line: string) => void,
): WsClient {
  let buffer: Buffer = Buffer.alloc(0);
  let fragments: Buffer[] = [];

  const write = (opcode: number, payload: Buffer) => {
    if (!socket.destroyed) socket.write(encodeFrame(opcode, payload));
  };

  const handleFrame = (fin: boolean, opcode: number, payload: Buffer) => {
    if (opcode === OPCODE.ping) {
      write(OPCODE.pong, payload);
      return;
    }
    if (opcode === OPCODE.pong) return;
    if (opcode === OPCODE.close) {
      write(OPCODE.close, payload.subarray(0, 2));
      socket.end();
      return;
    }
    if (opcode === OPCODE.text || opcode === OPCODE.binary) {
      fragments = [];
    } else if (opcode !== OPCODE.continuation) {
      log(`[ego-bridge] ignoring websocket opcode 0x${opcode.toString(16)}`);
      return;
    }
    fragments.push(payload);
    if (!fin) return;
    const text = Buffer.concat(fragments).toString('utf8');
    fragments = [];
    onText(text);
  };

  const drain = () => {
    while (!socket.destroyed && buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const wide = buffer.readBigUInt64BE(2);
        if (wide > BigInt(MAX_FRAME_BYTES)) {
          log('[ego-bridge] closing connection on oversized frame');
          socket.destroy();
          return;
        }
        length = Number(wide);
        offset = 10;
      }
      if (masked) offset += 4;
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      if (masked) {
        const mask = buffer.subarray(offset - 4, offset);
        for (let index = 0; index < payload.length; index++) {
          payload[index] ^= mask[index % 4];
        }
      }
      buffer = buffer.subarray(offset + length);
      handleFrame(fin, opcode, payload);
    }
  };

  socket.on('data', (chunk: Buffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    try {
      drain();
    } catch (error) {
      log(`[ego-bridge] websocket read failed: ${toText(error)}`);
      socket.destroy();
    }
  });
  socket.on('error', error => {
    log(`[ego-bridge] websocket error: ${toText(error)}`);
  });

  return {
    send(text: string) {
      write(OPCODE.text, Buffer.from(text, 'utf8'));
    },
    close() {
      write(OPCODE.close, Buffer.alloc(0));
      socket.end();
    },
  };
}

export function createEgoBridge(options: EgoBridgeOptions): EgoBridge {
  const ego = options.ego;
  const log = options.log ?? (() => undefined);
  const keepPage = options.keepPage === true;
  const listOwnTargetIds = options.listOwnTargetIds;
  const firewallEnabled = listOwnTargetIds !== undefined;
  const taskSpaceName =
    options.taskSpaceName ?? workspaceTaskSpaceName(process.cwd());

  const clients = new Set<WsClient>();
  /** requests forwarded to ego and still waiting for their response */
  const inFlight = new Map<number, string | undefined>();
  /** keeps native events in arrival order even while they are filtered */
  let nativeQueue: Promise<void> = Promise.resolve();
  /** cached result of `listOwnTargetIds`; refreshed, never read synchronously */
  let ownTargetIds: Set<string> | undefined;
  /** ids this bridge already forwarded, so a later close event is not lost */
  const knownOwnTargetIds = new Set<string>();
  /**
   * Negative verdicts keyed by target id, valid until the next explicit refresh.
   * They keep repeated events for the same foreign target off the native channel,
   * and are dropped by an explicit refresh so a tab that only shows up in
   * `listTabs` later is not blacklisted forever.
   */
  const judgedForeign = new Set<string>();
  let refreshInFlight: Promise<void> | undefined;
  /** one lazy refresh per burst of native events, never one per event */
  let lazyRefreshAvailable = true;
  let pendingNativeEvents = 0;

  let server: Server | undefined;
  let guid = '';
  let started: Promise<{wsEndpoint: string}> | undefined;
  /** set synchronously by `stop()`, so an in-flight `start()` can abort */
  let stopRequested = false;
  let stopping: Promise<void> | undefined;

  const broadcast = (text: string) => {
    for (const client of clients) client.send(text);
  };

  const replyWithError = (
    id: number,
    sessionId: string | undefined,
    message: string,
  ) => {
    const reply: Record<string, unknown> = {
      id,
      error: {code: -32000, message},
    };
    if (sessionId) reply.sessionId = sessionId;
    broadcast(JSON.stringify(reply));
  };

  const rejectInFlight = (message: string) => {
    const pending = [...inFlight.entries()];
    inFlight.clear();
    for (const [id, sessionId] of pending) {
      replyWithError(id, sessionId, message);
    }
  };

  const browserVersion = async (): Promise<Record<string, string>> => {
    let reported: string | undefined;
    try {
      reported = readVersion(await ego.getBrowserVersion?.());
    } catch (error) {
      log(`[ego-bridge] getBrowserVersion failed: ${toText(error)}`);
    }
    const chromium = chromiumVersionString(reported);
    const major = chromiumMajor(chromium);
    const result: Record<string, string> = {
      protocolVersion: '1.3',
      product: `Chrome/${major}`,
      revision: chromium,
      userAgent: `Mozilla/5.0 (${platformUserAgentToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromium} Safari/537.36`,
      jsVersion: V8_VERSION,
    };
    // Non-standard extra field: keeps ego's own app version recoverable.
    if (reported !== undefined) result.egoVersion = reported;
    return result;
  };

  const routeFromClient = (raw: string) => {
    let request: CdpMessage;
    try {
      request = JSON.parse(raw);
    } catch {
      log('[ego-bridge] dropping non-JSON CDP message from client');
      return;
    }
    if (request.method === 'Browser.getVersion') {
      // ego lite has no Browser domain; answering locally keeps the
      // Patchright connectOverCDP handshake from crashing. The reply must carry
      // the request's sessionId, or the client routes it to the wrong session.
      const {id, sessionId} = request;
      void browserVersion().then(result => {
        const reply: Record<string, unknown> = {id, result};
        if (typeof sessionId === 'string') reply.sessionId = sessionId;
        broadcast(JSON.stringify(reply));
      });
      return;
    }
    if (
      typeof request.method === 'string' &&
      WHITELIST_REFRESH_REQUESTS.has(request.method)
    ) {
      // The reply is about to make ego attach to targets; warm the cache now so
      // the attach events do not each wait for a native round-trip.
      void refreshOwnTargets(true);
    }
    if (typeof request.id === 'number') {
      inFlight.set(
        request.id,
        typeof request.sessionId === 'string' ? request.sessionId : undefined,
      );
    }
    try {
      // Byte-for-byte: the client's own JSON text is what ego receives, so the
      // `sessionId` of a flattened-target request survives untouched.
      ego.sendCDPMessage(raw);
    } catch (error) {
      log(`[ego-bridge] sendCDPMessage threw: ${toText(error)}`);
      rejectInFlight(`EGO_CDP_SEND_FAILED: ${toText(error)}`);
    }
  };

  /**
   * Reload the target whitelist into the cache.
   *
   * `routeFromNative` reads a cache and never pays a native round-trip per
   * event: it refreshes here at most once per burst of native events (and always
   * on an explicit `Target.setAutoAttach` / `Target.setDiscoverTargets`).
   * A failed read is fail-closed: an empty whitelist denies every `Target.*`
   * event.
   */
  const refreshOwnTargets = (resetForeign = false): Promise<void> => {
    if (!listOwnTargetIds) return Promise.resolve();
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const ids = await listOwnTargetIds();
        const next = new Set<string>();
        if (Array.isArray(ids)) {
          for (const id of ids) {
            const text = asString(id);
            if (text !== undefined) next.add(text);
          }
        }
        ownTargetIds = next;
        if (resetForeign) judgedForeign.clear();
        for (const id of next) judgedForeign.delete(id);
      } catch (error) {
        log(`[ego-bridge] target whitelist unavailable: ${toText(error)}`);
        ownTargetIds = new Set();
      } finally {
        refreshInFlight = undefined;
      }
    })();
    return refreshInFlight;
  };

  const isOwnTargetId = (id: string): boolean =>
    knownOwnTargetIds.has(id) || ownTargetIds?.has(id) === true;

  /**
   * Latch the ids of a forwarded event: `detachedFromTarget` may carry only the
   * `sessionId` of the earlier attach, and `listTabs` reports target ids, so the
   * session id has to be remembered here to keep the detach forwardable.
   */
  const remember = (ids: string[]) => {
    if (!firewallEnabled) return;
    for (const id of ids) {
      knownOwnTargetIds.add(id);
      judgedForeign.delete(id);
    }
  };

  /**
   * Whether a native `Target.*` event may reach the client.
   *
   * Allow-list: unlisted `Target.*` events are dropped, because there is no
   * target id to attribute them to. With the firewall on, an event whose ids are
   * all unknown is dropped after one coalesced whitelist refresh.
   */
  const allowTargetEvent = async (
    method: string,
    params: CdpParams | undefined,
  ): Promise<boolean> => {
    const readIds = TARGET_LIFECYCLE_EVENTS.get(method);
    if (!readIds) {
      log(`[ego-bridge] dropped ${method}: not an attributable Target event`);
      return false;
    }
    const ids: string[] = [];
    for (const value of readIds(params)) {
      const id = asString(value);
      if (id !== undefined) ids.push(id);
    }
    if (ids.length === 0) {
      log(`[ego-bridge] dropped ${method} without a target id`);
      return false;
    }
    if (!firewallEnabled) {
      remember(ids);
      return true;
    }
    if (ids.some(isOwnTargetId)) {
      remember(ids);
      return true;
    }
    if (!ids.every(id => judgedForeign.has(id)) && lazyRefreshAvailable) {
      // One native round-trip per burst of native events, never one per event:
      // the verdicts below then keep the whole burst off the serialized queue.
      lazyRefreshAvailable = false;
      await refreshOwnTargets();
      if (ids.some(isOwnTargetId)) {
        remember(ids);
        return true;
      }
      for (const id of ids) judgedForeign.add(id);
    }
    log(`[ego-bridge] dropped ${method} outside the task space`);
    return false;
  };

  const routeFromNative = async (raw: string) => {
    let event: CdpMessage;
    try {
      event = JSON.parse(raw);
    } catch {
      log('[ego-bridge] dropping non-JSON CDP message from ego');
      return;
    }
    if (typeof event.id === 'number') inFlight.delete(event.id);
    const method = asString(event.method);
    if (method !== undefined && method.startsWith('Target.')) {
      // The user's own tabs must never surface in the client's context.pages().
      if (!(await allowTargetEvent(method, event.params))) return;
    }
    broadcast(raw);
  };

  const onNativeMessage = (message: string) => {
    if (pendingNativeEvents === 0) lazyRefreshAvailable = true;
    pendingNativeEvents += 1;
    nativeQueue = nativeQueue
      .then(() => routeFromNative(message))
      .catch(error => {
        log(`[ego-bridge] native message routing failed: ${toText(error)}`);
      })
      .finally(() => {
        pendingNativeEvents -= 1;
      });
  };

  const onNativeSendError = (message: string, errorCode?: string) => {
    const reason = `${errorCode ?? 'EGO_CDP_SEND_FAILED'}: ${message}`;
    log(`[ego-bridge] sendCDPMessage failed: ${reason}`);
    // Everything in flight is rejected, not just the id native blamed: the
    // native error carries no request id, and a hung caller is worse than a
    // spurious failure that the client can retry.
    rejectInFlight(reason);
  };

  /**
   * Cleanup policy: `keep: []` closes the agent's task space, `keep: 'all'`
   * leaves the page open for the user. Never throws — a failed cleanup must not
   * keep the worker from releasing its socket.
   */
  const finishTask = async () => {
    const keep: 'all' | string[] = keepPage ? 'all' : [];
    const native = keepPage ? ego.completeTaskSpace : ego.closeTaskSpace;
    const finish: EgoTaskFinish | undefined =
      options.finishTask ??
      (typeof native === 'function' ? () => native.call(ego) : undefined);
    if (!finish) {
      log('[ego-bridge] task finish unavailable; skipping cleanup');
      return;
    }
    try {
      await finish({keep});
    } catch (error) {
      log(`[ego-bridge] task finish failed: ${toText(error)}`);
    }
  };

  const isAgentOwned = (ownership: unknown): boolean =>
    ownership === 'agent' || ownership === 'agentDelegatedToUser';

  /**
   * The known task-space names: agent-owned ones are reusable, user-owned ones
   * are off limits and get skipped without even asking native to create them.
   */
  const knownTaskSpaces = async (): Promise<{
    reusable: Map<string, number>;
    userOwned: Set<string>;
  }> => {
    const reusable = new Map<string, number>();
    const userOwned = new Set<string>();
    if (typeof ego.listTaskSpaces !== 'function') return {reusable, userOwned};
    try {
      const result = (await ego.listTaskSpaces()) as
        | {taskSpaces?: unknown}
        | null
        | undefined;
      if (!Array.isArray(result?.taskSpaces)) return {reusable, userOwned};
      for (const raw of result.taskSpaces) {
        const space = raw as EgoTaskSpace | undefined;
        const name = asString(space?.name);
        if (name === undefined) continue;
        if (isAgentOwned(space?.ownership)) {
          if (typeof space?.id === 'number') reusable.set(name, space.id);
          continue;
        }
        if (space?.ownership === 'user') userOwned.add(name);
      }
    } catch (error) {
      log(`[ego-bridge] listTaskSpaces failed: ${toText(error)}`);
    }
    return {reusable, userOwned};
  };

  /**
   * Enter this workspace's own task space.
   *
   * Reuses `browsercli-<workspace-hash>` when the agent already owns it. A name
   * held by a user-owned space is never taken over: `EGO_TASK_SPACE_NAME_IN_USE`
   * moves to `-2`, `-3`, ... and a fresh space is created instead. Failing to
   * enter a space at all throws, so `start()` rejects instead of printing a
   * ready line for a bridge whose every command would fail with
   * `EGO_TASK_SPACE_NOT_SELECTED`.
   */
  const enterTaskSpace = async (): Promise<void> => {
    if (
      typeof ego.createTaskSpace !== 'function' ||
      typeof ego.useTaskSpace !== 'function'
    ) {
      throw new Error(
        'ego task-space bindings unavailable (createTaskSpace/useTaskSpace)',
      );
    }
    const {reusable, userOwned} = await knownTaskSpaces();
    for (let attempt = 1; attempt <= MAX_TASK_SPACE_ATTEMPTS; attempt++) {
      const name =
        attempt === 1 ? taskSpaceName : `${taskSpaceName}-${attempt}`;
      const existing = reusable.get(name);
      if (existing !== undefined) {
        ego.useTaskSpace(existing);
        log(`[ego-bridge] reusing task space ${name} (${existing})`);
        return;
      }
      if (userOwned.has(name)) {
        // Never take over a user's space: move straight to the next suffix.
        log(
          `[ego-bridge] task space name ${name} belongs to the user; trying a new suffix`,
        );
        continue;
      }
      let space: EgoTaskSpace | undefined;
      try {
        space = (await ego.createTaskSpace(name)) as EgoTaskSpace | undefined;
      } catch (error) {
        const code = (error as {error_code?: unknown} | null)?.error_code;
        if (code === NAME_IN_USE)
          space = {error: toText(error), error_code: code};
        else throw error;
      }
      if (space?.error === undefined) {
        const id = space?.id;
        if (typeof id !== 'number') {
          throw new Error(
            `ego.createTaskSpace(${name}) returned no task space id`,
          );
        }
        ego.useTaskSpace(id);
        log(`[ego-bridge] created task space ${name} (${id})`);
        return;
      }
      if (space.error_code !== NAME_IN_USE) {
        throw new Error(
          `ego task space ${name} unavailable: ${String(space.error)} (${String(space.error_code ?? 'unknown')})`,
        );
      }
      log(
        `[ego-bridge] task space name ${name} belongs to the user; trying the next suffix`,
      );
    }
    throw new Error(
      `could not enter a task space named ${taskSpaceName} after ${MAX_TASK_SPACE_ATTEMPTS} attempts`,
    );
  };

  const handleUpgrade = (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers['sec-websocket-key'];
    if (
      request.url !== `/devtools/browser/${guid}` ||
      request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      typeof key !== 'string'
    ) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    // Never echo Sec-WebSocket-Extensions: this server only speaks uncompressed
    // frames, and Chrome/Patchright would otherwise negotiate deflate.
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${createHash('sha1')
          .update(key + WS_ACCEPT_GUID)
          .digest('base64')}`,
        '',
        '',
      ].join('\r\n'),
    );
    const client = serveWebSocket(socket, routeFromClient, log);
    clients.add(client);
    socket.on('close', () => clients.delete(client));
  };

  /** Release everything `start()` may already have created; idempotent. */
  const releaseListener = async (): Promise<void> => {
    const listening = server;
    server = undefined;
    for (const client of clients) client.close();
    clients.clear();
    if (!listening) return;
    await new Promise<void>(resolve => {
      listening.close(() => resolve());
      listening.closeAllConnections?.();
    });
  };

  const releaseCallbacks = () => {
    // Release only the callbacks this bridge installed.
    if (ego.onCDPMessage === onNativeMessage) ego.onCDPMessage = undefined;
    if (ego.onSendCDPMessageError === onNativeSendError) {
      ego.onSendCDPMessageError = undefined;
    }
  };

  const abortIfStopping = () => {
    if (stopRequested) throw new Error('ego bridge stopped during start');
  };

  const releaseCallbacksAndListener = async (): Promise<void> => {
    releaseCallbacks();
    await releaseListener();
  };

  const start = (): Promise<{wsEndpoint: string}> => {
    if (started) return started;
    if (stopRequested) {
      return Promise.reject(new Error('ego bridge is stopped'));
    }
    started = (async () => {
      try {
        await enterTaskSpace();
        abortIfStopping();
        await refreshOwnTargets(true);
        abortIfStopping();
        guid = randomUUID();
        const listening = createServer((_request, response) => {
          response.writeHead(404, {'content-type': 'text/plain'});
          response.end('ego-bridge: websocket endpoint only');
        });
        listening.on('upgrade', handleUpgrade);
        server = listening;
        await new Promise<void>((resolve, reject) => {
          listening.once('error', reject);
          listening.listen(0, '127.0.0.1', () => {
            listening.removeListener('error', reject);
            resolve();
          });
        });
        abortIfStopping();
        const address = listening.address();
        if (!address || typeof address === 'string') {
          throw new Error('ego bridge failed to bind a loopback port');
        }
        const wsEndpoint = `ws://127.0.0.1:${address.port}/devtools/browser/${guid}`;
        ego.onCDPMessage = onNativeMessage;
        ego.onSendCDPMessageError = onNativeSendError;
        options.onReady?.(wsEndpoint);
        return {wsEndpoint};
      } catch (error) {
        await releaseCallbacksAndListener();
        throw error;
      }
    })();
    return started;
  };

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopRequested = true;
    stopping = (async () => {
      // Let an in-flight start() observe the flag and release its own socket
      // before tearing down, so the port can never outlive stop().
      const pending = started;
      if (pending) await pending.catch(() => undefined);
      await finishTask();
      await releaseCallbacksAndListener();
    })();
    return stopping;
  };

  return {start, stop};
}

/**
 * True when a test file imported this module. Deliberately keyed on the process
 * entry point rather than `NODE_ENV`: a manager-spawned ego process inherits the
 * parent's environment, so an inherited `NODE_ENV=test` must not disable the
 * real autostart path.
 */
function importedByTest(): boolean {
  const entry = process.argv[1] ?? '';
  return (
    /(?:^|[\\/])tests[\\/]/.test(entry) || /\.test\.[cm]?[jt]s$/.test(entry)
  );
}

function autostart(ego: EgoNativeBindings): void {
  const bridge = createEgoBridge({
    ego,
    taskSpaceName:
      process.env.EGO_BRIDGE_TASK_SPACE_NAME ??
      workspaceTaskSpaceName(process.cwd()),
    keepPage: process.env.EGO_BRIDGE_KEEP_PAGE === '1',
    // Production always supplies a whitelist: without one the firewall would be
    // off and the user's private tabs would reach the client.
    listOwnTargetIds: () => listTabsOwnTargetIds(ego),
    log: line => process.stdout.write(`${line}\n`),
    onReady: wsEndpoint => {
      process.stdout.write(`${READY_PREFIX} ${wsEndpoint}\n`);
    },
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void bridge.stop().finally(() => process.exit(0));
  };
  // The manager passes the bootstrap code with `-e`, so stdin carries no script:
  // EOF on it unambiguously means the parent process is gone.
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.resume();

  void bridge.start().catch(error => {
    process.stdout.write(`[ego-bridge:fatal] ${toText(error)}\n`);
    process.exit(1);
  });
}

const nativeEgo = (globalThis as {ego?: EgoNativeBindings}).ego;
if (
  nativeEgo &&
  typeof nativeEgo.sendCDPMessage === 'function' &&
  !importedByTest()
) {
  autostart(nativeEgo);
}
