/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {GlobalConfig} from '../config.js';
import type {WorkerStartOptions} from '../types/platform.js';

type ResolvedWorkerConfig = Required<Pick<WorkerStartOptions, 'headless'>> &
  Pick<WorkerStartOptions, 'browserUrl' | 'wsEndpoint' | 'executablePath'>;

const BOOLEAN_FLAG_MAP: Record<string, keyof GlobalConfig> = {
  // 核心隐身与模式
  '--headless': 'headless',
  '--cloak': 'cloak',
  '--js-stealth': 'jsStealth',
  '--jsstealth': 'jsStealth',
  '--full-stealth-args': 'fullStealthArgs',
  '--fullstealthargs': 'fullStealthArgs',
  '--minimal-stealth': 'minimalStealth',
  '--minimalstealth': 'minimalStealth',
  '--auto-connect': 'autoConnect',
  '--autoconnect': 'autoConnect',
  '--isolated': 'isolated',
  '--accept-insecure-certs': 'acceptInsecureCerts',
  '--acceptinsecurecerts': 'acceptInsecureCerts',

  // 工具分类开关 (Category flags)
  '--category-input': 'categoryInput',
  '--categoryinput': 'categoryInput',
  '--category-navigation': 'categoryNavigation',
  '--categorynavigation': 'categoryNavigation',
  '--category-emulation': 'categoryEmulation',
  '--categoryemulation': 'categoryEmulation',
  '--category-performance': 'categoryPerformance',
  '--categoryperformance': 'categoryPerformance',
  '--category-network': 'categoryNetwork',
  '--categorynetwork': 'categoryNetwork',
  '--category-debugging': 'categoryDebugging',
  '--categorydebugging': 'categoryDebugging',
  '--category-extensions': 'categoryExtensions',
  '--categoryextensions': 'categoryExtensions',
  '--category-experimental-third-party': 'categoryExperimentalThirdParty',
  '--categoryexperimentalthirdparty': 'categoryExperimentalThirdParty',
  '--category-memory': 'categoryMemory',
  '--categorymemory': 'categoryMemory',
  '--category-experimental-webmcp': 'categoryExperimentalWebmcp',
  '--categoryexperimentalwebmcp': 'categoryExperimentalWebmcp',
  '--category-pwa': 'categoryPwa',
  '--categorypwa': 'categoryPwa',

  // 截图与视觉
  '--experimental-vision': 'experimentalVision',
  '--experimentalvision': 'experimentalVision',

  // 调试与实验特性
  '--experimental-devtools': 'experimentalDevtools',
  '--experimentaldevtools': 'experimentalDevtools',
  '--memory-debugging': 'memoryDebugging',
  '--memorydebugging': 'memoryDebugging',
  '--experimental-memory': 'experimentalMemory',
  '--experimentalmemory': 'experimentalMemory',
  '--experimental-include-all-pages': 'experimentalIncludeAllPages',
  '--experimentalincludeallpages': 'experimentalIncludeAllPages',
  '--experimental-screencast': 'experimentalScreencast',
  '--experimentalscreencast': 'experimentalScreencast',
  '--performance-crux': 'performanceCrux',
  '--performancecrux': 'performanceCrux',
  '--usage-statistics': 'usageStatistics',
  '--usagestatistics': 'usageStatistics',
  '--javascript-evaluation': 'javascriptEvaluation',
  '--javascriptevaluation': 'javascriptEvaluation',
  '--file-navigations': 'fileNavigations',
  '--filenavigations': 'fileNavigations',
  '--source-maps': 'sourceMaps',
  '--sourcemaps': 'sourceMaps',
  '--redact-network-headers': 'redactNetworkHeaders',
  '--redactnetworkheaders': 'redactNetworkHeaders',

  // 工作区与配置监听
  '--allow-unrestricted-paths': 'allowUnrestrictedPaths',
  '--allowunrestrictedpaths': 'allowUnrestrictedPaths',
  '--watch-config': 'watchConfig',
  '--watchconfig': 'watchConfig',
};

const VALUE_FLAG_MAP: Record<string, keyof GlobalConfig> = {
  // 短别名
  '-u': 'browserUrl',
  '-w': 'wsEndpoint',
  '-e': 'executablePath',

  // 浏览器连接
  '--browserurl': 'browserUrl',
  '--browser-url': 'browserUrl',
  '--executablepath': 'executablePath',
  '--executable-path': 'executablePath',
  '--wsendpoint': 'wsEndpoint',
  '--ws-endpoint': 'wsEndpoint',
  '--wsheaders': 'wsHeaders',
  '--ws-headers': 'wsHeaders',
  '--userdatadir': 'userDataDir',
  '--user-data-dir': 'userDataDir',
  '--channel': 'channel',
  '--proxyserver': 'proxyServer',
  '--proxy-server': 'proxyServer',

  // 截图与性能
  '--screenshotformat': 'screenshotFormat',
  '--screenshot-format': 'screenshotFormat',
  '--screenshotquality': 'screenshotQuality',
  '--screenshot-quality': 'screenshotQuality',
  '--screenshotmaxwidth': 'screenshotMaxWidth',
  '--screenshot-max-width': 'screenshotMaxWidth',
  '--screenshotmaxheight': 'screenshotMaxHeight',
  '--screenshot-max-height': 'screenshotMaxHeight',
  '--maxnavigationsaved': 'maxNavigationSaved',
  '--max-navigation-saved': 'maxNavigationSaved',

  // 调试与录屏
  '--logfile': 'logFile',
  '--log-file': 'logFile',
  '--experimentalffmpegpath': 'experimentalFfmpegPath',
  '--experimental-ffmpeg-path': 'experimentalFfmpegPath',
  '--screencastfps': 'screencastFps',
  '--screencast-fps': 'screencastFps',
  '--experimentalscreencastfps': 'experimentalScreencastFps',
  '--experimental-screencast-fps': 'experimentalScreencastFps',

  // 配置
  '--config': 'config',
};

const ARRAY_FLAG_MAP: Record<string, keyof GlobalConfig> = {
  '--chromearg': 'chromeArg',
  '--chrome-arg': 'chromeArg',
  '--ignoredefaultchromearg': 'ignoreDefaultChromeArg',
  '--ignore-default-chrome-arg': 'ignoreDefaultChromeArg',
  '--blockedurlpattern': 'blockedUrlPattern',
  '--blocked-url-pattern': 'blockedUrlPattern',
  '--allowedurlpattern': 'allowedUrlPattern',
  '--allowed-url-pattern': 'allowedUrlPattern',
  '--workspace': 'workspace',
  '--filesystemroot': 'filesystemRoot',
  '--filesystem-root': 'filesystemRoot',
};

function normalizeKey(flag: string): string {
  return flag.toLowerCase();
}

/**
 * 解析 Worker 命令行参数为 GlobalConfig 格式。
 */
export function parseWorkerArgs(args: string[]): GlobalConfig {
  const cliConfig: GlobalConfig = {};

  for (let i = 0; i < args.length; i++) {
    const rawArg = args[i];
    let flag = rawArg;
    let inlineValue: string | undefined;

    const eq = rawArg.indexOf('=');
    if (eq > 0) {
      flag = rawArg.slice(0, eq);
      if (eq + 1 < rawArg.length) {
        inlineValue = rawArg.slice(eq + 1);
      } else {
        console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
        continue;
      }
    }

    const norm = normalizeKey(flag);

    // 1. 检查布尔参数取反形式 (--no-xxx)
    if (norm.startsWith('--no-')) {
      const positiveNorm = '--' + norm.slice(5);
      const boolKey = BOOLEAN_FLAG_MAP[positiveNorm];
      if (boolKey) {
        (cliConfig as Record<string, unknown>)[boolKey] = false;
        continue;
      }
    }

    // 2. 检查普通布尔参数
    const boolKey = BOOLEAN_FLAG_MAP[norm];
    if (boolKey) {
      if (inlineValue !== undefined) {
        const valLower = inlineValue.toLowerCase();
        (cliConfig as Record<string, unknown>)[boolKey] = !(
          valLower === 'false' ||
          valLower === '0' ||
          valLower === 'no' ||
          valLower === 'off'
        );
      } else {
        (cliConfig as Record<string, unknown>)[boolKey] = true;
      }
      continue;
    }

    // 3. 检查数组参数
    const arrayKey = ARRAY_FLAG_MAP[norm];
    if (arrayKey) {
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
          continue;
        }
        value = args[++i];
      }
      const existing = (cliConfig as Record<string, unknown>)[arrayKey];
      const items = Array.isArray(existing) ? existing : [];
      // 允许逗号分隔传入多个
      items.push(
        ...value
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      );
      (cliConfig as Record<string, unknown>)[arrayKey] = items;
      continue;
    }

    // 4. 检查单值参数
    const valueKey = VALUE_FLAG_MAP[norm];
    if (valueKey) {
      let value: string | undefined = inlineValue;
      if (value === undefined) {
        if (i + 1 >= args.length || args[i + 1].startsWith('-')) {
          console.warn(`[Worker] 参数 ${rawArg} 缺少值，已忽略`);
          continue;
        }
        value = args[++i];
      }
      (cliConfig as Record<string, unknown>)[valueKey] = value as never;
      continue;
    }

    console.warn(`[Worker] 未知参数: ${rawArg}，已忽略`);
  }

  return cliConfig;
}

/**
 * 将 ResolvedConfig 转换为 WorkerStartOptions。
 */
export function toWorkerOptions(
  resolved: ResolvedWorkerConfig,
): WorkerStartOptions {
  const {browserUrl, executablePath, headless, wsEndpoint} = resolved;
  return {
    browserUrl,
    executablePath,
    headless,
    wsEndpoint,
  };
}
