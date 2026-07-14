/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * config 命令 — 自包含实现，仅管理本地 JSON 配置文件
 *
 * 配置文件路径：~/.browsercli/config.json
 * 支持的键：
 *   workerUrl  → 映射到环境变量 WORKER_URL
 *   apiToken   → 映射到环境变量 WORKER_API_TOKEN
 *
 * 环境变量 WORKER_URL / WORKER_API_TOKEN 优先级高于配置文件。
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import {dirname, join} from 'node:path';

import {parseArgs, getFlag, hasFlag} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

/** 合法配置键 */
const VALID_KEYS = new Set<string>(['workerUrl', 'apiToken']);

interface CliConfig {
  workerUrl?: string;
  apiToken?: string;
}

function getConfigPath(): string {
  return join(os.homedir(), '.browsercli', 'config.json');
}

function loadConfigFile(): CliConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CliConfig;
    }
    return {};
  } catch {
    return {};
  }
}

function writeConfigFile(config: CliConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
}

function parseSetValue(raw: string): {key: string; value: string} {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) {
    throw new AxiError(`--set 格式错误：${raw}`, 'VALIDATION_ERROR', [
      '正确格式：--set key=value',
      '示例：--set workerUrl=http://127.0.0.1:8765',
    ]);
  }
  return {key: raw.slice(0, eqIdx), value: raw.slice(eqIdx + 1)};
}

function validateKey(key: string): void {
  if (VALID_KEYS.has(key)) return;
  throw new AxiError(`未知配置键：${key}`, 'VALIDATION_ERROR', [
    '合法的键：' + [...VALID_KEYS].join(', '),
  ]);
}

/** 合并配置文件与环境变量，环境变量优先 */
function resolveMerged(): CliConfig {
  const file = loadConfigFile();
  return {
    workerUrl: process.env.WORKER_URL ?? file.workerUrl,
    apiToken: process.env.WORKER_API_TOKEN ?? file.apiToken,
  };
}

function initUserConfig(): {path: string; created: boolean} {
  const path = getConfigPath();
  if (existsSync(path)) {
    return {path, created: false};
  }
  writeConfigFile({});
  return {path, created: true};
}

export const configCommand: AxiCliCommand<WorkerContext> = async (
  args,
  _ctx,
) => {
  const parsed = parseArgs(args);

  // --init: 初始化配置文件
  if (hasFlag(parsed, 'init')) {
    const result = initUserConfig();
    return successOutput({
      command: 'config',
      action: 'init',
      path: result.path,
      created: result.created,
      message: result.created
        ? `配置文件已创建：${result.path}`
        : `配置文件已存在：${result.path}`,
    });
  }

  // --set key=value: 设置配置项
  const setRaw = getFlag(parsed, 'set');
  if (setRaw) {
    const {key, value} = parseSetValue(setRaw);
    validateKey(key);
    const config = loadConfigFile();
    (config as Record<string, string>)[key] = value;
    writeConfigFile(config);
    return successOutput({
      command: 'config',
      action: 'set',
      key,
      value,
      path: getConfigPath(),
    });
  }

  // --get key: 获取配置项
  const getKey = getFlag(parsed, 'get');
  if (getKey) {
    validateKey(getKey);
    const resolved = resolveMerged();
    return successOutput({
      command: 'config',
      action: 'get',
      key: getKey,
      value: (resolved as Record<string, unknown>)[getKey] ?? null,
    });
  }

  // --unset key: 删除配置项
  const unsetKey = getFlag(parsed, 'unset');
  if (unsetKey) {
    validateKey(unsetKey);
    const config = loadConfigFile();
    const deleted = unsetKey in config;
    delete (config as Record<string, unknown>)[unsetKey];
    writeConfigFile(config);
    return successOutput({
      command: 'config',
      action: 'unset',
      key: unsetKey,
      deleted,
      path: getConfigPath(),
    });
  }

  // --list: 列出配置文件路径和来源
  if (hasFlag(parsed, 'list')) {
    const path = getConfigPath();
    const exists = existsSync(path);
    return successOutput({
      command: 'config',
      action: 'list',
      path,
      exists,
      envOverrides: Object.keys(process.env).filter(
        k => k === 'WORKER_URL' || k === 'WORKER_API_TOKEN',
      ),
    });
  }

  // 默认：显示当前生效的配置（环境变量覆盖配置文件）
  const resolved = resolveMerged();
  return successOutput({
    command: 'config',
    action: 'show',
    resolved,
    file: getConfigPath(),
    envOverrides: Object.keys(process.env).filter(
      k => k === 'WORKER_URL' || k === 'WORKER_API_TOKEN',
    ),
  });
};
