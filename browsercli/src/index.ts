/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export {type WorkerContext} from './types.js';
export type {
  JobStatus,
  ToolRecovery,
  BrowserConnectOptions,
  BrowserConnectionStatus,
  BrowserDisconnectOptions,
} from './types.js';
export {
  successOutput,
  tableOutput,
  listOutput,
  type AxiRenderable,
  type AxiStructuredOutput,
} from './output.js';
export {AxiError, toAxiError, daemonError, toolError} from './errors.js';
export {
  parseArgs,
  getFlag,
  hasFlag,
  getBoolFlag,
  type ParsedArgs,
} from './args-parser.js';
export {generateTopLevelHelp, generateCommandHelp} from './help.js';
export {
  DaemonConnection,
  ensureDaemon,
  spawnDaemon,
  stopSession,
  killAllDaemons,
  resolveEntryPath,
  collectDaemonPids,
  PROTOCOL_VERSION,
  DEFAULT_INVOKE_TIMEOUT_MS,
  type DaemonEvent,
  type DaemonLike,
  type EnsureDaemonOptions,
} from './daemonClient.js';
export {
  computeClientInfo,
  computeWorkspaceDir,
  makePipePath,
  resolveSessionName,
  explicitSessionName,
  loadSession,
  listSessions,
  deleteSession,
  type SessionConfig,
  type ClientInfo,
} from './sessionPaths.js';
export type {
  ToolMeta,
  ToolArgSpec,
  ToolArgSpecMap,
  ToolArgType,
} from './tool-meta-types.js';
export {configCommand} from './commands/config.js';
export {listToolsCommand} from './commands/list-tools.js';
export {scaffoldCommand} from './commands/scaffold.js';
export {toolDispatcherCommand} from './commands/tool-dispatcher.js';
export {buildToolArgs} from './commands/shared/tool-args.js';
