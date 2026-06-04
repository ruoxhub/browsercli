/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';

import type {AxiCliCommand} from 'axi-sdk-js';

import {resolveConfig} from '../../config.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import type {WorkerContext} from '../types.js';
import {WorkerManager} from '../worker-manager.js';

const REPL_COMMANDS = ['status', 'list-tools', 'help', 'exit', 'quit'];

/**
 * REPL 会话 — 封装所有可变状态，避免模块级变量泄漏
 */
class ReplSession {
  private toolNames: string[] | null = null;
  private readonly invoker: SekiroInvoker;
  private readonly workerManager: WorkerManager;
  private readonly group: string;

  constructor(
    invoker: SekiroInvoker,
    workerManager: WorkerManager,
    group: string,
  ) {
    this.invoker = invoker;
    this.workerManager = workerManager;
    this.group = group;
  }

  async getToolNamesList(): Promise<string[]> {
    if (this.toolNames) return this.toolNames;
    const {ensureToolsMeta, getAllToolNames} = await import('../tools-meta.js');
    await ensureToolsMeta();
    this.toolNames = getAllToolNames();
    return this.toolNames;
  }

  async complete(input: string): Promise<string[]> {
    const parts = input.split(/\s+/);
    const isLastCharSpace = input.endsWith(' ') && input.length > 0;

    if (parts.length <= 1 && !isLastCharSpace) {
      const partial = parts[0].toLowerCase();
      return REPL_COMMANDS.filter(cmd => cmd.startsWith(partial));
    }

    if (parts.length === 2 && !isLastCharSpace) {
      const cmd = parts[0].toLowerCase();
      const partial = parts[1].toLowerCase();
      if (cmd === 'tool') {
        const tools = await this.getToolNamesList();
        return tools.filter(t => t.startsWith(partial));
      }
    }

    return [];
  }

  async listToolsRepl(): Promise<void> {
    try {
      const result = (await this.invoker.invoke(this.group, '_list_tools')) as {
        tools?: Array<{name: string; description?: string}>;
      };
      const tools = result.tools || [];
      replLog(`可用工具 (${tools.length}):`);
      for (const t of tools) {
        replLog(`  - ${t.name}: ${t.description || ''}`);
      }
      return;
    } catch {
      const tools = await this.getToolNamesList();
      replLog(`可用工具 (${tools.length}):`);
      for (const t of tools) replLog(`  - ${t}`);
      replLog('\n(离线模式：显示内置工具列表)');
    }
  }

  async processLine(rl: readline.Interface, line: string): Promise<boolean> {
    const trimmed = line.trim();

    if (trimmed === 'exit' || trimmed === 'quit') {
      rl.close();
      return false;
    }

    if (trimmed === 'help') {
      printHelp();
      return true;
    }

    if (trimmed === 'status') {
      const running = this.workerManager.isRunning();
      const pid = this.workerManager.getPid();
      if (running) {
        replLog(`状态：PID=${pid} | Worker 运行中`);
      } else {
        replLog('状态：Worker 未运行');
      }
      return true;
    }

    if (trimmed === 'list-tools') {
      await this.listToolsRepl();
      return true;
    }

    if (!trimmed) {
      return true;
    }

    const parts = trimmed.split(/\s+/);
    const [type, name, ...restArgs] = parts;

    if (!type || !name) {
      replLog('用法：tool <name> [args...]');
      replLog('输入 "help" 查看完整帮助');
      return true;
    }

    try {
      if (type === 'tool') {
        const result = await this.invoker.invoke(this.group, name, {
          args: restArgs,
        });
        replLog(JSON.stringify(result, null, 2));
      } else {
        replLog('未知命令类型，使用 "tool"');
        replLog('输入 "help" 查看完整帮助');
      }
    } catch (error) {
      replLog(`执行失败：${error instanceof Error ? error.message : error}`);
    }

    return true;
  }
}

function replLog(msg: string): void {
  process.stderr.write(msg + '\n');
}

function printHelp(): void {
  replLog('可用命令：');
  replLog('  tool <name> [args...]   - 调用指定工具');
  replLog('  status                  - 查看 Worker 状态');
  replLog('  list-tools              - 列出可用工具');
  replLog('  help                    - 显示此帮助信息');
  replLog('  exit / quit             - 退出 REPL');
  replLog('');
}

export const replCommand: AxiCliCommand<WorkerContext> = async (_args, ctx) => {
  const cfg = ctx?.resolvedConfig ?? resolveConfig();
  const invoker =
    ctx?.invoker ?? new SekiroInvoker({rpcHost: cfg.rpcHost});
  const workerManager = ctx?.workerManager ?? new WorkerManager();

  const session = new ReplSession(invoker, workerManager, cfg.group);

  if (workerManager.isRunning()) {
    const pid = workerManager.getPid();
    replLog(`Worker 运行中 (PID: ${pid})`);
  } else {
    replLog('Worker 未运行，请先执行：js-reverse start --browserUrl <url>');
    replLog('');
  }

  replLog('进入交互模式 (REPL)');
  printHelp();

  const isTTY = process.stdin.isTTY;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    tabSize: 2,
    completer: isTTY
      ? line => session.complete(line).then(c => [c, line])
      : undefined,
    terminal: isTTY,
  });

  rl.on('SIGINT', () => {
    replLog('');
    if (isTTY) prompt();
  });

  // 注意：不在 close 事件中调用 process.exit()，
  // 让 readline 自然结束，调用者决定如何退出
  let resolveRepl: () => void;
  const replDone = new Promise<void>(r => {
    resolveRepl = r;
  });

  rl.on('close', () => {
    resolveRepl();
  });

  const prompt = () => {
    rl.question('js-reverse> ', async input => {
      const shouldContinue = await session.processLine(rl, input);
      if (shouldContinue && isTTY) {
        prompt();
      }
    });
  };

  if (!isTTY) {
    rl.on('line', async line => {
      await session.processLine(rl, line);
    });
  } else {
    prompt();
  }

  // 等待 REPL 结束
  await replDone;

  return {status: 'info', command: 'repl', message: 'REPL session ended'};
};
