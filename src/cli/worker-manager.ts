/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerManager — Worker 进程生命周期管理
 *
 * 负责 spawn/stop Worker 进程，管理其 PID 和状态
 * 兼容 Windows (无 SIGTERM/SIGKILL) 和 Unix
 */

import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import type {WorkerStartOptions} from '../types/platform.js';
import {RUNTIME_DIR_NAME} from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_WIN = process.platform === 'win32';

/** PID 文件目录 */
const RUNTIME_DIR = path.join(os.tmpdir(), RUNTIME_DIR_NAME);
const PID_FILE = path.join(RUNTIME_DIR, 'worker.pid');

/** Worker 启动成功标志行 */
const WORKER_READY_MARKER = '[Worker] 已启动并连接到 Sekiro Server';

export class WorkerManager {
  private workerProcess: ChildProcess | null = null;

  /**
   * 启动 Worker 进程
   */
  async start(options: WorkerStartOptions): Promise<void> {
    if (this.isRunning()) {
      throw new Error('Worker 已在运行中 (PID: ' + this.getPid() + ')');
    }

    // 构造 Worker 启动参数
    const workerArgs: string[] = [
      '--sekiroHost', options.sekiroHost,
      '--group', options.group,
    ];
    if (options.browserUrl) workerArgs.push('--browserUrl', options.browserUrl);
    if (options.wsEndpoint) workerArgs.push('--wsEndpoint', options.wsEndpoint);
    if (options.headless) workerArgs.push('--headless');
    if (options.executablePath) workerArgs.push('--executablePath', options.executablePath);

    // 确定可执行路径
    const execPath = process.execPath;
    const workerEntry = path.resolve(__dirname, '../worker/index.js');

    this.workerProcess = spawn(execPath, [workerEntry, ...workerArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {...process.env},
      // Windows 上需要 shell 才能正确找到 node
      shell: IS_WIN,
    });

    const pid = this.workerProcess.pid!;
    console.log(`[WorkerManager] Worker 启动 (PID: ${pid})`);

    // 写入 PID 文件
    this.writePidFile(pid);

    // 收集 stdout 用于 ready 检测
    let readyResolved = false;
    const readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!readyResolved) {
          readyResolved = true;
          reject(new Error('Worker 启动超时'));
        }
      }, 30000);

      this.workerProcess!.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        process.stdout.write(data);

        if (!readyResolved && text.includes(WORKER_READY_MARKER)) {
          readyResolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    this.workerProcess.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    this.workerProcess.on('exit', (code, signal) => {
      console.log(`[WorkerManager] Worker 退出 (code=${code}, signal=${signal})`);
      this.workerProcess = null;
      this.removePidFile();
    });

    // 等待 Worker 输出启动成功标志
    await readyPromise;
  }

  /**
   * 停止 Worker 进程
   */
  async stop(): Promise<void> {
    const pid = this.getPid();
    if (!pid) {
      throw new Error('Worker 未运行');
    }

    try {
      // Windows: process.kill(pid) 等效于 SIGKILL
      // Unix: 先 SIGTERM，再 SIGKILL
      if (IS_WIN) {
        process.kill(pid);
      } else {
        process.kill(pid, 'SIGTERM');
      }

      // 等待进程退出（最多 10s）
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (!this.isRunning()) break;
        await new Promise(r => setTimeout(r, 500));
      }

      // 如果还在运行，强制 kill (Unix only)
      if (!IS_WIN && this.isRunning()) {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // 进程可能已退出
    }

    this.removePidFile();
    this.workerProcess = null;
  }

  /**
   * Worker 是否在运行
   */
  isRunning(): boolean {
    const pid = this.getPid();
    if (!pid) return false;

    try {
      // Windows: process.kill(pid, 0) 不支持，用 0 信号在 Windows 上等效于 SIGKILL
      // 统一用信号 0 检测进程存在性 (Windows 也支持)
      process.kill(pid, 0);
      return true;
    } catch {
      this.removePidFile();
      return false;
    }
  }

  /**
   * 获取 Worker PID
   */
  getPid(): number | null {
    try {
      const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * 写入 PID 文件
   */
  private writePidFile(pid: number): void {
    fs.mkdirSync(RUNTIME_DIR, {recursive: true});
    fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
  }

  /**
   * 删除 PID 文件
   */
  private removePidFile(): void {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}
