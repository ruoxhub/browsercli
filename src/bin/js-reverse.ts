#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import {yargs, hideBin} from '../third_party/index.js';
import {sendCommand, startDaemon, stopDaemon, handleResponse} from '../daemon/client.js';
import {isDaemonRunning, serializeArgs} from '../daemon/utils.js';

async function main() {
  const cli = yargs(hideBin(process.argv))
    .scriptName('js-reverse')
    .usage('$0 <command> [options]')
    // start 命令
    .command(
      'start',
      '启动后台 daemon 服务',
      yargs => {
        return yargs.options({
          browserUrl: {
            type: 'string',
            description: 'Chrome DevTools 地址',
            alias: 'u',
          },
          wsEndpoint: {
            type: 'string',
            description: 'Chrome WebSocket 端点',
            alias: 'w',
          },
          headless: {
            type: 'boolean',
            description: '无头模式',
            default: false,
          },
          isolated: {
            type: 'boolean',
            description: '隔离模式',
            default: false,
          },
          databaseUrl: {
            type: 'string',
            description: 'PostgreSQL 连接 URL',
            alias: 'd',
          },
        });
      },
      async argv => {
        if (isDaemonRunning()) {
          console.log('Daemon 已在运行中');
          return;
        }
        const args = serializeArgs(
          {
            browserUrl: {type: 'string'},
            wsEndpoint: {type: 'string'},
            headless: {type: 'boolean'},
            isolated: {type: 'boolean'},
            databaseUrl: {type: 'string'},
          },
          argv
        );
        await startDaemon(args);
        console.log('Daemon 已启动');
      }
    )
    // stop 命令
    .command(
      'stop',
      '停止后台 daemon 服务',
      () => {},
      async () => {
        await stopDaemon();
        console.log('Daemon 已停止');
      }
    )
    // status 命令
    .command(
      'status',
      '查看 daemon 状态',
      () => {},
      async () => {
        try {
          const response = await sendCommand({method: 'status'});
          if (response.success) {
            console.log(JSON.stringify(JSON.parse(response.result!), null, 2));
          } else {
            console.error('Daemon 未运行');
          }
        } catch (error) {
          console.error('Daemon 未运行:', error instanceof Error ? error.message : error);
        }
      }
    )
    // call 命令 - 调用 MCP 工具
    .command(
      'call <tool> [args...]',
      '调用 MCP 工具',
      yargs => {
        return yargs.positional('tool', {
          type: 'string',
          describe: '工具名称',
        });
      },
      async argv => {
        if (!isDaemonRunning()) {
          console.error('Daemon 未运行，请先运行：js-reverse start');
          process.exit(1);
        }

        const parsedArgs: Record<string, unknown> = {};
        const args = argv.args as string[] | undefined;
        if (args) {
          for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg.startsWith('--')) {
              const key = arg.slice(2);
              const value = args[i + 1];
              if (value && !value.startsWith('--')) {
                parsedArgs[key] = value;
                i++;
              } else {
                parsedArgs[key] = true;
              }
            }
          }
        }

        try {
          const response = await sendCommand({
            method: 'invoke_tool',
            tool: argv.tool!,
            args: parsedArgs,
          });

          if (response.success && response.result) {
            const result = JSON.parse(response.result);
            const output = handleResponse(result, 'text');
            console.log(output);
          } else {
            console.error(response.error || '工具执行失败');
            process.exit(1);
          }
        } catch (error) {
          console.error('错误:', error instanceof Error ? error.message : error);
          process.exit(1);
        }
      }
    )
    .help()
    .alias('h', 'help')
    .strict();

  // 如果没有提供任何参数，显示帮助
  if (process.argv.length <= 2) {
    cli.showHelp();
  }

  await cli.parse();
}

main().catch(error => {
  console.error('错误:', error instanceof Error ? error.message : error);
  process.exit(1);
});
