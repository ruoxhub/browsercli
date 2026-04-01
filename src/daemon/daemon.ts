#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import {createServer, type Server} from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {logger} from '../logger.js';
import {PipeTransport} from '../third_party/index.js';
import type {DaemonMessage} from './types.js';
import {
  getDaemonPid,
  getPidFilePath,
  getSocketPath,
  IS_WINDOWS,
  isDaemonRunning,
} from './utils.js';

// 技能系统导入
import {SkillRegistry, SkillRunner, registerBuiltInSkills} from '../skills/index.js';
import {logger as skillLogger} from '../utils/logger.js';

const pid = getDaemonPid();
if (isDaemonRunning(pid)) {
  logger('Another daemon process is running.');
  process.exit(1);
}

const pidFilePath = getPidFilePath();
fs.mkdirSync(path.dirname(pidFilePath), {
  recursive: true,
});
fs.writeFileSync(pidFilePath, process.pid.toString());
logger(`Writing ${process.pid.toString()} to ${pidFilePath}`);

const socketPath = getSocketPath();

const startDate = new Date();
const mcpServerArgs = process.argv.slice(2);

// 初始化技能系统
registerBuiltInSkills();
const skillRegistry = SkillRegistry.getInstance();
skillLogger.info(`Daemon: Registered ${skillRegistry.list().length} skills`);

let server: Server | null = null;

async function handleRequest(msg: DaemonMessage) {
  try {
    if (msg.method === 'invoke_skill') {
      const {skill, args = {}} = msg;
      if (!skill) {
        return {success: false, error: 'Missing skill name'};
      }

      const runner = new SkillRunner();
      const result = await runner.run(skill, {
        url: (args.url as string) || undefined,
        options: args,
      });

      return {
        success: result.success,
        result: JSON.stringify(result),
      };
    } else if (msg.method === 'list_skills') {
      const skills = skillRegistry.list();
      return {
        success: true,
        result: JSON.stringify({
          skills: skills.map((s) => ({
            name: s.name,
            description: s.description,
            category: s.category,
          })),
        }),
      };
    } else if (msg.method === 'stop') {
      setImmediate(() => {
        void cleanup();
      });
      return {
        success: true,
        message: 'stopping',
      };
    } else if (msg.method === 'status') {
      return {
        success: true,
        result: JSON.stringify({
          pid: process.pid,
          socketPath,
          startDate: startDate.toISOString(),
          args: mcpServerArgs,
        }),
      };
    }
    return {
      success: false,
      error: `Unknown method: ${msg.method}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function startSocketServer() {
  // Remove existing socket file if it exists (only on non-Windows)
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore errors.
    }
  }

  return await new Promise<void>((resolve, reject) => {
    server = createServer(socket => {
      const transport = new PipeTransport(socket, socket);
      transport.onmessage = async (message: string) => {
        logger('onmessage', message);
        const response = await handleRequest(JSON.parse(message));
        transport.send(JSON.stringify(response));
        socket.end();
      };
      socket.on('error', error => {
        logger('Socket error:', error);
      });
    });

    server.listen(
      {
        path: socketPath,
        readableAll: false,
        writableAll: false,
      },
      () => {
        console.log(`Daemon server listening on ${socketPath}`);
        resolve();
      },
    );

    server.on('error', error => {
      logger('Server error:', error);
      reject(error);
    });
  });
}

async function cleanup() {
  console.log('Cleaning up daemon...');

  if (server) {
    await new Promise<void>(resolve => {
      server!.close(() => resolve());
    });
  }
  if (!IS_WINDOWS) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore errors
    }
  }
  logger(`unlinking ${pidFilePath}`);
  if (fs.existsSync(pidFilePath)) {
    fs.unlinkSync(pidFilePath);
  }
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => {
  void cleanup();
});
process.on('SIGINT', () => {
  void cleanup();
});
process.on('SIGHUP', () => {
  void cleanup();
});

// Handle uncaught errors
process.on('uncaughtException', error => {
  logger('Uncaught exception:', error);
});
process.on('unhandledRejection', error => {
  logger('Unhandled rejection:', error);
});

// Start the server
startSocketServer().catch(error => {
  logger('Failed to start daemon server:', error);
  process.exit(1);
});
