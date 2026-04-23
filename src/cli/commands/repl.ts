/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import * as readline from 'node:readline';

import type {AxiCliCommand} from 'axi-sdk-js';
import type {WorkerContext} from '../types.js';
import {SekiroInvoker} from '../sekiro-invoker.js';
import type {WorkerState} from '../../index.js';
import {getWorkerState} from '../../index.js';
import {resolveConfig} from '../../config.js';

const REPL_COMMANDS = [
  'status',
  'list-skills',
  'list-tools',
  'help',
  'exit',
  'quit',
];

/**
 * REPL 会话 — 封装所有可变状态，避免模块级变量泄漏
 */
class ReplSession {
  private skillNames: string[] | null = null;
  private toolNames: string[] | null = null;
  private readonly invoker: SekiroInvoker;
  private readonly workerState: WorkerState;
  private readonly group: string;

  constructor(invoker: SekiroInvoker, workerState: WorkerState, group: string) {
    this.invoker = invoker;
    this.workerState = workerState;
    this.group = group;
  }

  async getSkillNames(): Promise<string[]> {
    if (this.skillNames) return this.skillNames;
    const {getBuiltInSkillDefinitions} = await import('../../skills/index.js');
    this.skillNames = getBuiltInSkillDefinitions().map(s => s.name);
    return this.skillNames;
  }

  async getToolNamesList(): Promise<string[]> {
    if (this.toolNames) return this.toolNames;
    const {getAllToolNames} = await import('../tools-meta.js');
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
      if (cmd === 'skill') {
        const skills = await this.getSkillNames();
        return skills.filter(s => s.startsWith(partial));
      }
      if (cmd === 'tool') {
        const tools = await this.getToolNamesList();
        return tools.filter(t => t.startsWith(partial));
      }
    }

    return [];
  }

  async listSkillsRepl(): Promise<void> {
    try {
      const result = await this.invoker.invoke(this.group, '_list_skills') as {
        skills?: Array<{name: string; category?: string; description: string}>;
      };
      const skills = result.skills || [];
      replLog(`可用技能 (${skills.length}):`);
      for (const s of skills) {
        replLog(`  - ${s.name} (${s.category}): ${s.description}`);
      }
      return;
    } catch {
      const skills = await this.getSkillNames();
      replLog(`可用技能 (${skills.length}):`);
      for (const s of skills) replLog(`  - ${s}`);
      replLog('\n(离线模式：显示内置技能列表)');
    }
  }

  async listToolsRepl(): Promise<void> {
    try {
      const result = await this.invoker.invoke(this.group, '_list_tools') as {
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
      const running = this.workerState.running;
      if (running) {
        replLog('状态：Worker 运行中');
      } else {
        replLog('状态：Worker 未运行');
      }
      return true;
    }

    if (trimmed === 'list-skills') {
      await this.listSkillsRepl();
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
      replLog('用法：skill <name> [args...] 或 tool <name> [args...]');
      replLog('输入 "help" 查看完整帮助');
      return true;
    }

    try {
      if (type === 'skill') {
        const actionName = `skill_${name}`;
        const result = await this.invoker.invoke(this.group, actionName, {args: restArgs});
        replLog(JSON.stringify(result, null, 2));
      } else if (type === 'tool') {
        const result = await this.invoker.invoke(this.group, name, {args: restArgs});
        replLog(JSON.stringify(result, null, 2));
      } else {
        replLog('未知命令类型，使用 "skill" 或 "tool"');
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
  replLog('  skill <name> [args...]  - 调用指定技能');
  replLog('  tool <name> [args...]   - 调用指定工具');
  replLog('  status                  - 查看 Worker 状态');
  replLog('  list-skills             - 列出可用技能');
  replLog('  list-tools              - 列出可用工具');
  replLog('  help                    - 显示此帮助信息');
  replLog('  exit / quit             - 退出 REPL');
  replLog('');
}

/** 导出 complete 供外部使用（保持向后兼容） */
export async function complete(input: string): Promise<string[]> {
  // 临时创建无状态 session 来补全，不缓存
  const {getBuiltInSkillDefinitions} = await import('../../skills/index.js');
  const {getAllToolNames} = await import('../tools-meta.js');
  const parts = input.split(/\s+/);
  const isLastCharSpace = input.endsWith(' ') && input.length > 0;

  if (parts.length <= 1 && !isLastCharSpace) {
    const partial = parts[0].toLowerCase();
    return REPL_COMMANDS.filter(cmd => cmd.startsWith(partial));
  }

  if (parts.length === 2 && !isLastCharSpace) {
    const cmd = parts[0].toLowerCase();
    const partial = parts[1].toLowerCase();
    if (cmd === 'skill') {
      return getBuiltInSkillDefinitions().map(s => s.name).filter(s => s.startsWith(partial));
    }
    if (cmd === 'tool') {
      return getAllToolNames().filter(t => t.startsWith(partial));
    }
  }

  return [];
}

export const replCommand: AxiCliCommand<WorkerContext> = async (
  _args,
  ctx,
) => {
  const cfg = ctx?.resolvedConfig ?? resolveConfig();
  const invoker = ctx?.invoker ?? new SekiroInvoker({sekiroHost: cfg.sekiroHost});
  const workerState = ctx?.workerState ?? getWorkerState();

  const session = new ReplSession(invoker, workerState, cfg.group);

  if (workerState.running) {
    replLog('Worker 运行中');
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
  const replDone = new Promise<void>(r => { resolveRepl = r; });

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
