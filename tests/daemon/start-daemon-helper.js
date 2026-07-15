/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Daemon 启动辅助脚本
 * 用于测试中完全分离 daemon 进程
 *
 * 使用方法:
 * node start-daemon-helper.js <daemon-script> <browserUrl>
 *
 * 输出:
 * - 启动成功后输出 PID
 * - 启动失败则输出错误并退出码 1
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

const daemonScript = process.argv[2];
const browserUrl = process.argv[3];

if (!daemonScript || !browserUrl) {
  console.error(
    'Usage: node start-daemon-helper.js <daemon-script> <browserUrl>',
  );
  process.exit(1);
}

// 导入 utils 获取路径
const utilsPath = path.resolve(PROJECT_ROOT, 'build/src/daemon/utils.js');
console.log(`[HELPER] Utils path: ${utilsPath}`);
console.log(`[HELPER] Project root: ${PROJECT_ROOT}`);
const {getSocketPath} = await import(utilsPath);
const SOCKET_PATH = getSocketPath();

console.log(`[HELPER] Starting daemon: ${daemonScript}`);
console.log(`[HELPER] Browser URL: ${browserUrl}`);
console.log(`[HELPER] Socket path: ${SOCKET_PATH}`);

// 完全分离进程 - 不绑定任何 stdio
const daemon = spawn('node', [daemonScript, '--browserUrl', browserUrl], {
  cwd: PROJECT_ROOT,
  stdio: 'ignore', // 完全忽略 stdio
  detached: true, // 完全分离
  env: process.env,
});

console.log(`[HELPER] Daemon spawned with PID: ${daemon.pid}`);

// 完全分离 - 父进程不等待子进程
daemon.unref();

// 等待 socket 文件出现，确认 daemon 已启动
let started = false;
const timeout = 20000; // 20 秒超时 - daemon 可能需要时间连接浏览器
const pollInterval = 200; // 200ms 轮询一次

const startTime = Date.now();

function waitForSocket() {
  if (started) return;

  const elapsed = Date.now() - startTime;
  if (elapsed > timeout) {
    console.error(`[HELPER] Timeout waiting for socket (>${timeout}ms)`);
    // 调试输出：检查 socket 和 PID 文件
    console.log(`[HELPER] Socket exists: ${fs.existsSync(SOCKET_PATH)}`);
    console.log(`[HELPER] Socket path: ${SOCKET_PATH}`);
    try {
      console.log(
        `[HELPER] /tmp contents: ${fs
          .readdirSync('/tmp')
          .filter(f => f.includes('js-reverse'))
          .join(', ')}`,
      );
    } catch {
      // intentionally empty
    }
    process.exit(1);
  }

  if (fs.existsSync(SOCKET_PATH)) {
    started = true;
    console.log(`[HELPER] Socket found! Daemon ready.`);
    // 输出 PID 供测试读取
    console.log(`PID:${daemon.pid}`);
    process.exit(0);
  }

  setTimeout(waitForSocket, pollInterval);
}

waitForSocket();

// 监听 daemon 进程错误
daemon.on('error', err => {
  console.error(`[HELPER] Spawn error: ${err.message}`);
  process.exit(1);
});

daemon.on('exit', code => {
  if (!started) {
    console.error(`[HELPER] Daemon exited unexpectedly with code ${code}`);
    process.exit(1);
  }
});
