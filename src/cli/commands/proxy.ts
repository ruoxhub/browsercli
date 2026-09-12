/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiCliCommand} from 'axi-sdk-js';

import {MitmModule} from '../../modules/proxy/MitmModule.js';
import {ProxyCli} from '../../modules/proxy/ProxyCli.js';
import {getBoolFlag, parseArgs} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

export const proxyCommand: AxiCliCommand<WorkerContext> = async (args, ctx) => {
  const parsed = parseArgs(args);
  const sub = parsed.positionals[0]?.toLowerCase();

  const mitmModule = new MitmModule();

  if (sub === 'status') {
    const st = mitmModule.status().data;
    if (getBoolFlag(parsed, 'json')) {
      return successOutput(
        {
          command: 'proxy status',
          proxyStatus: st,
          exitCode: 0,
        },
        ctx?.session,
      );
    }
    const cli = new ProxyCli(mitmModule);
    cli.handleStatus();
    return {
      command: 'proxy status',
      ...(ctx?.session !== undefined ? {session: ctx.session} : {}),
      exitCode: 0,
    };
  }

  // REPL 交互模式
  const portFlag = parsed.flags['port'] ?? parsed.flags['p'];
  const port = portFlag !== undefined ? Number(portFlag) : 8888;
  const upstream =
    typeof parsed.flags['upstream'] === 'string'
      ? parsed.flags['upstream']
      : undefined;
  const sysproxy = getBoolFlag(parsed, 'sysproxy');
  const noAutoStart = getBoolFlag(parsed, 'no-auto-start');

  const cli = new ProxyCli(mitmModule);

  let isExiting = false;
  const cleanup = async (code = 0): Promise<void> => {
    if (isExiting) return;
    isExiting = true;
    try {
      cli.close();
      await mitmModule.stop();
      await mitmModule.restoreSystemProxy();
    } catch (err) {
      console.error('[WARN] Cleanup error during exit:', err);
    } finally {
      process.exit(code);
    }
  };

  process.once('SIGINT', () => void cleanup(0));
  process.once('SIGTERM', () => void cleanup(0));

  if (!noAutoStart) {
    const res = await mitmModule.start(port, upstream);
    if (res.success) {
      cli.writeLine(`[INFO] MITM Proxy started on port ${res.data.port}.`);
      if (sysproxy) {
        try {
          await mitmModule.getSystemProxyManager().enable(res.data.port);
          cli.writeLine(
            `[INFO] System proxy enabled on 127.0.0.1:${res.data.port}.`,
          );
        } catch (err) {
          cli.writeLine(
            `[WARN] Failed to enable system proxy: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      cli.writeLine(`[ERROR] Failed to start MITM proxy: ${res.message}`);
    }
  }

  await cli.start();
  await cleanup(0);

  return {
    command: 'proxy',
    exitCode: 0,
  };
};
