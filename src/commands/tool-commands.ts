#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import {Command} from 'commander';
import type {JSHookToolDefinition} from '../tools/ToolRegistry.js';
import {sendCommand} from '../daemon/client.js';
import {getToolRegistry} from '../tools/index.js';

/**
 * 从 Zod 类型推断 commander 参数格式
 */
export function getParameterType(zodType: any): string {
  const typeName = zodType.constructor.name.toLowerCase();

  if (typeName.includes('array')) {
    return 'string'; // 数组作为逗号分隔的字符串处理
  }
  if (typeName.includes('boolean')) {
    return 'boolean';
  }
  if (typeName.includes('number') || typeName.includes('int')) {
    return 'number';
  }
  if (typeName.includes('enum')) {
    return 'string';
  }
  // 默认作为字符串
  return 'string';
}

/**
 * 检查字段是否必填
 */
export function isOptional(zodType: any): boolean {
  const typeName = zodType.constructor.name.toLowerCase();
  // Optional 包装的类型
  if (typeName.includes('optional')) {
    return true;
  }
  // 有 default 值的类型
  if (typeName.includes('default')) {
    return true;
  }
  return false;
}

/**
 * 从工具 schema 生成 commander 选项
 */
export function registerToolSchema(
  cmd: Command,
  schema: Record<string, any>,
): void {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  for (const [paramName, paramDef] of Object.entries(schema)) {
    const optional = isOptional(paramDef);
    const paramType = getParameterType(paramDef);

    // 从 zod 描述提取人类可读的描述
    let description = paramName;
    if (paramDef && typeof paramDef === 'object' && paramDef.description) {
      description = paramDef.description;
    }

    if (paramType === 'boolean') {
      // 布尔类型使用 --flag 格式
      cmd.option(`--${paramName}`, description);
    } else if (optional) {
      // 可选参数使用 [--param] 格式
      cmd.option(`--${paramName} <value>`, description);
    } else {
      // 必填参数使用 <param> 格式
      cmd.argument(`<${paramName}>`, description);
    }
  }
}

/**
 * 格式化工具执行结果
 */
export function formatResult(result: {
  success: boolean;
  result?: string;
  error?: string;
}): string {
  if (!result.success) {
    return `执行失败：${result.error || '未知错误'}`;
  }
  if (result.result) {
    return result.result;
  }
  return '执行成功';
}

/**
 * 为单个工具创建 CLI 命令
 */
function createToolCommand(program: Command, tool: JSHookToolDefinition): void {
  const cmd = program
    .command(tool.name)
    .description(tool.description || '无描述');

  // 注册 schema 参数
  if (tool.schema) {
    registerToolSchema(cmd, tool.schema);
  }

  // 执行动作
  cmd.action(async (...args: any[]) => {
    // commander 传递的参数：前面的参数是 positional args，倒数第二个是 options，最后一个是 command 本身
    const options = args[args.length - 2] || {};

    // 收集所有 positional 参数
    const positionalArgs: Record<string, unknown> = {};
    const schemaKeys = tool.schema ? Object.keys(tool.schema) : [];

    // 将 positional 参数映射到 schema 定义的参数名
    for (let i = 0; i < Math.min(args.length - 2, schemaKeys.length); i++) {
      positionalArgs[schemaKeys[i]] = args[i];
    }

    // 合并 positional 参数和选项
    const toolArgs: Record<string, unknown> = {
      ...positionalArgs,
      ...options,
    };

    // 处理数组参数（逗号分隔）
    for (const [key, value] of Object.entries(toolArgs)) {
      if (typeof value === 'string' && value.includes(',')) {
        const fieldSchema = tool.schema?.[key];
        if (fieldSchema) {
          const typeName = fieldSchema.constructor.name.toLowerCase();
          if (typeName.includes('array')) {
            toolArgs[key] = value.split(',').map((s: string) => s.trim());
          }
        }
      }
    }

    try {
      const result = await sendCommand({
        method: 'invoke_tool',
        tool: tool.name,
        args: toolArgs,
      });

      const output = formatResult(result);
      console.log(output);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`工具调用失败：${errorMessage}`);
      process.exit(1);
    }
  });
}

/**
 * 为所有已注册的工具生成 CLI 命令
 */
export async function generateToolCommands(program: Command): Promise<void> {
  try {
    // 先注册所有内置工具
    const {registerBuiltInTools} = await import('../tools/index.js');
    registerBuiltInTools();

    const registry = getToolRegistry();
    const tools = registry.values();

    // 已经手动注册的命令列表（避免重复）
    const manualCommands = new Set([
      'start',
      'stop',
      'status',
      'call-skill',
      'call-tool',
      'list-skills',
      'list-tools',
      'repl',
      'scaffold',
    ]);

    // 为每个工具生成命令
    for (const tool of tools) {
      // 跳过已经手动注册的命令
      if (manualCommands.has(tool.name)) {
        continue;
      }

      // 同时在根级别注册命令
      createToolCommand(program, tool);
    }
  } catch (error) {
    console.error('生成工具命令失败:', error);
    throw error;
  }
}
