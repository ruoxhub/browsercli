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
/** Used when ego lite does not advertise its Chromium build. */
const FALLBACK_VERSION = '141.0.7390.0';
const V8_VERSION = '14.1';
const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

/** The native bindings ego lite injects into its embedded Node runtime. */
export interface EgoNativeBindings {
  sendCDPMessage(message: string): void;
  onCDPMessage: ((message: string) => void) | undefined;
  onSendCDPMessageError:
    | ((message: string, errorCode?: string) => void)
    | undefined;
  getBrowserVersion?: () => unknown;
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
  taskSpaceName: string;
  keepPage?: boolean;
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

interface CdpMessage {
  id?: unknown;
  method?: unknown;
  sessionId?: unknown;
  params?: {
    sessionId?: unknown;
    targetInfo?: {targetId?: unknown};
  };
}

function toText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const listOwnTargetIds = options.listOwnTargetIds ?? (async () => []);
  const keepPage = options.keepPage === true;

  const clients = new Set<WsClient>();
  /** requests forwarded to ego and still waiting for their response */
  const inFlight = new Map<number, string | undefined>();
  /** keeps native events in arrival order even while they are filtered */
  let nativeQueue: Promise<void> = Promise.resolve();

  let server: Server | undefined;
  let guid = '';
  let started: Promise<{wsEndpoint: string}> | undefined;
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
    let version = FALLBACK_VERSION;
    try {
      version = readVersion(await ego.getBrowserVersion?.()) ?? version;
    } catch (error) {
      log(`[ego-bridge] getBrowserVersion failed: ${toText(error)}`);
    }
    return {
      protocolVersion: '1.3',
      product: `Chrome/${version}`,
      revision: version,
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
      jsVersion: V8_VERSION,
    };
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

  const isForeignAttach = async (event: CdpMessage): Promise<boolean> => {
    const {targetId} = event.params?.targetInfo ?? {};
    const {sessionId} = event.params ?? {};
    let own: string[];
    try {
      own = await listOwnTargetIds();
    } catch (error) {
      log(`[ego-bridge] target whitelist unavailable: ${toText(error)}`);
      return true;
    }
    // An empty whitelist means "no restriction".
    if (!Array.isArray(own) || own.length === 0) return false;
    return (
      !own.includes(targetId as string) && !own.includes(sessionId as string)
    );
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
    if (
      event.method === 'Target.attachedToTarget' &&
      (await isForeignAttach(event))
    ) {
      // The user's own tabs must never surface in the client's context.pages().
      log(
        '[ego-bridge] dropped Target.attachedToTarget outside the task space',
      );
      return;
    }
    broadcast(raw);
  };

  const onNativeMessage = (message: string) => {
    nativeQueue = nativeQueue
      .then(() => routeFromNative(message))
      .catch(error => {
        log(`[ego-bridge] native message routing failed: ${toText(error)}`);
      });
  };

  const onNativeSendError = (message: string, errorCode?: string) => {
    const reason = `${errorCode ?? 'EGO_CDP_SEND_FAILED'}: ${message}`;
    log(`[ego-bridge] sendCDPMessage failed: ${reason}`);
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

  const enterTaskSpace = async () => {
    if (typeof ego.createTaskSpace !== 'function') {
      log('[ego-bridge] createTaskSpace unavailable; using the active space');
      return;
    }
    try {
      const space = (await ego.createTaskSpace(options.taskSpaceName)) as {
        id?: number;
        error?: string;
        error_code?: string;
      };
      if (space?.error) {
        log(
          `[ego-bridge] task space ${options.taskSpaceName} unavailable: ${space.error} (${space.error_code ?? 'unknown'})`,
        );
        return;
      }
      if (typeof space?.id === 'number' && ego.useTaskSpace) {
        ego.useTaskSpace(space.id);
      }
    } catch (error) {
      log(`[ego-bridge] task space setup failed: ${toText(error)}`);
    }
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

  const start = (): Promise<{wsEndpoint: string}> => {
    if (started) return started;
    if (stopping) return Promise.reject(new Error('ego bridge is stopped'));
    started = (async () => {
      await enterTaskSpace();
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
      const address = listening.address();
      if (!address || typeof address === 'string') {
        throw new Error('ego bridge failed to bind a loopback port');
      }
      const wsEndpoint = `ws://127.0.0.1:${address.port}/devtools/browser/${guid}`;
      ego.onCDPMessage = onNativeMessage;
      ego.onSendCDPMessageError = onNativeSendError;
      options.onReady?.(wsEndpoint);
      return {wsEndpoint};
    })();
    return started;
  };

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      await finishTask();
      // Release only the callbacks this bridge installed.
      if (ego.onCDPMessage === onNativeMessage) ego.onCDPMessage = undefined;
      if (ego.onSendCDPMessageError === onNativeSendError) {
        ego.onSendCDPMessageError = undefined;
      }
      for (const client of clients) client.close();
      clients.clear();
      const listening = server;
      server = undefined;
      await new Promise<void>(resolve => {
        if (!listening) {
          resolve();
          return;
        }
        listening.close(() => resolve());
        listening.closeAllConnections?.();
      });
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
      process.env.EGO_BRIDGE_TASK_SPACE_NAME ?? `browsercli-${process.pid}`,
    keepPage: process.env.EGO_BRIDGE_KEEP_PAGE === '1',
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
