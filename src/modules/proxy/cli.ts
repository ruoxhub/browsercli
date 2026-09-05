#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {MitmModule} from './MitmModule.js';
import {ProxyCli} from './ProxyCli.js';

export async function runProxyCli(
  argv: string[] = process.argv.slice(2),
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  let port = 8888;
  let upstream: string | undefined;
  let enableSysproxy = false;
  let autoStart = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      const next = argv[++i];
      if (next) port = Number(next);
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice(7));
    } else if (arg === '--upstream') {
      upstream = argv[++i];
    } else if (arg.startsWith('--upstream=')) {
      upstream = arg.slice(11);
    } else if (arg === '--sysproxy') {
      enableSysproxy = true;
    } else if (arg === '--no-auto-start') {
      autoStart = false;
    }
  }

  const mitmModule = new MitmModule();
  const cli = new ProxyCli(mitmModule, input, output);

  let isExiting = false;
  const cleanupAndExit = async (code = 0): Promise<void> => {
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

  process.once('SIGINT', () => {
    void cleanupAndExit(0);
  });
  process.once('SIGTERM', () => {
    void cleanupAndExit(0);
  });
  process.on('uncaughtException', err => {
    console.error('[FATAL]', err);
    void cleanupAndExit(1);
  });
  process.on('exit', () => {
    mitmModule.restoreSystemProxySync();
  });

  if (autoStart) {
    const startRes = await mitmModule.start(port, upstream);
    if (startRes.success) {
      cli.writeLine(
        `[INFO] MITM Proxy auto-started on port ${startRes.data.port}.`,
      );
      if (enableSysproxy) {
        try {
          await mitmModule.getSystemProxyManager().enable(startRes.data.port);
          cli.writeLine(
            `[INFO] System proxy auto-enabled on 127.0.0.1:${startRes.data.port}.`,
          );
        } catch (err) {
          cli.writeLine(
            `[WARN] Could not enable system proxy: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      cli.writeLine(`[ERROR] Auto-start failed: ${startRes.message}`);
    }
  }

  await cli.start();
  await cleanupAndExit(0);
}

const isDirectRun =
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('cli.js') ||
  process.argv[1]?.endsWith('cli.ts');

if (isDirectRun) {
  void runProxyCli();
}
