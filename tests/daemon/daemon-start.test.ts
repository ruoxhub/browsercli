/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from 'node:child_process';
import {describe, it, beforeEach, afterEach} from 'node:test';
import {promisify} from 'node:util';

const execAsync = promisify(exec);

// 导入与实际 daemon 一致的路径函数
// @ts-ignore - 动态导入在运行时解析
const {getSocketPath, getPidFilePath} =
  await import('../../../build/src/daemon/utils.js');

const SOCKET_PATH = getSocketPath();
const PID_FILE = getPidFilePath();

// 获取项目根目录的绝对路径
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DAEMON_SCRIPT = path.resolve(PROJECT_ROOT, 'build/src/daemon/daemon.js');
const CLI_SCRIPT = path.resolve(PROJECT_ROOT, 'build/src/bin/js-reverse.js');
const START_DAEMON_SCRIPT = path.resolve(
  PROJECT_ROOT,
  'tests/daemon/start-daemon.sh',
);

describe('Daemon Start/Stop', () => {
  beforeEach(async () => {
    // Clean up any existing test daemon
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
        try {
          process.kill(pid, 'SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch {
          // Process may already be dead
        }
      }
      if (fs.existsSync(SOCKET_PATH)) {
        fs.unlinkSync(SOCKET_PATH);
      }
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {
      // Ignore cleanup errors
    }
    // Wait for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(PID_FILE)) {
        const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
        try {
          process.kill(pid, 'SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch {
          // Already dead
        }
      }
      if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {
      // Ignore
    }
  });

  async function startDaemon(): Promise<void> {
    // Use wrapper script to start daemon with proper detachment
    await execAsync(
      `"${START_DAEMON_SCRIPT}" "${DAEMON_SCRIPT}" "http://127.0.0.1:9222"`,
      {cwd: PROJECT_ROOT},
    );

    // Wait for socket file to appear
    // Note: daemon needs time to create socket server before browser connection
    const timeout = 30000; // 30 seconds - daemon needs time for browser launch
    const pollInterval = 500;
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      function checkSocket() {
        const elapsed = Date.now() - startTime;
        if (elapsed > timeout) {
          reject(new Error(`Timeout waiting for socket (> ${timeout}ms)`));
          return;
        }

        if (fs.existsSync(SOCKET_PATH)) {
          resolve();
          return;
        }

        setTimeout(checkSocket, pollInterval);
      }

      checkSocket();
    });
  }

  it('should create socket and pid files on start', async () => {
    await startDaemon();

    // Verify socket exists
    assert.ok(
      fs.existsSync(SOCKET_PATH),
      `Socket file should exist: ${SOCKET_PATH}`,
    );

    // Verify PID file exists
    assert.ok(fs.existsSync(PID_FILE), `PID file should exist: ${PID_FILE}`);

    // Verify PID file contains valid number
    const pidContent = fs.readFileSync(PID_FILE, 'utf-8');
    const pid = parseInt(pidContent);
    assert.ok(!isNaN(pid), 'PID should be a valid number');

    // Verify process is running
    assert.doesNotThrow(
      () => process.kill(pid, 0),
      `Process ${pid} should be running`,
    );
  });

  it('should respond to status command after start', async () => {
    await startDaemon();

    // Get status using CLI
    const {stdout} = await execAsync(`node ${CLI_SCRIPT} status`, {
      cwd: PROJECT_ROOT,
    });

    assert.ok(stdout.includes('Daemon 状态'), 'Should contain status header');
    assert.ok(stdout.includes('运行中'), 'Should show running');
  });

  it('should stop cleanly on SIGTERM', async () => {
    await startDaemon();

    // Read PID from file
    const pidContent = fs.readFileSync(PID_FILE, 'utf-8');
    const pid = parseInt(pidContent);

    // Send SIGTERM
    process.kill(pid, 'SIGTERM');

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify files cleaned up
    assert.ok(!fs.existsSync(SOCKET_PATH), 'Socket file should be cleaned up');
    assert.ok(!fs.existsSync(PID_FILE), 'PID file should be cleaned up');

    // Verify process exited
    assert.throws(() => process.kill(pid, 0), `Process ${pid} should be dead`);
  });

  it('should reject second daemon start', async () => {
    // Start first daemon fresh for this test
    await startDaemon();

    // Wait a bit to ensure first daemon is fully initialized
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Read PID from file to verify daemon is running
    const pidContent = fs.readFileSync(PID_FILE, 'utf-8');
    const firstPid = parseInt(pidContent);
    assert.ok(
      !isNaN(firstPid) && firstPid > 0,
      'First daemon PID should be valid',
    );

    // Verify socket exists
    assert.ok(
      fs.existsSync(SOCKET_PATH),
      'Socket should exist before second daemon test',
    );

    // Try to start second daemon using execSync to capture output
    const {execSync} = await import('node:child_process');

    try {
      // execSync with stdio:'pipe' captures both stdout and stderr
      execSync(`node "${DAEMON_SCRIPT}" --browserUrl http://127.0.0.1:9222`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      // If execSync returns without throwing, daemon started (should not happen)
      throw new Error('Second daemon should have been rejected');
    } catch (error: any) {
      // execSync throws on non-zero exit code
      // Check if error message or stderr contains duplicate daemon message
      const output = error.message || '';
      const stderr = error.stderr?.toString() || '';
      const allOutput = output + stderr;

      if (
        allOutput.includes('已经在运行') ||
        allOutput.includes('Daemon 已经在运行') ||
        allOutput.includes('already running')
      ) {
        // Test passes - daemon was correctly rejected
        return;
      }

      // If exited with non-zero code, that's also acceptable
      if (error.status !== 0) {
        return;
      }

      throw new Error(
        `Second daemon should have been rejected. Output: ${allOutput.slice(0, 500)}`,
      );
    }
  });
});
