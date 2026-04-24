#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

function parseArgs(argv) {
  const args = {
    sekiroHost: 'ws://127.0.0.1:5612',
    group: 'js-reverse',
    timeout: 30000,
    params: undefined,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--sekiroHost':
        args.sekiroHost = argv[++i];
        break;
      case '--group':
        args.group = argv[++i];
        break;
      case '--timeout':
        args.timeout = Number(argv[++i]);
        break;
      case '--params':
        args.params = argv[++i];
        break;
      default:
        break;
    }
  }

  return args;
}

function toHttpUrl(wsUrl) {
  return wsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '');
}

async function invokeTool(httpUrl, group, toolName, params, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${httpUrl}/business/invoke`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        group,
        action: toolName,
        ...(Object.keys(params).length > 0 ? {params} : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        ok: false,
        status: 'http_error',
        error: `HTTP ${response.status}${errorText ? `: ${errorText}` : ''}`,
      };
    }

    const result = await response.json();
    if (result.status === -1 || result.code === -1) {
      return {
        ok: false,
        status: 'sekiro_error',
        error: result.message || 'Sekiro action 执行失败',
        data: result,
      };
    }

    return {ok: true, status: 'ok', data: result};
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {ok: false, status: 'timeout', error: `超时 (${timeout}ms)`};
    }
    return {
      ok: false,
      status: 'network_error',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function mergeParams(defaultParams, overrideText) {
  if (!overrideText) {
    return defaultParams;
  }

  const parsed = JSON.parse(overrideText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--params 必须是 JSON 对象');
  }

  return {...defaultParams, ...parsed};
}

export async function runToolCase({
  toolName,
  description,
  defaultParams,
  schema,
  callMode,
}) {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.sekiroHost);
  const finalParams = mergeParams(defaultParams, args.params);

  console.log(`\n=== Tool Case ===`);
  console.log(`tool       : ${toolName}`);
  console.log(`description: ${description}`);
  console.log(`callMode   : ${callMode || 'runtime'}`);
  console.log(`schema     : ${JSON.stringify(schema)}`);
  console.log(`params     : ${JSON.stringify(finalParams, null, 2)}`);
  console.log(`group      : ${args.group}`);
  console.log(`httpUrl    : ${httpUrl}`);

  const result = await invokeTool(
    httpUrl,
    args.group,
    toolName,
    finalParams,
    args.timeout,
  );

  if (!result.ok) {
    console.error(`\n[FAIL] ${toolName}`);
    console.error(`status: ${result.status}`);
    console.error(`error : ${result.error}`);
    process.exit(1);
  }

  console.log(`\n[OK] ${toolName}`);
  console.log(JSON.stringify(result.data, null, 2));
}
