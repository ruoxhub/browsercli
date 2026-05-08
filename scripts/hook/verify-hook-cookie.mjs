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
  const sc = rawData.structuredContent;
  if (sc && typeof sc === 'object' && 'success' in sc) return sc;
  const d = rawData.data ?? rawData;
  if (d && typeof d === 'object' && 'success' in d) return d;
  if (rawData && typeof rawData === 'object' && 'success' in rawData) return rawData;
  return null;
}

/** 从 evaluate_script 的 markdown 包裹中提取 JSON */
function extractEvaluateResult(rawData) {
  if (!rawData || typeof rawData !== 'object') return null;

  // evaluate_script 通过 appendResponseLine 输出，Sekiro 响应中对应 text 字段
  const textSource = rawData.text ?? rawData.structuredContent;
  if (!textSource || typeof textSource !== 'string') {
    // structuredContent 可能是对象（如 hook_cookie 使用 setStructuredContent）
    // evaluate_script 只用 appendResponseLine，所以一定是字符串
    return null;
  }

  const m = textSource.match(/```json\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    // evaluate_script 的 result 字段是 JSON.stringify 后的字符串，需要再解析一次
    if (parsed && typeof parsed.result === 'string') {
      try { parsed.parsedResult = JSON.parse(parsed.result); } catch { /* result 不是有效 JSON，忽略 */ }
    }
    return parsed;
  } catch { return null; }
}

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

  // ── 公共：创建页面 ──
  async function createPage() {
    const r = await invokeTool(httpUrl, args.group, 'new_page', { url: 'https://www.baidu.com/', timeout: 10000 }, args.timeout);
    if (!r.ok) {
      console.log(`✗ 页面创建失败: ${r.error?.slice(0, 80) || r.status}`);
      process.exit(1);
    }
    // 等待页面完全加载并稳定
    await new Promise(res => setTimeout(res, 2000));
    return r;
  }

  /** 触发 Cookie 读写并验证 hook 是否被触发 */
  async function triggerCookieAndVerify(tcName, cookieExpr, hookId, timeout) {
    // 触发 Cookie 操作
    console.log(`    ⏳ 触发 Cookie 读写...`);
    const evalResult = await invokeTool(httpUrl, args.group, 'evaluate_script', {
      function: cookieExpr,
    }, timeout);
    const evalData = extractEvaluateResult(evalResult.data);
    if (evalData?.success) {
      const display = evalData.parsedResult
        ? JSON.stringify(evalData.parsedResult).slice(0, 120)
        : (evalData.result?.slice(0, 120) || 'ok');
      console.log(`    ✓ evaluate_script 返回: ${display}`);
    } else {
      console.log(`    ⚠ evaluate_script 可能失败: ${evalData?.message || 'unknown'}`);
      // 如果 evaluate_script 失败，打印原始响应以便调试
      if (evalResult.data) {
        const rawText = evalResult.data.text ?? '';
        if (rawText) console.log(`    原始响应: ${rawText.slice(0, 200)}`);
      }
    }
    await new Promise(res => setTimeout(res, 800));

    // 拉取 hook 数据（方式 1：通过 get_hook_data 工具）
    console.log(`    ⏳ 拉取 hook 记录...`);
    const dataResult = await invokeTool(httpUrl, args.group, 'get_hook_data', { hookId, view: 'raw' }, timeout);
    const dataPayload = extractPayload(dataResult.data);
    let records = [];
    if (dataPayload?.success) {
      records = dataPayload.data?.[hookId] || [];
      console.log(`    ✓ get_hook_data 返回 ${records.length} 条记录`);
    } else {
      console.log(`    ⚠ get_hook_data 失败，尝试直接读取浏览器 hookStore...`);
      console.log(`    ${JSON.stringify(dataPayload || dataResult.data).slice(0, 200)}`);
    }

    // 拉取 hook 数据（方式 2：直接通过 evaluate_script 读取 window.__hookStore，作为备用）
    if (records.length === 0) {
      console.log(`    ⏳ 尝试直接读取浏览器 hookStore...`);
      const storeResult = await invokeTool(httpUrl, args.group, 'evaluate_script', {
        function: `() => {
          const store = window.__hookStore;
          if (!store) return { error: '__hookStore 不存在' };
          const records = store[${JSON.stringify(hookId)}] || [];
          return { hookId: ${JSON.stringify(hookId)}, count: records.length, records: records.slice(-10) };
        }`,
      }, timeout);
      const storeData = extractEvaluateResult(storeResult.data);
      if (storeData?.success && storeData.parsedResult) {
        const directRecords = storeData.parsedResult.records || [];
        console.log(`    ✓ 直接读取 hookStore: ${directRecords.length} 条记录`);
        if (directRecords.length > 0) {
          records = directRecords;
        } else {
          const errMsg = storeData.parsedResult.error;
          if (errMsg) console.log(`    ✗ ${errMsg}`);
        }
      } else if (storeData && !storeData.success) {
        console.log(`    ⚠ 读取 hookStore 失败: ${storeData.message}`);
      }
    }

    return { records, evalData };
  }

  // ── 用例 1：监控所有 Cookie 操作 ──
  {
    const tcName = '监控所有 Cookie 操作';
    console.log(`  ⏳ [${tcName}] 创建页面...`);
    await createPage();

    // 1. 安装 hook
    let start = Date.now();
    let result = await invokeTool(httpUrl, args.group, 'hook_cookie', {}, args.timeout);
    let duration = Date.now() - start;
    const hookPayload = extractPayload(result.data);
    if (!result.ok || !hookPayload || hookPayload.success !== true) {
      failCount++;
      console.log(`  ✗ [${tcName}] Hook 安装失败 (${duration}ms)`);
      console.log(`    ${JSON.stringify(hookPayload || result.data).slice(0, 200)}`);
    } else {
      console.log(`  ✓ [${tcName}] Hook 安装成功 (${duration}ms) — ${hookPayload.message}`);

      // 2. 触发 Cookie 操作并验证
      const { records, evalData } = await triggerCookieAndVerify(
        tcName,
        `() => {
          const before = document.cookie;
          document.cookie = 'test_verify_cookie=hello123; path=/';
          const after = document.cookie;
          return { before: before.slice(0, 200), after: after.slice(0, 200), changed: after !== before };
        }`,
        'hook_cookie',
        args.timeout,
      );

      // 3. 检查结果
      for (const rec of records.slice(-5)) {
        console.log(`      [${rec.event}] ${rec.cookie?.slice(0, 80) || rec.keys?.join(', ') || JSON.stringify(rec).slice(0, 80)}`);
      }
      if (records.some(r => r.event === 'set' && String(r.cookie || '').includes('test_verify_cookie'))) {
        passCount++;
        console.log(`  ✓ [${tcName}] 验证通过 — 捕获到测试 Cookie 设置`);
      } else {
        failCount++;
        console.log(`  ✗ [${tcName}] 验证失败 — 未捕获到测试 Cookie 设置`);
        if (records.length === 0 && evalData && !evalData.success) {
          console.log(`    提示: evaluate_script 失败可能导致 Cookie 未被设置，请检查浏览器连接`);
        }
      }
    }
    console.log('');
  }

  // ── 用例 2：按 Cookie 名过滤 ──
  {
    const tcName = '按 Cookie 名过滤';
    console.log(`  ⏳ [${tcName}] 创建页面...`);
    await createPage();

    let start = Date.now();
    let result = await invokeTool(httpUrl, args.group, 'hook_cookie', { filterKeys: ['acw_tc'] }, args.timeout);
    let duration = Date.now() - start;
    const hookPayload = extractPayload(result.data);
    if (!result.ok || !hookPayload || hookPayload.success !== true) {
      failCount++;
      console.log(`  ✗ [${tcName}] Hook 安装失败 (${duration}ms)`);
    } else {
      console.log(`  ✓ [${tcName}] Hook 安装成功 (${duration}ms) — ${hookPayload.message}`);

      // 触发多个 cookie 操作并验证
      const { records: records2 } = await triggerCookieAndVerify(
        tcName,
        `() => {
          const oldVal = document.cookie;
          document.cookie = 'other_cookie=abc; path=/';
          document.cookie = 'acw_tc=testvalue; path=/';
          return { oldVal: oldVal.slice(0, 200), newVal: document.cookie.slice(0, 200) };
        }`,
        'hook_cookie',
        args.timeout,
      );

      for (const rec of records2.slice(-5)) {
        console.log(`      [${rec.event}] keys=${rec.keys?.join(', ') || '-'}, matched=${rec.matchedFilters?.join(', ') || '-'}`);
      }
      if (records2.some(r => r.event === 'set' && r.keys?.some(k => k.includes('acw_tc')))) {
        passCount++;
        console.log(`  ✓ [${tcName}] 验证通过 — 过滤成功捕获 acw_tc`);
      } else {
        failCount++;
        console.log(`  ✗ [${tcName}] 验证失败 — 未捕获到过滤目标 acw_tc`);
      }
    }
    console.log('');
  }

  // ── 用例 3：打印调用栈 ──
  {
    const tcName = '打印调用栈';
    console.log(`  ⏳ [${tcName}] 创建页面...`);
    await createPage();

    let start = Date.now();
    let result = await invokeTool(httpUrl, args.group, 'hook_cookie', { showStack: true }, args.timeout);
    let duration = Date.now() - start;
    const hookPayload = extractPayload(result.data);
    if (!result.ok || !hookPayload || hookPayload.success !== true) {
      failCount++;
      console.log(`  ✗ [${tcName}] Hook 安装失败 (${duration}ms)`);
    } else {
      console.log(`  ✓ [${tcName}] Hook 安装成功 (${duration}ms) — ${hookPayload.message}`);

      // 触发 Cookie 操作并验证
      const { records: records3 } = await triggerCookieAndVerify(
        tcName,
        `() => {
          const oldVal = document.cookie;
          document.cookie = 'stack_test=1; path=/';
          return { oldVal: oldVal.slice(0, 200), newVal: document.cookie.slice(0, 200) };
        }`,
        'hook_cookie',
        args.timeout,
      );

      for (const rec of records3.slice(-3)) {
        const hasStack = rec.stack && String(rec.stack).length > 10;
        console.log(`      [${rec.event}] hasStack=${hasStack}, stackPreview=${hasStack ? String(rec.stack).slice(0, 60).replace(/\n/g, '\\n') : 'none'}`);
      }
      if (records3.some(r => r.stack && String(r.stack).length > 10)) {
        passCount++;
        console.log(`  ✓ [${tcName}] 验证通过 — 记录包含调用栈`);
      } else {
        failCount++;
        console.log(`  ✗ [${tcName}] 验证失败 — 记录未包含调用栈`);
      }
    }
    console.log('');
  }

  const total = passCount + failCount;
  console.log('═══════════════════════════════════════════════════');
  console.log(`  通过: ${passCount}/${total}  失败: ${failCount}/${total}`);
  console.log(`  结果: ${failCount === 0 ? '✓ 全部通过' : '✗ 存在失败'}`);
  console.log('═══════════════════════════════════════════════════\n');
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch(err => { console.error('致命错误:', err); process.exit(2); });
