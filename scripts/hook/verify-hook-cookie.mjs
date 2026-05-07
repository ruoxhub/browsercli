#!/usr/bin/env node

/**
 * verify-hook-cookie.mjs — 验证 hook_cookie 工具
 *
 * 用法：
 *   node scripts/hook/verify-hook-cookie.mjs [--rpcHost ws://127.0.0.1:5612] [--group js-reverse] [--timeout 30000]
 */

function parseArgs(argv) {
  const args = { rpcHost: 'ws://127.0.0.1:5612', group: 'js-reverse', timeout: 30000 };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rpcHost': args.rpcHost = argv[++i]; break;
      case '--group': args.group = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
    }
  }
  return args;
}

function toHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
}

async function invokeTool(httpUrl, group, toolName, params, timeout) {
  const url = `${httpUrl}/business/invoke`;
  const body = { group, action: toolName, ...(Object.keys(params).length > 0 ? { params } : {}) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: 'http_error', httpStatus: response.status, error: await response.text().catch(() => '') };
    const result = await response.json();
    if (result.status === -1 || result.code === -1) return { ok: false, status: 'rpc_error', error: result.message || 'Sekiro action 执行失败', data: null };
    return { ok: true, status: 'ok', data: result.data ?? result };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, status: 'timeout', error: `超时 (${timeout}ms)` };
    return { ok: false, status: 'network_error', error: err.message };
  } finally { clearTimeout(timer); }
}

/** 从可能嵌套的响应中提取业务 payload */
function extractPayload(rawData) {
  if (!rawData || typeof rawData !== 'object') return null;
  // Sekiro 可能包裹: { status: 0, data: { success: true, ... } }
  // 也可能直接: { success: true, ... }
  const d = rawData.data ?? rawData;
  if (d && typeof d === 'object' && 'success' in d) return d;
  if (rawData && typeof rawData === 'object' && 'success' in rawData) return rawData;
  return null;
}

const TEST_CASES = [
  {
    name: '监控所有 Cookie 操作',
    params: {},
    validate: (payload) => {
      const errs = [];
      if (payload.success !== true) errs.push(`success 期望 true，实际 ${payload.success}`);
      const hookId = payload.data?.hookId ?? payload.hookId;
      if (!hookId) errs.push('hookId 缺失');
      const msg = payload.message || '';
      if (!msg.includes('已安装')) errs.push(`message 未包含"已安装"，实际: ${msg.slice(0, 60)}`);
      if (!msg.includes('监控所有')) errs.push(`message 未包含"监控所有"，实际: ${msg.slice(0, 60)}`);
      return errs;
    },
  },
  {
    name: '按 Cookie 名过滤',
    params: { filterKeys: ['acw_tc'] },
    validate: (payload) => {
      const errs = [];
      if (payload.success !== true) errs.push(`success 期望 true，实际 ${payload.success}`);
      const hookId = payload.data?.hookId ?? payload.hookId;
      if (!hookId) errs.push('hookId 缺失');
      const msg = payload.message || '';
      if (!msg.includes('已安装')) errs.push(`message 未包含"已安装"，实际: ${msg.slice(0, 60)}`);
      if (!msg.includes('acw_tc')) errs.push(`message 未包含过滤关键词 "acw_tc"，实际: ${msg.slice(0, 60)}`);
      return errs;
    },
  },
  {
    name: '打印调用栈',
    params: { showStack: true },
    validate: (payload) => {
      const errs = [];
      if (payload.success !== true) errs.push(`success 期望 true，实际 ${payload.success}`);
      const hookId = payload.data?.hookId ?? payload.hookId;
      if (!hookId) errs.push('hookId 缺失');
      const msg = payload.message || '';
      if (!msg.includes('已安装')) errs.push(`message 未包含"已安装"，实际: ${msg.slice(0, 60)}`);
      return errs;
    },
  },
];

async function main() {
  const args = parseArgs(process.argv);
  const httpUrl = toHttpUrl(args.rpcHost);
  let passCount = 0;
  let failCount = 0;

  console.log('\n🔍 hook_cookie 验证');
  console.log(`   Sekiro: ${httpUrl}  Group: ${args.group}  Timeout: ${args.timeout}ms\n`);

  console.log('⏳ 检查 Sekiro Server...');
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok && resp.status !== 302) throw new Error(`HTTP ${resp.status}`);
  } catch {
    console.error(`❌ Sekiro Server 不可用: ${httpUrl}`);
    process.exit(1);
  }
  console.log('✓ Sekiro Server 可用\n');

  console.log('⏳ 创建初始页面...');
  const newPageResult = await invokeTool(httpUrl, args.group, 'new_page', { url: 'https://qiye.qizhidao.com/', timeout: 10000 }, args.timeout);
  if (!newPageResult.ok) {
    console.log(`✗ 初始页面创建失败: ${newPageResult.error?.slice(0, 80) || newPageResult.status}`);
    process.exit(1);
  }
  console.log('✓ 初始页面已创建\n');
  await new Promise(r => setTimeout(r, 1500));

  console.log('⏳ 执行测试用例...\n');
  for (const tc of TEST_CASES) {
    const start = Date.now();
    const result = await invokeTool(httpUrl, args.group, 'hook_cookie', tc.params, args.timeout);
    const duration = Date.now() - start;

    let businessErrs = [];
    if (!result.ok) {
      businessErrs.push(`RPC 失败: ${result.status} — ${result.error?.slice(0, 120)}`);
    } else {
      const payload = extractPayload(result.data);
      if (!payload) {
        businessErrs.push(`无法解析业务 payload，原始数据: ${JSON.stringify(result.data).slice(0, 200)}`);
      } else {
        businessErrs = tc.validate(payload);
      }
    }

    const passed = businessErrs.length === 0;
    if (passed) {
      passCount++;
      console.log(`  ✓ ${tc.name} (${duration}ms)`);
    } else {
      failCount++;
      console.log(`  ✗ ${tc.name} (${duration}ms)`);
      for (const e of businessErrs) console.log(`    ${e}`);
    }

    // 无论是否通过，都打印原始数据摘要供调试
    if (result.ok) {
      const payload = extractPayload(result.data);
      if (payload) {
        const hookId = payload.data?.hookId ?? payload.hookId;
        console.log(`    [原始] success=${payload.success}, hookId=${hookId}, message=${payload.message?.slice(0, 60)}`);
      } else {
        console.log(`    [原始] ${JSON.stringify(result.data).slice(0, 200)}`);
      }
    } else {
      console.log(`    [原始] status=${result.status}, error=${result.error?.slice(0, 120)}`);
    }
    console.log('');
    await new Promise(r => setTimeout(r, 800));
  }

  const total = passCount + failCount;
  console.log('═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${total}  失败: ${failCount}/${total}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
