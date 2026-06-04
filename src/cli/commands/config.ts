/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * config 命令 — 查看/设置/初始化全局配置
 *
 * 用法：
 *   js-reverse config              — 显示当前生效的配置
 *   js-reverse config --init       — 初始化用户级配置文件
 *   js-reverse config --set key=value — 设置配置项
 *   js-reverse config --get key    — 获取配置项
 *   js-reverse config --list       — 列出配置文件路径和来源
 *   js-reverse config --unset key  — 删除配置项
 */

import type {AxiCliCommand} from 'axi-sdk-js';
import {AxiError} from 'axi-sdk-js';

import {
  resolveConfig,
  showConfigInfo,
  initUserConfig,
  setUserConfigValue,
  deleteUserConfigValue,
  getUserConfigPath,
  loadUserConfig,
  writeConfigFile,
  type GlobalConfig,
} from '../../config.js';
import {parseArgs, getFlag, hasFlag} from '../args-parser.js';
import {successOutput} from '../output.js';
import type {WorkerContext} from '../types.js';

/** 配置键 → 描述 */
const CONFIG_KEY_DESCRIPTIONS: Record<string, string> = {
  rpcHost: 'Sekiro Server WebSocket 地址',
  group: 'Sekiro 分组名',
  browserUrl: '浏览器调试 URL',
  wsEndpoint: 'WebSocket 端点',
  headless: '无头模式 (true/false)',
  executablePath: '浏览器可执行路径',
  runtimeDirName: '运行时目录名',
  llmProvider: 'AI 提供商 (openai)',
  toolResultRecording: '工具结果记录配置',
  debug: '调试模式 (true/false)',
};

/** 合法的配置键 */
const VALID_KEYS = new Set<string>(Object.keys(CONFIG_KEY_DESCRIPTIONS));

/** 支持嵌套的键（用点号分隔） */
const NESTED_KEYS: Record<string, string> = {
  'openai.apiKey': 'openai',
  'openai.baseURL': 'openai',
  'openai.model': 'openai',
  'browser.headless': 'browser',
  'browser.isolated': 'browser',
  'browser.executablePath': 'browser',
  'browser.channel': 'browser',
  'browser.useStealthScripts': 'browser',
  'toolResultRecording.enabled': 'toolResultRecording',
  'toolResultRecording.outputDir': 'toolResultRecording',
};

function parseSetValue(raw: string): {key: string; value: string} {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) {
    throw new AxiError(`--set 格式错误：${raw}`, 'VALIDATION_ERROR', [
      '正确格式：--set key=value',
      '示例：--set rpcHost=ws://127.0.0.1:5612',
    ]);
  }
  return {key: raw.slice(0, eqIdx), value: raw.slice(eqIdx + 1)};
}

function validateKey(key: string): void {
  if (VALID_KEYS.has(key)) return;
  if (key in NESTED_KEYS) return;
  throw new AxiError(`未知配置键：${key}`, 'VALIDATION_ERROR', [
    '合法的顶级键：' + Object.keys(CONFIG_KEY_DESCRIPTIONS).join(', '),
    '嵌套键示例：openai.apiKey, browser.headless',
  ]);
}

function coerceValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
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

    const coerced = coerceValue(value);

    // 嵌套键处理
    if (key in NESTED_KEYS) {
      const parentKey = NESTED_KEYS[key]!;
      const subKey = key.split('.')[1]!;
      // 读取当前配置，修改嵌套值，写回
      const userConfig = loadUserConfig();
      const existing = userConfig.config ?? ({} as GlobalConfig);
      const parent =
        ((existing as Record<string, unknown>)[parentKey] as
          | Record<string, unknown>
          | undefined) ?? {};
      parent[subKey] = coerced;
      (existing as Record<string, unknown>)[parentKey] = parent;
      writeConfigFile(getUserConfigPath(), existing);
    } else {
      setUserConfigValue(key as keyof GlobalConfig, coerced);
    }

    return successOutput({
      command: 'config',
      action: 'set',
      key,
      value: coerced,
      path: getUserConfigPath(),
    });
  }

  // --get key: 获取配置项
  const getKey = getFlag(parsed, 'get');
  if (getKey) {
    validateKey(getKey);
    const cfg = resolveConfig();
    const value = (cfg as unknown as Record<string, unknown>)[getKey];
    return successOutput({
      command: 'config',
      action: 'get',
      key: getKey,
      value: value ?? null,
    });
  }

  // --unset key: 删除配置项
  const unsetKey = getFlag(parsed, 'unset');
  if (unsetKey) {
    validateKey(unsetKey);
    if (unsetKey in NESTED_KEYS) {
      // 嵌套键：将子项设为 undefined 然后写回
      const parentKey = NESTED_KEYS[unsetKey]!;
      const subKey = unsetKey.split('.')[1]!;
      const userConfig = loadUserConfig();
      const existing = userConfig.config;
      if (existing) {
        const parent = (existing as Record<string, unknown>)[parentKey] as
          | Record<string, unknown>
          | undefined;
        if (parent && subKey in parent) {
          delete parent[subKey];
          writeConfigFile(getUserConfigPath(), existing);
          return successOutput({
            command: 'config',
            action: 'unset',
            key: unsetKey,
            path: getUserConfigPath(),
          });
        }
      }
      return successOutput({
        command: 'config',
        action: 'unset',
        key: unsetKey,
        message: '键不存在于配置文件中',
      });
    }
    const deleted = deleteUserConfigValue(unsetKey as keyof GlobalConfig);
    return successOutput({
      command: 'config',
      action: 'unset',
      key: unsetKey,
      deleted,
      path: getUserConfigPath(),
    });
  }

  // --list: 列出配置文件路径和来源
  if (hasFlag(parsed, 'list')) {
    const userPath = getUserConfigPath();
    const userConfig = loadUserConfig();

    return successOutput({
      command: 'config',
      action: 'list',
      sources: [
        {
          type: 'user',
          path: userPath,
          exists: userConfig.exists,
          config: userConfig.config ?? null,
        },
      ],
      envOverrides: Object.keys(process.env).filter(
        k =>
          k.startsWith('SEKIRO_') ||
          k.startsWith('BROWSER_') ||
          k.startsWith('JSREVERSER_') ||
          k === 'DEFAULT_LLM_PROVIDER',
      ),
    });
  }

  // 默认：显示当前生效的完整配置
  const info = showConfigInfo();
  return successOutput({
    command: 'config',
    action: 'show',
    resolved: info.resolved,
    sources: info.sources.map(s => ({
      path: s.filePath,
      exists: s.exists,
    })),
    envOverrides: info.envOverrides,
  });
};
