/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 配置文件定位器（参考 chrome-devtools-mcp/src/config/ConfigLocator.ts）。
 *
 * 按优先级搜索已存在的配置文件（命中第一个即返回，不跨文件合并）：
 * - 若显式设置了 `BROWSERCLI_CONFIG_DIR` 或 `PROXYCLI_CONFIG_DIR`，仅搜索该目录下的 `config.json`（便于测试隔离）。
 * - 否则依次搜索：
 *   1. `${PLUGIN_DATA}/browsercli.config.json`（若设置 `PLUGIN_DATA`）
 *   2. `~/.browsercli/config.json`（BrowserCLI 默认用户级配置）
 *   3. 平台标准路径：Windows `%LOCALAPPDATA%/browsercli/config.json`；
 *      macOS/Linux `$XDG_CONFIG_HOME/browsercli/config.json`（仅接受绝对路径），回退 `~/.config/browsercli/config.json`
 *   4. `~/.proxycli/config.json`（旧版目录兼容回退）
 *
 * 设置 `BROWSERCLI_NO_CONFIG_DISCOVERY=true`（或 `1`/`yes`/`on`）可关闭自动发现；
 * 显式传入的 `--config` 不受此环境变量限制。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {parseEnvBoolean} from './browserInvariants.js';
import {
  LEGACY_CONFIG_DIR_NAME,
  PLUGIN_CONFIG_FILENAME,
  RUNTIME_DIR_NAME,
  USER_CONFIG_DIR_NAME,
  USER_CONFIG_FILENAME,
} from './constants.js';

export const NO_CONFIG_DISCOVERY_ENV = 'BROWSERCLI_NO_CONFIG_DISCOVERY';

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath, {throwIfNoEntry: false})?.isFile() ?? false;
  } catch {
    return false;
  }
}

export class ConfigLocator {
  /**
   * 获取用户级配置的规范写入路径：
   * 优先 `BROWSERCLI_CONFIG_DIR` / `PROXYCLI_CONFIG_DIR`，否则 `~/.browsercli/config.json`。
   */
  getPrimaryConfigPath(
    env: NodeJS.ProcessEnv = process.env,
    homedir: string = os.homedir(),
  ): string {
    const customDir = env['BROWSERCLI_CONFIG_DIR'] ?? env['PROXYCLI_CONFIG_DIR'];
    if (customDir) {
      return path.join(customDir, USER_CONFIG_FILENAME);
    }
    return path.join(homedir, USER_CONFIG_DIR_NAME, USER_CONFIG_FILENAME);
  }

  /**
   * 获取平台标准配置路径（Windows `%LOCALAPPDATA%` / POSIX `$XDG_CONFIG_HOME` / `~/.config`）。
   */
  getPlatformConfigPath(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    homedir: string = os.homedir(),
  ): string {
    if (platform === 'win32') {
      const localAppData = env['LOCALAPPDATA'];
      if (localAppData) {
        return path.join(localAppData, RUNTIME_DIR_NAME, USER_CONFIG_FILENAME);
      }
    } else {
      const xdgConfigHome = env['XDG_CONFIG_HOME'];
      if (xdgConfigHome && path.isAbsolute(xdgConfigHome)) {
        return path.join(xdgConfigHome, RUNTIME_DIR_NAME, USER_CONFIG_FILENAME);
      }
    }
    return path.join(homedir, '.config', RUNTIME_DIR_NAME, USER_CONFIG_FILENAME);
  }

  /**
   * 返回按优先级排序的配置文件搜索路径列表（已去重）。
   */
  getSearchPaths(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    homedir: string = os.homedir(),
  ): string[] {
    const customDir = env['BROWSERCLI_CONFIG_DIR'] ?? env['PROXYCLI_CONFIG_DIR'];
    if (customDir) {
      return [path.join(customDir, USER_CONFIG_FILENAME)];
    }

    const candidates: string[] = [];
    const pluginData = env['PLUGIN_DATA'];
    if (pluginData) {
      candidates.push(path.join(pluginData, PLUGIN_CONFIG_FILENAME));
    }
    candidates.push(
      path.join(homedir, USER_CONFIG_DIR_NAME, USER_CONFIG_FILENAME),
    );
    candidates.push(this.getPlatformConfigPath(env, platform, homedir));
    candidates.push(
      path.join(homedir, LEGACY_CONFIG_DIR_NAME, USER_CONFIG_FILENAME),
    );

    const seen = new Set<string>();
    return candidates.filter(candidate => {
      const normalized = path.normalize(candidate);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  /**
   * 查找第一个实际存在的配置文件路径；未找到或禁用自动发现时返回 `undefined`。
   */
  locate(
    env: NodeJS.ProcessEnv = process.env,
    checkIsFile: (filePath: string) => boolean = isFile,
    platform: NodeJS.Platform = process.platform,
    homedir: string = os.homedir(),
  ): string | undefined {
    const discoveryDisabled = env[NO_CONFIG_DISCOVERY_ENV];
    if (
      discoveryDisabled !== undefined &&
      discoveryDisabled !== '' &&
      parseEnvBoolean(discoveryDisabled) !== false
    ) {
      return undefined;
    }
    return this.getSearchPaths(env, platform, homedir).find(filePath =>
      checkIsFile(filePath),
    );
  }
}

export const defaultConfigLocator = new ConfigLocator();
