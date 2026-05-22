/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkerManager — Worker 进程生命周期管理 + 进程守护
 *
 * 负责 spawn/stop Worker 进程，管理其 PID 和状态
 * 集成 WorkerGuardian 实现崩溃自动重启策略
 * 兼容 Windows (无 SIGTERM/SIGKILL) 和 Unix
 */

import {spawn, execSync, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {RUNTIME_DIR_NAME} from '../config.js';
import type {WorkerStartOptions} from '../types/platform.js';

import {
  WorkerGuardian,
  type RestartPolicy,
  type HealthStatus,
  type GuardianSnapshot,
} from './worker-guardian.js';

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
  private readonly guardian: WorkerGuardian;
  private lastStartOptions: WorkerStartOptions | null = null;
  private stoppingIntentionally = false;

  constructor(policy?: Partial<RestartPolicy>) {
    this.guardian = new WorkerGuardian(policy);
  }

  /**
   * 启动 Worker 进程
   */
  async start(options: WorkerStartOptions): Promise<void> {
    if (this.isRunning()) {
      throw new Error('Worker 已在运行中 (PID: ' + this.getPid() + ')');
    }

    this.lastStartOptions = {...options};
    this.stoppingIntentionally = false;

    await this.spawnWorker(options);
  }

  /**
   * 停止 Worker 进程
   */
  async stop(): Promise<void> {
    this.stoppingIntentionally = true;

    const pid = this.getPid();
    if (!pid) {
      throw new Error('Worker 未运行');
    }

    try {
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

    this.cleanup();
  }

  /**
   * Worker 是否在运行
   */
  isRunning(): boolean {
    if (this.workerProcess && !this.workerProcess.killed) {
      return true;
    }

    const pid = this.getPid();
    if (!pid) return false;

    try {
      if (IS_WIN) {
        return this.isPidAliveWindows(pid);
      }
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
   * 获取运行时长（秒）
   */
  getUptime(): number {
    return this.guardian.getUptimeSeconds();
  }

  /**
   * 获取健康状态
   */
  getHealth(): HealthStatus {
    if (!this.isRunning() && !this.stoppingIntentionally) {
      return 'unhealthy';
    }
    return this.guardian.getHealth();
  }

  /**
   * 获取守护快照（重启次数、策略、健康状态等）
   */
  getGuardianSnapshot(): GuardianSnapshot {
    return this.guardian.getSnapshot();
  }

  /** 获取守护策略 */
  getRestartPolicy(): RestartPolicy {
    return this.guardian.getSnapshot().policy;
  }

  // ==================== 私有方法 ====================

  /**
   * 实际 spawn worker 子进程
   */
  private async spawnWorker(options: WorkerStartOptions): Promise<void> {
    const workerArgs: string[] = [
      '--rpcHost', options.rpcHost,
      '--group', options.group,
    ];
    if (options.browserUrl) workerArgs.push('--browserUrl', options.browserUrl);
    if (options.wsEndpoint) workerArgs.push('--wsEndpoint', options.wsEndpoint);
    if (options.headless) workerArgs.push('--headless');
    if (options.executablePath) workerArgs.push('--executablePath', options.executablePath);
    if (options.databaseUrl) workerArgs.push('--databaseUrl', options.databaseUrl);

    const execPath = process.execPath;
    const workerEntry = path.resolve(__dirname, '../index.js');

    this.workerProcess = spawn(execPath, [workerEntry, ...workerArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: {...process.env},
      shell: IS_WIN,
    });

    const pid = this.workerProcess.pid!;
    this.guardian.markStarted();
    console.log(`[WorkerManager] Worker 启动 (PID: ${pid})`);

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
      this.handleWorkerExit(code, signal);
    });

    await readyPromise;
  }

  /**
   * 处理 Worker 退出 — 决定是否自动重启
   */
  private handleWorkerExit(code: number | null, signal: string | null): void {
    const pid = this.getPid();
    console.log(
      `[WorkerManager] Worker 退出 (PID=${pid}, code=${code}, signal=${signal})`,
    );

    this.workerProcess = null;

    if (this.stoppingIntentionally) {
      this.cleanup();
      return;
    }

    // 询问 guardian 是否应重启
    if (this.guardian.shouldRestart(code, signal) && this.lastStartOptions) {
      const delay = this.guardian.getRestartDelay();
      console.log(
        `[WorkerManager] ${delay}ms 后自动重启 Worker... (窗口内重启次数: ${this.guardian.getSnapshot().restartCount})`,
      );

      setTimeout(() => {
        if (!this.stoppingIntentionally) {
          this.spawnWorker(this.lastStartOptions!).catch(err => {
            console.error('[WorkerManager] 自动重启 Worker 失败:', err);
          });
        }
      }, delay);
    } else {
      const snapshot = this.guardian.getSnapshot();
      if (snapshot.restartCount > snapshot.policy.maxRestarts) {
        console.error(
          `[WorkerManager] Worker 已达到最大重启次数 (${snapshot.policy.maxRestarts}/${snapshot.policy.restartWindowMs}ms)，停止重启`,
        );
      }
      this.cleanup();
    }
  }

  private cleanup(): void {
    this.removePidFile();
    this.workerProcess = null;
  }

  /**
   * Windows: 使用 tasklist 检测进程是否存活
   */
  private isPidAliveWindows(pid: number): boolean {
    try {
      const result = execSync(
        `tasklist /FI "PID eq ${pid}" /NH /FO CSV`,
        {encoding: 'utf-8', timeout: 3000, windowsHide: true},
      );
      return result.includes(`"${pid}"`);
    } catch {
      return false;
    }
  }

  private writePidFile(pid: number): void {
    fs.mkdirSync(RUNTIME_DIR, {recursive: true});
    fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
  }

  private removePidFile(): void {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }
}
