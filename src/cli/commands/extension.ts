/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {AxiError} from 'axi-sdk-js';
import type {AxiCliCommand} from 'axi-sdk-js';

import {
  getNativeHostPaths,
  installNativeHost,
  uninstallNativeHost,
} from '../../modules/extension/host/NativeHostManifest.js';
import {NativeMessagingHost} from '../../modules/extension/transport/NativeMessagingHost.js';
import {parseArgs} from '../args-parser.js';
import {toAxiError} from '../errors.js';
import {successOutput, tableOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

function invalid(message: string): never {
  throw new AxiError(message, 'VALIDATION_ERROR', [
    '用法：proxycli extension install-host|uninstall-host|status|path|host-bridge [options]',
  ]);
}

function resolveExtensionSourceDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateFromSrc = path.resolve(
    currentDir,
    '../../modules/extension/chrome-extension',
  );
  if (fs.existsSync(candidateFromSrc)) {
    return candidateFromSrc;
  }
  const candidateFromRoot = path.resolve(
    process.cwd(),
    'src/modules/extension/chrome-extension',
  );
  if (fs.existsSync(candidateFromRoot)) {
    return candidateFromRoot;
  }
  return candidateFromSrc;
}

export const extensionCommand: AxiCliCommand<WorkerContext> = async (
  args,
  ctx,
) => {
  const parsed = parseArgs(args);
  const subcommand = parsed.positionals[0];
  const asJson = Boolean(parsed.flags.json);

  try {
    switch (subcommand) {
      case 'install-host': {
        const allowedOrigins =
          typeof parsed.flags['allowed-origins'] === 'string'
            ? parsed.flags['allowed-origins'].split(',')
            : ['chrome-extension://*'];

        const res = installNativeHost({allowedOrigins});
        if (asJson) return JSON.stringify(res, null, 2);
        return successOutput(
          {
            command: 'extension',
            action: 'install-host',
            manifestPath: res.manifestPath,
            scriptPath: res.scriptPath,
            message: res.message,
          },
          ctx?.session,
        );
      }

      case 'uninstall-host': {
        const res = uninstallNativeHost();
        if (asJson) return JSON.stringify(res, null, 2);
        return successOutput(
          {
            command: 'extension',
            action: 'uninstall-host',
            message: res.message,
          },
          ctx?.session,
        );
      }

      case 'path': {
        const extDir = resolveExtensionSourceDir();
        if (asJson) {
          return JSON.stringify(
            {extensionDir: extDir, exists: fs.existsSync(extDir)},
            null,
            2,
          );
        }
        return successOutput(
          {
            command: 'extension',
            action: 'path',
            extensionDir: extDir,
            guide:
              '在 Chrome 中访问 chrome://extensions/，开启“开发者模式”，点击“加载已解压的扩展程序”并选择上述目录。',
          },
          ctx?.session,
        );
      }

      case 'status': {
        const {manifestPath, scriptPath} = getNativeHostPaths();
        const manifestInstalled = fs.existsSync(manifestPath);
        const scriptInstalled = fs.existsSync(scriptPath);

        const statusInfo = {
          command: 'extension',
          action: 'status',
          nativeHostInstalled: manifestInstalled && scriptInstalled,
          manifestPath,
          scriptPath,
          extensionSourceDir: resolveExtensionSourceDir(),
        };

        if (asJson) return JSON.stringify(statusInfo, null, 2);

        return tableOutput(
          ['检查项', '配置值'],
          [
            [
              'Native Host 状态',
              statusInfo.nativeHostInstalled ? '已就绪' : '未安装',
            ],
            ['Manifest 路径', statusInfo.manifestPath],
            ['Host 脚本路径', statusInfo.scriptPath],
            ['扩展源码目录', statusInfo.extensionSourceDir],
          ],
        );
      }

      case 'host-bridge': {
        // Native Messaging stdio bridge:
        // Reads from process.stdin, writes to process.stdout.
        const host = new NativeMessagingHost();
        host.on('message', msg => {
          if (msg && typeof msg === 'object' && 'method' in msg) {
            if (msg.method === 'ping' && 'id' in msg) {
              host.send({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  status: 'ok',
                  bridge: 'proxycli-native-host',
                  timestamp: Date.now(),
                },
              });
            }
          }
        });

        await new Promise<void>(resolve => {
          host.on('close', () => resolve());
        });
        return '';
      }

      default:
        invalid(subcommand ? `未知子命令：${subcommand}` : '缺少子命令');
    }
  } catch (error) {
    throw toAxiError(error);
  }
};
