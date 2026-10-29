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
import fs from 'node:fs';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {Duplex} from 'node:stream';

/**
 * Line prefix the EgoBridgeManager looks for in its readiness sink file.
 *
 * The manager cannot read this off a pipe: ego lite's embedded runtime does not
 * stream `process.stdout` to the parent while it is alive, so the bootstrap
 * shim redirects stdout into a file and the manager polls that file instead.
 */
export const READY_PREFIX = '[ego-bridge:ready]';

/** Default parent-liveness poll interval, overridable for fast tests. */
const DEFAULT_LIVENESS_POLL_MS = 1_000;

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

/**
 * Events whose *message-level* `sessionId` attributes them to a target this
 * bridge already forwarded.
 *
 * In flattened mode a child target (an OOPIF iframe, a dedicated worker) is
 * announced on the session of the page that owns it, while `ego.listTabs()`
 * only reports top-level tabs — so the child's own id can never match the
 * whitelist. The parent's session id is latched by `remember()` when its attach
 * was forwarded, and that is the only thing that may authorize a child event.
 * `Target.targetCreated` / `targetInfoChanged` / `targetDestroyed` carry no
 * trustworthy owning-session attribution and stay params-only (fail closed).
 */
const SESSION_ATTRIBUTED_EVENTS = new Set([
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
]);

/** Client requests that make the native side attach to new targets. */
const WHITELIST_REFRESH_REQUESTS = new Set([
  'Target.setAutoAttach',
  'Target.setDiscoverTargets',
]);

/**
 * `Browser.*` methods ego does not implement, and what answering them locally
 * costs. ego has no Browser domain at all, so Patchright's own browser-level
 * calls fail with `-32601 '<method>' wasn't found` and abort whatever it was
 * doing — the connect handshake, context initialisation, or a download.
 *
 * Every method here returns an empty object in real CDP, so `{}` is the honest
 * reply shape and Patchright does not read a value from any of them. The table
 * is an explicit allow-list on purpose: a catch-all would answer methods whose
 * results Patchright DOES read (`Browser.getWindowForTarget` returns
 * `{windowId, bounds}`), turning a clean "method not found" into an undefined
 * destructuring further downstream.
 *
 * Each row also names the capability being given up, because the reply itself
 * cannot: the client is told its request succeeded. `degraded` capabilities are
 * reported to the client over `EGO_BRIDGE_DEGRADED_METHOD`, not just logged —
 * see `degradedMethods`.
 *
 * If ego ever implements the Browser domain, these four stay shadowed here; this
 * table is the thing to delete when that happens.
 */
const BROWSER_DOMAIN_FALLBACKS: Record<
  string,
  {result: Record<string, unknown>; degraded: string}
> = {
  // Patchright sends this once per context with the client's download policy
  // (`allowAndName`/`deny`, `downloadPath`, `eventsEnabled`). ego has no switch
  // to apply it, so the policy is NOT enforced: downloads land wherever ego
  // puts them and no Download event is delivered. This is the one row where the
  // client's own intent is dropped, so it is called out by name.
  'Browser.setDownloadBehavior': {
    result: {},
    degraded:
      'download policy NOT applied: the client asked for a specific download behaviour and ego ignored it',
  },
  'Browser.grantPermissions': {
    result: {},
    degraded: 'browser permissions cannot be granted through the bridge',
  },
  'Browser.resetPermissions': {
    result: {},
    degraded: 'browser permissions cannot be reset through the bridge',
  },
  'Browser.cancelDownload': {
    result: {},
    degraded: 'downloads cannot be cancelled through the bridge',
  },
};

/**
 * Name of the synthesized CDP event that carries a degraded `Browser.*` method
 * to the client.
 *
 * The human-readable log is not enough: the worker's stderr only reaches a
 * caller through `stderrTail()` on an ERROR path, so in a healthy session a
 * silently dropped download policy was invisible to the MCP client that relied
 * on it. Events reach the client unconditionally, so the gap travels with the
 * session.
 */
export const DEGRADED_METHOD_EVENT = 'EGO_BRIDGE_DEGRADED_METHOD';

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
  /**
   * Turns a listed Space into an agent-owned task space without creating a
   * replacement one. Required to reclaim the bridge's own leftovers: after
   * `completeTaskSpace()` ego reports them as `ownership: 'user'`, and both
   * `useTaskSpace()` and `closeTaskSpace()` refuse them
   * (`EGO_TASK_SPACE_INACTIVE`) until they are claimed back.
   */
  claimTaskSpace?: (id: number) => Promise<unknown>;
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
  /**
   * Diagnostic sink. Must not be stdout in production: stdout is the ready-line
   * channel the manager parses.
   */
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
  /**
   * `'agent'` for a space the bridge created, `'user'` for one a human made in
   * the ego UI. This is the only field that survives `completeTaskSpace()` and
   * still tells the two apart, so it is what licenses a reclaim.
   */
  createdBy?: unknown;
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

/** How this run entered its task space; only `'created'` licenses destroying it. */
type SpaceOrigin = 'created' | 'reused' | 'reclaimed';

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
  /** the cleanup policy ran (or is running); see `finishTask` */
  let finished = false;
  /** `enterTaskSpace()` succeeded, so the cleanup policy has a space to release */
  let spaceEntered = false;
  /**
   * How this run entered its task space — the one thing that licenses
   * destroying it. A single value rather than a pair of flags, so the retention
   * decision in `finishTask` cannot be re-derived as a disjunction of exceptions.
   */
  let spaceOrigin: SpaceOrigin | undefined;
  /** Browser-domain methods already reported as degraded, so the log stays bounded. */
  const degradedBrowserMethods = new Set<string>();

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

  const replyWithResult = (
    id: unknown,
    sessionId: unknown,
    result: Record<string, unknown>,
  ) => {
    const reply: Record<string, unknown> = {id, result};
    if (typeof sessionId === 'string') reply.sessionId = sessionId;
    broadcast(JSON.stringify(reply));
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
      void browserVersion().then(result =>
        replyWithResult(id, sessionId, result),
      );
      return;
    }
    if (typeof request.method === 'string') {
      const fallback = BROWSER_DOMAIN_FALLBACKS[request.method];
      if (fallback) {
        // Once per method per run: context init repeats the same call.
        if (!degradedBrowserMethods.has(request.method)) {
          degradedBrowserMethods.add(request.method);
          log(
            `[ego-bridge] ${request.method} answered locally: ${fallback.degraded}`,
          );
          // The reply says "succeeded"; only this event says what was lost, and
          // events reach the client even when the session stays healthy.
          broadcast(
            JSON.stringify({
              method: DEGRADED_METHOD_EVENT,
              params: {
                method: request.method,
                degraded: fallback.degraded,
              },
            }),
          );
        }
        replyWithResult(request.id, request.sessionId, fallback.result);
        return;
      }
    }
    if (
      typeof request.method === 'string' &&
      WHITELIST_REFRESH_REQUESTS.has(request.method) &&
      // Patchright also sends these on every page session (crPage.js), and a
      // per-page auto-attach cannot surface a new top-level tab, so those
      // repeats would cost a native `listTabs()` round-trip per page init for
      // nothing. Only the browser-level call (no `sessionId`) refreshes.
      request.sessionId === undefined
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
   *
   * Scope note: `listOwnTargetIds` is task-space scoped, so this list is exactly
   * "the tabs of the space this bridge is in". For a space this run created that
   * is the same thing as "the tabs this bridge opened". For a RECLAIMED space it
   * is not: the tabs the user left in a retained scene are in that space too, so
   * they enter the whitelist and become reachable by the MCP-side client. That is
   * the documented contract (`createdBy: 'agent'` means the bridge made the
   * space) and it is what `--keep-page` is for, but it moves the fence boundary
   * in a way that only exists because reclaim exists — see the log emitted in
   * `start()` when a reclaim brings pre-existing tabs in.
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
   * target id to attribute them to. Ids come from `params` and, for the events
   * whose message-level `sessionId` says which target they were emitted on, from
   * that session as well. With the firewall on, an event whose ids are all
   * unknown is dropped after one coalesced whitelist refresh.
   */
  const allowTargetEvent = async (
    method: string,
    event: CdpMessage,
  ): Promise<boolean> => {
    const readIds = TARGET_LIFECYCLE_EVENTS.get(method);
    if (!readIds) {
      log(`[ego-bridge] dropped ${method}: not an attributable Target event`);
      return false;
    }
    const ids: string[] = [];
    for (const value of readIds(event.params)) {
      const id = asString(value);
      if (id !== undefined) ids.push(id);
    }
    if (SESSION_ATTRIBUTED_EVENTS.has(method)) {
      // Flattened child targets (OOPIF iframes, dedicated workers) are announced
      // on the session of the page that owns them, and their ids never appear in
      // `listTabs()`. The owning session is latched by `remember()` when that
      // page's attach was forwarded, so a recorded session is proof of ownership;
      // an unknown session proves nothing and stays dropped.
      const ownerSessionId = asString(event.sessionId);
      if (ownerSessionId !== undefined) ids.push(ownerSessionId);
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
      if (!(await allowTargetEvent(method, event))) return;
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
   *
   * Runs at most once, because both a failed `start()` and `stop()` call it: the
   * space is created before most startup failures, so a bridge that dies in
   * `start()` still owns it and has to release it. Without the guard the space
   * would be completed/closed twice.
   */
  const finishTask = async () => {
    if (finished) return;
    // Latched before the guards below run. That is only safe because every caller
    // waits for a pending `start()` first (`stop()` awaits `started`; the failed
    // start path is already inside `start`), so `spaceEntered`/`spaceOrigin`
    // are settled by the time this latches. A third caller that skipped that
    // await would latch `finished` against a half-visited space and the cleanup
    // would silently never run.
    finished = true;
    // Only a bridge that actually entered a space has anything to release.
    // `closeTaskSpace()` acts on whatever ego currently has selected, and in the
    // persistent utility process that may be a space an earlier run chose, so a
    // failed enter must never reach the cleanup policy.
    if (!spaceEntered) {
      log('[ego-bridge] no task space entered; skipping cleanup');
      return;
    }
    // One invariant, no exceptions: a run may only destroy a task space it
    // CREATED in that same run; any space it merely entered (reused or
    // reclaimed) is detached with `completeTaskSpace` ("removes agent task state
    // while leaving the Space open") and never `closeTaskSpace` ("removes the
    // task-owned browser state", i.e. the tabs — which would be someone else's).
    const retain = keepPage || spaceOrigin !== 'created';
    if (retain && !keepPage) {
      log(
        `[ego-bridge] ${String(spaceOrigin)} space is completed, not closed: this run did not create it`,
      );
    }
    const keep: 'all' | string[] = retain ? 'all' : [];
    const native = retain ? ego.completeTaskSpace : ego.closeTaskSpace;
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
   * The known task-space names, in three buckets.
   *
   * - `reusable`: already agent-owned, so `useTaskSpace(id)` is enough. That
   *   covers `agentDelegatedToUser` as well as `agent`. Known limitation: the
   *   docs say `sendCDPMessage` requires ownership exactly `agent` and refuses a
   *   space "delegated to the user" (`native-bindings-api.md:693-697`), so
   *   reusing a delegated space lets `start()` succeed and then fails every CDP
   *   call until the user hands control back. Claiming it instead would be a
   *   takeover of a space the user is actively using, which the privacy rule
   *   forbids, so the reuse stands and the failure is surfaced by
   *   `onSendCDPMessageError` rather than hidden.
   * - `reclaimable`: created by an agent (`createdBy: 'agent'`) but no longer
   *   agent-owned. `completeTaskSpace()` — the `keepPage` cleanup policy — leaves
   *   exactly this behind, so these are the bridge's own leftovers. They are
   *   reclaimable, but only through `claimTaskSpace`: selecting one directly is
   *   refused by ego (`EGO_TASK_SPACE_INACTIVE`) because ownership moved to the
   *   user.
   * - `userOwned`: a Space a human created. Off limits, no exceptions.
   *
   * `ownership` alone cannot separate the last two — a completed agent space
   * reads `ownership: 'user'` — so `createdBy` is what licenses a reclaim.
   */
  const knownTaskSpaces = async (): Promise<{
    reusable: Map<string, number>;
    /** every id under one name, so a duplicate cannot become a permanent orphan */
    reclaimable: Map<string, number[]>;
    userOwned: Set<string>;
  }> => {
    const reusable = new Map<string, number>();
    const reclaimable = new Map<string, number[]>();
    const userOwned = new Set<string>();
    if (typeof ego.listTaskSpaces !== 'function') {
      return {reusable, reclaimable, userOwned};
    }
    try {
      const result = (await ego.listTaskSpaces()) as
        | {taskSpaces?: unknown}
        | null
        | undefined;
      if (!Array.isArray(result?.taskSpaces)) {
        return {reusable, reclaimable, userOwned};
      }
      for (const raw of result.taskSpaces) {
        const space = raw as EgoTaskSpace | undefined;
        const name = asString(space?.name);
        if (name === undefined) continue;
        if (isAgentOwned(space?.ownership)) {
          if (typeof space?.id === 'number') reusable.set(name, space.id);
          continue;
        }
        if (space?.createdBy === 'agent') {
          if (typeof space?.id === 'number') {
            const ids = reclaimable.get(name);
            if (ids === undefined) reclaimable.set(name, [space.id]);
            else ids.push(space.id);
          }
          continue;
        }
        // No `createdBy`, or anything else: assume a human made it.
        if (space?.ownership === 'user') userOwned.add(name);
      }
    } catch (error) {
      log(`[ego-bridge] listTaskSpaces failed: ${toText(error)}`);
    }
    return {reusable, reclaimable, userOwned};
  };

  /**
   * Take back one of the bridge's own leftovers.
   *
   * `claimTaskSpace` is the only supported way: it transfers a listed Space back
   * to the agent without creating a replacement, and the following
   * `useTaskSpace` selects it. Returns false when this ego build cannot claim or
   * the claim was refused, so the caller falls through to a fresh suffix instead
   * of selecting a space it does not own.
   */
  const reclaimTaskSpace = async (
    name: string,
    id: number,
  ): Promise<boolean> => {
    if (typeof ego.claimTaskSpace !== 'function') {
      log(
        `[ego-bridge] task space ${name} (${id}) is an agent leftover but ego.claimTaskSpace is unavailable; trying a new suffix`,
      );
      return false;
    }
    try {
      const claimed = (await ego.claimTaskSpace(id)) as
        | EgoTaskSpace
        | undefined;
      if (claimed?.error !== undefined) {
        log(
          `[ego-bridge] could not reclaim task space ${name} (${id}): ${String(claimed.error)} (${String(claimed.error_code ?? 'unknown')})`,
        );
        return false;
      }
    } catch (error) {
      log(
        `[ego-bridge] could not reclaim task space ${name} (${id}): ${toText(error)}`,
      );
      return false;
    }
    ego.useTaskSpace(id);
    log(`[ego-bridge] reclaimed its own task space ${name} (${id})`);
    return true;
  };

  /**
   * Enter this workspace's own task space.
   *
   * Reuses `browsercli-<workspace-hash>` when the agent already owns it, and
   * reclaims it when an earlier run left it behind as a user-owned space that
   * `createdBy: 'agent'` proves the bridge created. A space a human created is
   * never taken over: `EGO_TASK_SPACE_NAME_IN_USE` moves to `-2`, `-3`, ... and a
   * fresh space is created instead. Failing to enter a space at all throws, so
   * `start()` rejects instead of printing a ready line for a bridge whose every
   * command would fail with `EGO_TASK_SPACE_NOT_SELECTED`.
   *
   * `origin` reports how the space was entered — created by this run, reused
   * because an agent already owned it, or reclaimed from one of this bridge's
   * own leftovers. `finishTask()` destroys only the `'created'` case; the other
   * two are detached (see the invariant there).
   */
  const enterTaskSpace = async (): Promise<{origin: SpaceOrigin}> => {
    if (
      typeof ego.createTaskSpace !== 'function' ||
      typeof ego.useTaskSpace !== 'function'
    ) {
      throw new Error(
        'ego task-space bindings unavailable (createTaskSpace/useTaskSpace)',
      );
    }
    const {reusable, reclaimable, userOwned} = await knownTaskSpaces();
    // What the exhausted loop actually found, so the final message reports it
    // instead of guessing what is "typical".
    let agentLeftovers = 0;
    let notOurs = 0;
    for (let attempt = 1; attempt <= MAX_TASK_SPACE_ATTEMPTS; attempt++) {
      const name =
        attempt === 1 ? taskSpaceName : `${taskSpaceName}-${attempt}`;
      const existing = reusable.get(name);
      if (existing !== undefined) {
        ego.useTaskSpace(existing);
        log(`[ego-bridge] reusing task space ${name} (${existing})`);
        return {origin: 'reused'};
      }
      const leftovers = reclaimable.get(name);
      // A reclaimable name is never user-owned; `createdBy` is what decides, so
      // this cannot shadow the privacy guarantee below.
      if (leftovers !== undefined && leftovers.length > 0) {
        agentLeftovers += 1;
        // More than one leftover can share a name; the old single-slot map let
        // last-wins hide the rest forever. Try each in turn (bounded by the list)
        // and say which duplicates stay behind, because only one space can be
        // entered and closing the others would delete tabs this run never made.
        if (leftovers.length > 1) {
          log(
            `[ego-bridge] ${leftovers.length} agent-created spaces share the name ${name} (ids ${leftovers.join(', ')}); only one can be entered, the rest stay listed`,
          );
        }
        for (const id of leftovers) {
          if (await reclaimTaskSpace(name, id)) return {origin: 'reclaimed'};
        }
        continue;
      }
      if (userOwned.has(name)) {
        notOurs += 1;
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
        return {origin: 'created'};
      }
      if (space.error_code !== NAME_IN_USE) {
        throw new Error(
          `ego task space ${name} unavailable: ${String(space.error)} (${String(space.error_code ?? 'unknown')})`,
        );
      }
      notOurs += 1;
      log(
        `[ego-bridge] task space name ${name} belongs to the user; trying the next suffix`,
      );
    }
    // Actionable on purpose. The bound is kept at 8 because it is also the
    // number of suffixes the loop may legitimately walk, so nothing is gained by
    // raising it: a bigger bound only creates more spaces per run on the one
    // host that can still hit this (an ego build without `claimTaskSpace`, where
    // the bridge's own leftovers cannot be reclaimed).
    //
    // The message reports what the loop found (`agentLeftovers` / `notOurs`), not
    // what is usual: an all-user-space exhaustion must not tell a user that the
    // spaces in their way are this bridge's leftovers and can be deleted.
    const tried = Array.from({length: MAX_TASK_SPACE_ATTEMPTS}, (_, index) =>
      index === 0 ? taskSpaceName : `${taskSpaceName}-${index + 1}`,
    ).join(', ');
    const findings: string[] = [];
    if (agentLeftovers > 0) {
      findings.push(
        `${agentLeftovers} of them ${agentLeftovers === 1 ? 'is' : 'are'} ` +
          `this bridge's own agent-created leftover` +
          `${agentLeftovers === 1 ? '' : 's'} (createdBy "agent") that ` +
          `ego.claimTaskSpace could not reclaim`,
      );
    }
    if (notOurs > 0) {
      findings.push(
        `${notOurs} of them ${notOurs === 1 ? 'is' : 'are'} not this ` +
          `bridge's (created by the user, or in use by another space), and ` +
          `a space this bridge did not create is never taken over`,
      );
    }
    throw new Error(
      `could not enter a task space for workspace ${taskSpaceName} after ` +
        `${MAX_TASK_SPACE_ATTEMPTS} attempts: every name tried (${tried}) is ` +
        `already taken.` +
        (findings.length > 0
          ? ` Of those names: ${findings.join('; ')}.`
          : '') +
        ` Delete the spaces named ${taskSpaceName}* in the ego lite UI ` +
        `(or quit ego lite to drop them) and retry.`,
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
        const entry = await enterTaskSpace();
        // `spaceEntered`/`spaceOrigin` are set before the await below so the
        // failure path can release the space; that ordering is safe only because
        // `stop()` awaits this pending `start()` before running the cleanup
        // policy, so a concurrent stop cannot read a half-initialised state. A
        // third caller must keep awaiting `started` too.
        spaceEntered = true;
        spaceOrigin = entry.origin;
        abortIfStopping();
        await refreshOwnTargets(true);
        // I2: a reclaimed space hands the client every tab the user left in the
        // retained scene. The fence did not disappear (the tabs are inside this
        // space, and `createdBy: 'agent'` says the bridge owns the space), but its
        // boundary moved, so say so where a user reading diagnostics will see it.
        if (spaceOrigin === 'reclaimed') {
          const retained = ownTargetIds?.size ?? 0;
          if (retained > 0) {
            log(
              `[ego-bridge] reclaimed task space contributes ${retained} tab(s) that predate this run to the target whitelist`,
            );
          }
        }
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
        // A start() that failed after entering the space still owns it: release
        // it now, or the next run finds it as a user-owned leftover and burns a
        // suffix. `finishTask` is exactly-once, so a later stop() is a no-op.
        if (spaceEntered) await finishTask();
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
    // The manager always bakes the workspace identity into the bootstrap: in ego's
    // persistent utility process `process.cwd()` is ego's application directory
    // for *every* workspace, so hashing it here would give every session the same
    // task space and let a second session take over the first one's tabs. The
    // `cwd` fallback below only serves a directly-imported (foreground) worker.
    taskSpaceName:
      process.env.EGO_BRIDGE_TASK_SPACE_NAME ||
      workspaceTaskSpaceName(process.cwd()),
    keepPage: process.env.EGO_BRIDGE_KEEP_PAGE === '1',
    // Production always supplies a whitelist: without one the firewall would be
    // off and the user's private tabs would reach the client.
    listOwnTargetIds: () => listTabsOwnTargetIds(ego),
    // Diagnostics go to stderr, never stdout: stdout carries the ready line.
    log: line => process.stderr.write(`${line}\n`),
    onReady: wsEndpoint => {
      process.stdout.write(`${READY_PREFIX} ${wsEndpoint}\n`);
    },
  });

  let shuttingDown = false;
  let watcher: NodeJS.Timeout | undefined;
  const stopWatcher = () => {
    if (!watcher) return;
    clearInterval(watcher);
    watcher = undefined;
  };
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWatcher();
    void bridge.stop().finally(() => process.exit(0));
  };

  // Local/foreground path: a directly spawned worker dies with its stdin. In the
  // real host stdin is already at EOF and is not a control channel at all, so
  // this must not be the only shutdown path (see the poller below).
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.resume();

  // Signals: works where ego forwards them to the embedded runtime. On Windows
  // the runtime is a utility process of the ego app, so neither our launcher's
  // death nor a signal reaches it — the poller is what actually stops it there.
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // The authoritative shutdown channel: poll for the manager's stop file and for
  // the manager's own death. `unref()` so a finished bridge cannot be kept alive
  // by its own watchdog.
  const stopFile = process.env.EGO_BRIDGE_STOP_FILE;
  const watchedPid = watchedParentPid();
  watcher = setInterval(() => {
    if (shuttingDown) return;
    if (stopFile && fileExists(stopFile)) {
      shutdown();
      return;
    }
    if (!isAlive(watchedPid)) shutdown();
  }, livenessPollMs());
  watcher.unref();

  void bridge.start().catch(error => {
    process.stdout.write(`[ego-bridge:fatal] ${toText(error)}\n`);
    process.exit(1);
  });
}

/** The manager's own pid when the bootstrap supplied it, else the real parent. */
function watchedParentPid(): number {
  const supplied = Number(process.env.EGO_BRIDGE_PARENT_PID);
  return Number.isInteger(supplied) && supplied > 0 ? supplied : process.ppid;
}

/** Parent-loss test: `EPERM` still means the pid exists, so it counts as alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function fileExists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function livenessPollMs(): number {
  const supplied = Number(process.env.EGO_BRIDGE_LIVENESS_POLL_MS);
  return Number.isInteger(supplied) && supplied > 0
    ? supplied
    : DEFAULT_LIVENESS_POLL_MS;
}

const nativeEgo = (globalThis as {ego?: EgoNativeBindings}).ego;
if (
  nativeEgo &&
  typeof nativeEgo.sendCDPMessage === 'function' &&
  !importedByTest()
) {
  autostart(nativeEgo);
}
