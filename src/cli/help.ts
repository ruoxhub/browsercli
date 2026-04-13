/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AxiStructuredOutput} from './output.js';
import {renderOutput} from './output.js';

export function generateTopLevelHelp(options?: {
  bin?: string;
  description?: string;
  version?: string;
  commands?: string[];
}): string {
  const opts = {
    bin: options?.bin ?? 'js-reverse',
    description:
      options?.description ??
      'JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程',
    version: options?.version ?? '2.0.3',
    commands: options?.commands ?? [
      'start',
      'stop',
      'status',
      'call',
      'call-skill',
      'list-skills',
      'list-tools',
      'repl',
      'scaffold',
    ],
  };
  const output: AxiStructuredOutput = {
    bin: opts.bin,
    description: opts.description,
    version: opts.version,
    commands: opts.commands,
  };
  return renderOutput(output);
}

export function generateCommandHelp(command: string): string | null {
  const helpMap: Record<string, {description: string; usage: string}> = {
    start: {
      description: '启动后台 daemon 服务',
      usage:
        'js-reverse start [--browserUrl <url>] [--wsEndpoint <endpoint>] [--headless] [--http] [--port <port>]',
    },
    stop: {
      description: '停止后台 daemon 服务',
      usage: 'js-reverse stop',
    },
    status: {
      description: '查看 daemon 状态',
      usage: 'js-reverse status',
    },
    call: {
      description: '调用 MCP 工具',
      usage: 'js-reverse call <tool-name> [--param value]',
    },
    'call-skill': {
      description: '调用逆向工程技能',
      usage: 'js-reverse call-skill <skill-name> [--url <url>] [--data <json>]',
    },
    'list-skills': {
      description: '列出所有可用的逆向工程技能',
      usage: 'js-reverse list-skills [--json]',
    },
    'list-tools': {
      description: '列出所有可用的 MCP 工具',
      usage: 'js-reverse list-tools [--json]',
    },
    repl: {
      description: '启动交互式 REPL 模式',
      usage: 'js-reverse repl',
    },
    scaffold: {
      description: '创建新的逆向任务脚手架',
      usage:
        'js-reverse scaffold --name <name> [--desc <description>] [--url <url>] [--output <directory>]',
    },
  };

  const help = helpMap[command];
  if (!help) return null;

  const output: AxiStructuredOutput = {
    command,
    description: help.description,
    usage: help.usage,
  };
  return renderOutput(output);
}
