#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 浏览器环境基准采集（原 MCP 工具 `compare_env` 的脚本化版本）。
 *
 * 工具层曾用 `frame.evaluate(collectEnvironment, properties)` 直接把参数送进页面；
 * 这条路随工具一起下线了，而 browsercli 的 `evaluate_script` 只接受一个**无参**
 * 函数或表达式（它内部自行 `value()` 调用），没法额外传参。所以这里把 properties
 * 固化进生成的脚本，再交给 evaluate_script 执行：
 *
 *   node compare-env.js --properties navigator.userAgent,screen.width --out env.js
 *   browsercli call evaluate_script --file env.js
 *
 * 输出结构与原工具一致：navigator / screen / canvas / webgl / audio / timing /
 * misc / custom 分组，每项带 value + type（读取失败时带 error）。
 * （注：当前采集实现聚焦于 navigator、screen、timing 及 custom，canvas/webgl/audio/misc 预留空对象对齐协议结构）
 */

import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

/**
 * 采集体：只依赖被注入的 `properties` 与页面全局对象，不含任何模块级引用。
 * 插入生成的表达式时直接内联，因此不要在这里引用外部变量。
 */
const COLLECTOR_BODY = `  const result = {
    navigator: {},
    screen: {},
    canvas: {},
    webgl: {},
    audio: {},
    timing: {},
    misc: {},
    custom: {},
  };

  const navigatorProperties = [
    'userAgent',
    'platform',
    'language',
    'languages',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'vendor',
    'cookieEnabled',
    'webdriver',
  ];
  for (const property of navigatorProperties) {
    try {
      const value = Reflect.get(navigator, property);
      result.navigator[property] = {value: String(value), type: typeof value};
    } catch (error) {
      result.navigator[property] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const screenProperties = [
    'width',
    'height',
    'availWidth',
    'availHeight',
    'colorDepth',
  ];
  for (const property of screenProperties) {
    try {
      const value = Reflect.get(screen, property);
      result.screen[property] = {value, type: typeof value};
    } catch (error) {
      result.screen[property] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  result.screen.devicePixelRatio = {
    value: window.devicePixelRatio,
    type: typeof window.devicePixelRatio,
  };

  result.timing.timezoneOffset = {
    value: new Date().getTimezoneOffset(),
    type: 'number',
  };
  result.timing.timezone = {
    value: Intl.DateTimeFormat().resolvedOptions().timeZone,
    type: 'string',
  };

  // 只接受点分隔属性路径；不执行表达式，避免把采集脚本变成任意代码执行入口。
  const propertyPathPattern = /^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*$/;
  for (const propertyPath of properties) {
    try {
      if (!propertyPathPattern.test(propertyPath)) {
        throw new Error(
          'Only dot-separated property paths are supported (for example navigator.userAgent)',
        );
      }
      const [root, ...segments] = propertyPath.split('.');
      if (!(root in globalThis)) throw new Error(root + ' is not defined');
      let value = Reflect.get(globalThis, root);
      for (const segment of segments) {
        if (value === null || value === undefined) {
          throw new Error('Cannot read ' + segment + ' from ' + String(value));
        }
        value = Reflect.get(Object(value), segment);
      }

      let serializedValue = String(value);
      if (typeof value === 'object' && value !== null) {
        const serialized = JSON.stringify(value);
        serializedValue =
          typeof serialized === 'string'
            ? serialized.substring(0, 500)
            : String(value);
      }
      result.custom[propertyPath] = {value: serializedValue, type: typeof value};
    } catch (error) {
      result.custom[propertyPath] = {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return result;`;

/**
 * 生成 evaluate_script 可执行的函数表达式。
 *
 * @param {string[]} properties 额外采集的点分隔属性路径
 * @returns {string}
 */
export function buildCompareEnvExpression(properties = []) {
  return [
    '() => {',
    `  const properties = ${JSON.stringify(properties)};`,
    '',
    COLLECTOR_BODY,
    '}',
  ].join('\n');
}

function parseList(value) {
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`
生成浏览器环境基准采集脚本（evaluate_script 可直接执行）。

用法:
  node compare-env.js [--properties a.b,c.d] [--out <file>]

options:
  --properties <list>  逗号分隔的点分隔属性路径，如 navigator.userAgent,screen.width
  --out <file>         写入文件（默认打印到 stdout）
  --json               额外把生成的脚本包成 {"function": "..."} JSON，便于 --stdin 传入
  --help               显示本帮助

输出: navigator / screen / timing / custom 分组基准，每项含 value + type。

示例:
  node compare-env.js --properties navigator.userAgent,navigator.webdriver --out env.js
  browsercli call evaluate_script --file env.js
  node compare-env.js --json | browsercli call evaluate_script --stdin
`);
}

function main() {
  const {values} = parseArgs({
    args: process.argv.slice(2),
    options: {
      properties: {type: 'string'},
      out: {type: 'string'},
      json: {type: 'boolean', default: false},
      help: {type: 'boolean', short: 'h', default: false},
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const expression = buildCompareEnvExpression(
    values.properties ? parseList(values.properties) : [],
  );
  const output = values.json
    ? JSON.stringify({function: expression}, null, 2)
    : expression;

  if (values.out) {
    writeFileSync(path.resolve(values.out), `${output}\n`, 'utf8');
    console.error(`[compare-env] → ${values.out}`);
    return;
  }
  console.log(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
