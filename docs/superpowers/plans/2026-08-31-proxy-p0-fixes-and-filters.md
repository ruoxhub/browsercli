# Proxy 域 P0 修复与过滤能力 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 buffer 分支 >1MB 响应导致客户端挂死的实测缺陷（含 IPv6 CONNECT authority 解析），补上进程内域名过滤（CONNECT 旁路 + HTTP/`ws://` 记录过滤）与 4 个 `mitm_*_host_filter*` MCP 工具。

**Architecture:** `MitmProxyServer.relayResponse` 的 buffer 分支在 `totalResSize` 越限的那一刻「叛逃到 live-pipe」——调 `afterResponse`（`body:null` + `truncated:true`，与 live-pipe 同构）拿 header 改写结果、`writeHead`、把已 buffer 的**完整原始压缩字节**写给客户端、`proxyRes.pipe(clientRes)` 接管，`escapeCommitted` 门闩冻结 capture 缓冲在 1MB 并让 `end` handler 只 emit。域名过滤由 `MitmModule` 持有 `allow`/`block` 两个 `Set`，经新增可选构造参数把 `shouldBypass` 传进 `MitmProxyServer`，在 `handleConnect`（真旁路，不签证书）、`handleHttpRequest`、`handleWsUpgrade` 三处生效。全进程内、无持久化。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、`node:http` / `node:https` / `node:tls` / `node:net`、`node:test`（经 `npm run build` 后跑 `build/tests/**`）、zod（`src/third_party/index.ts`）、Prettier + ESLint（平铺配置）。

**Spec:** `docs/superpowers/specs/2026-08-31-proxy-p0-fixes-and-filters-design.md`（本计划实现其 §2 SP1 与 §3 SP2，对应 §2.4 / §3.5 测试、§5 验证闭环）

---

## Global Constraints

- Node 版本：`^20.19.0 || ^22.12.0 || >=23`（`package.json` engines）。**本轮不新增任何依赖**。
- Prettier：`singleQuote: true`、`trailingComma: 'all'`、`arrowParens: 'avoid'`、`bracketSpacing: false`、`endOfLine: 'lf'`（`.prettierrc.cjs`）。
- ESLint：导入按字母序分组（`node:` 内置 → 裸包 → 上级 `../../`/`../` → 同级 `./`），组间空一行；类型导入显式 `import type`。报 `import/order` 时跑 `npx eslint --fix <file>` 后重跑，**不要手工猜顺序**。
- License 头（已核实现存文件）：`src/modules/proxy/**` 与 `tests/unit/**` 用 `Copyright 2026 Google LLC`；`src/tools/proxy/*.ts` 用 `Copyright 2026 Google LLC`，**但 `src/tools/proxy/manifest.ts` 是 `Copyright 2026 Browser-CLI`**（改动它是 Modify，保持原头不改）。4 个新工具文件属 `src/tools/proxy/`，用 `Google LLC`。
- 生产代码禁 `console.log`，一律用 `logger`（`src/utils/logger.ts`）。
- 工具定义用 `defineTool`（`src/tools/ToolDefinition.ts`），category 固定 `ToolCategory.NETWORK`，schema 用 `zod`。
- 根 `tsconfig.json` 是松配置（`strict:false`、`noUnusedLocals:false`），**漏掉的可选链只能靠测试暴露** —— 红灯必须真跑、必须真红。
- **红线（本轮不动）**：`src/web/`、`src/web-ui/`、`proxycli/`、`worker/`、`src/modules/session/**`、`src/modules/network/**`、数据库迁移（spec §6）。
- **不要用 `npm run check-format` 当门禁**：`eslint --cache .` 会连 `open-source/` 一起扫 OOM，`prettier --check .` 有既有 warn。文件级门禁用 `npx prettier --check <file>` + `npx eslint <file>`。
- 提交信息 Conventional Commits（`fix(proxy): ...` / `feat(proxy): ...`）。
- **工作区卫生**：每个 Task 的 `git add` 只列本 Task 显式文件，禁止 `git add -A`；提交前 `git status --porcelain` 核对。
- 单测运行模板（`<path>` 换成 `build/tests/...` 下路径）：

  ```bash
  npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/<path>.test.js
  ```

---

## 文件结构

| 文件                                               | 责任                                                           | 状态   |
| -------------------------------------------------- | -------------------------------------------------------------- | ------ |
| `src/modules/proxy/MitmProxyServer.ts`             | 叛逃到 live-pipe、`parseConnectAuthority`、三处 `shouldBypass` | Modify |
| `src/modules/proxy/hostFilter.ts`                  | 新增 `normalizeHost`（纯函数，单测友好）                       | Create |
| `src/modules/proxy/MitmModule.ts`                  | `allow`/`block` 集合 + 4 个方法 + 传 `shouldBypass`            | Modify |
| `src/modules/proxy/types.ts`                       | 新增 4 组 HostFilter params/data 类型                          | Modify |
| `src/modules/proxy/index.ts`                       | re-export 新类型 + `normalizeHost`                             | Modify |
| `src/tools/proxy/addHostFilter.ts`                 | `mitm_add_host_filter`                                         | Create |
| `src/tools/proxy/listHostFilters.ts`               | `mitm_list_host_filters`                                       | Create |
| `src/tools/proxy/removeHostFilter.ts`              | `mitm_remove_host_filter`                                      | Create |
| `src/tools/proxy/clearHostFilters.ts`              | `mitm_clear_host_filters`                                      | Create |
| `src/tools/proxy/index.ts`                         | 4 个 re-export                                                 | Modify |
| `src/tools/proxy/manifest.ts`                      | 4 条 tool entry                                                | Modify |
| `tests/unit/modules/proxy/MitmProxyServer.test.ts` | SP1 红灯 ×2 + 一致性 + IPv6；SP2 三层次                        | Modify |
| `tests/unit/modules/proxy/MitmModule.test.ts`      | host filter 增删查清 + 白/黑名单语义                           | Modify |
| `tests/unit/modules/proxy/hostFilter.test.ts`      | `normalizeHost` 纯函数                                         | Create |
| `tests/unit/tools/proxy/tools.test.ts`             | `EXPECTED_TOOLS` 增 4                                          | Modify |

---

## Task 1: SP1-a —— 两条红灯先落地（判定期预判 + 数据期叛逃）

**Files:**

- Test: `tests/unit/modules/proxy/MitmProxyServer.test.ts`

> **为什么先写测试**：spec §2.2 有两条独立路径（content-length 预判 → live-pipe；chunked 数据期 → 叛逃）。**只写一条会让另一条的实现成为死代码**。两条红灯必须在 Task 2/3 之前先红着。

**Interfaces:**

- Consumes: 现有 `startOriginServer`（`:19`）/ `requestViaProxy`（`:42`）测试具；`MitmRuleEngine`；`MAX_BODY_SIZE`（= `MAX_CAPTURED_BODY_BYTES` = 1MB，`src/modules/network/constants.ts:21`）。
- Produces: 两个新源站变体 + 3 个新用例（本 Task 先写 2 条红灯）。

- [ ] **Step 1: 加两个大 body 源站变体**

在 `tests/unit/modules/proxy/MitmProxyServer.test.ts` 的 `startOriginServer`（`:19-37`）之后、`requestViaProxy` 之前追加：

```ts
/** 大 body 源站：固定 content-length（Node 不切 chunked）。 */
async function startBigOriginServer(sizeBytes: number) {
  return new Promise<{port: number; close: () => Promise<void>}>(
    (resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(sizeBytes),
        });
        res.end(Buffer.alloc(sizeBytes, 'a'));
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('bad address'));
          return;
        }
        resolve({
          port: address.port,
          close: () => new Promise<void>(r => server.close(() => r())),
        });
      });
    },
  );
}

/**
 * 大 body 源站：不设 content-length，分块写（Node 自动切 chunked）。
 * 这条才走「数据期叛逃」路径 —— 少了它，escapeToPipe 零覆盖率。
 */
async function startChunkedBigOriginServer(
  sizeBytes: number,
  chunkBytes: number = 64 * 1024,
) {
  return new Promise<{port: number; close: () => Promise<void>}>(
    (resolve, reject) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, {'content-type': 'text/plain'});
        let sent = 0;
        while (sent < sizeBytes) {
          const n = Math.min(chunkBytes, sizeBytes - sent);
          res.write(Buffer.alloc(n, 'b'));
          sent += n;
        }
        res.end();
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('bad address'));
          return;
        }
        resolve({
          port: address.port,
          close: () => new Promise<void>(r => server.close(() => r())),
        });
      });
    },
  );
}
```

> `requestViaProxy` 返回的是 `body: string`。3MB 全 `'a'` 拼成字符串开销大但可控（3MB），不要改成 Buffer —— 保持与既有具一致，断言用 `body.length`。

- [ ] **Step 2: 写红灯 A（content-length 预判 → live-pipe）**

在 `describe('MitmProxyServer', ...)` 末尾追加：

```ts
it(
  '>1MB 响应带 content-length 时客户端收满且不挂',
  {timeout: 10000},
  async () => {
    const BIG = 3 * 1024 * 1024;
    const origin = await startBigOriginServer(BIG);
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'body-1',
      action: {
        type: 'modify_body',
        phase: 'response',
        find: 'a',
        replace: 'a',
      },
      enabled: true,
    });
    const proxy = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      rules,
    );
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/big`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.body.length, BIG, '客户端必须收满 3MB');
      assert.ok(captured, '必须产生 capture 记录');
      assert.strictEqual(captured.truncated, true);
      assert.strictEqual(captured.responseBodySize, BIG);
    } finally {
      await proxy.stop();
      await origin.close();
    }
  },
);
```

> `find: 'a'` / `replace: 'a'` 是**恒等替换**：只为让 `hasResponseBodyRules()` 返回 true 从而进入 buffer 分支判定，同时 `substitute` 结果与原 body 相等 → 不产生 modification，把变量降到最少。

> ⚠️ **`{timeout: 10000}` 不可省**：node:test 默认 timeout 是 `Infinity`，修复前这条会**永久挂住 CI** 而不是报红。

- [ ] **Step 3: 写红灯 B（chunked → 数据期叛逃）**

紧接红灯 A 之后追加：

```ts
it(
  '>1MB chunked 响应叛逃后客户端收满且 capture 保留前 1MB',
  {timeout: 10000},
  async () => {
    const BIG = 3 * 1024 * 1024;
    const origin = await startChunkedBigOriginServer(BIG);
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'body-2',
      action: {
        type: 'modify_body',
        phase: 'response',
        find: 'b',
        replace: 'b',
      },
      enabled: true,
    });
    const proxy = new MitmProxyServer(
      ca,
      exchange => {
        captured = exchange;
      },
      rules,
    );
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/big`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.body.length, BIG, '客户端必须收满 3MB');
      assert.ok(captured, '必须产生 capture 记录');
      assert.strictEqual(captured.truncated, true);
      assert.strictEqual(captured.responseBodySize, BIG);
      assert.strictEqual(
        captured.responseBody?.length,
        1024 * 1024,
        'capture 保留前 1MB 文本（MAX_BODY_SIZE）',
      );
    } finally {
      await proxy.stop();
      await origin.close();
    }
  },
);
```

- [ ] **Step 4: 跑测试确认两条红灯都失败**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmProxyServer.test.js
```

Expected: 两条新用例**都超时失败**（客户端挂死：拿到 content-length 但零字节 body，`end` 永不触发），10s 后报 timeout 而不是永久挂住。既有用例仍 PASS。

> 若某条「意外通过」，先查 `hasResponseBodyRules()` 是否真返回 true（规则 `enabled` + `phase:'response'`），别急着往下走 —— 通过意味着没进 buffer 分支，红灯无效。

- [ ] **Step 5: 提交红灯（不动实现）**

```bash
git add tests/unit/modules/proxy/MitmProxyServer.test.ts
git commit -m "test(proxy): add red tests for >1MB response hang in buffer branch"
```

> 红灯单独一个 commit，便于回滚时保留测试。

---

## Task 2: SP1-b —— 叛逃到 live-pipe（修复挂死）

**Files:**

- Modify: `src/modules/proxy/MitmProxyServer.ts`

**Interfaces:**

- Consumes: `MAX_BODY_SIZE`（已 import，`:21`）、`bodyToUtf8`（已 import）、`AfterResponseResult`（已 import）。
- Produces: `relayResponse` 内新增 `escapeToPipe()` 局部变量 + `escapeCommitted` 门闩；`onBodyData` 触发叛逃；`end` handler 分流。

- [ ] **Step 1: 加 content-length 预判（判定期优化）**

`src/modules/proxy/MitmProxyServer.ts` 的 `bufferBody` 判定（`:541-542`）：

```ts
const bufferBody =
  !isBinary && this.interceptor?.hasResponseBodyRules() === true;
```

改成：

```ts
// 判定期预判：响应头已声明 content-length 且超限 → 直接 live-pipe，连那 1MB 都不 buffer。
const declaredLength = Number(proxyRes.headers['content-length']);
const oversizedByHeader =
  Number.isFinite(declaredLength) && declaredLength > MAX_BODY_SIZE;
const bufferBody =
  !isBinary &&
  !oversizedByHeader &&
  this.interceptor?.hasResponseBodyRules() === true;
```

> `Number(undefined)` = `NaN` → `Number.isFinite` false → 无 content-length 时不预判，交给数据期叛逃兜底。

- [ ] **Step 2: `onBodyData` 触发叛逃**

`onBodyData`（`:544-548`）：

```ts
const onBodyData = (chunk: Buffer): void => {
  if (totalResSize < MAX_BODY_SIZE) resBodyChunks.push(chunk);
  else truncated = true;
  totalResSize += chunk.length;
};
```

改成：

```ts
const onBodyData = (chunk: Buffer): void => {
  if (!escapeCommitted) {
    if (totalResSize < MAX_BODY_SIZE) resBodyChunks.push(chunk);
    else escapeToPipe();
  }
  totalResSize += chunk.length;
};
```

- [ ] **Step 3: 实现 `escapeToPipe` + 状态变量**

把 `let truncated = false;`（`:537`）整块替换为下面这段（**必须在 `onBodyData` 声明之前**，否则 `onBodyData` 闭包引用 TDZ 变量）：

```ts
let truncated = false;
let escapedEmit: (() => void) | null = null;
let escapeCommitted = false;

/**
 * 越限叛逃到 live-pipe（spec §2.2）：已 buffer 的是压缩后原始字节，
 * 不能只发一半 —— 把完整已 buffer 字节写给客户端后交给 pipe 接管。
 * 语义与 live-pipe 完全同构：afterResponse 传 body:null，header 改写照常生效，
 * body 改写由 rewrite.ts:356 的 body===null → continue 天然跳过。
 */
const escapeToPipe = (): void => {
  if (escapeCommitted) return;
  escapeCommitted = true;
  truncated = true;

  logger.warn(
    `[MitmProxy] response body 超过 ${MAX_BODY_SIZE} 字节，跳过 response body 改写规则：${flow.url}`,
  );

  const after = this.interceptor?.afterResponse?.({
    requestId,
    method,
    url: flow.url,
    requestHeaders: flow.headers,
    requestBody: flow.body.length > 0 ? flow.body : null,
    statusCode,
    headers: this.headersToRecord(proxyRes.headers),
    body: null,
    truncated: true,
  }) as AfterResponseResult | undefined;

  let outHeaders = this.headersToRecord(proxyRes.headers);
  const mod = after?.modification;
  if (mod?.setHeaders || mod?.removeHeaders) {
    outHeaders = applyHeaderChanges(outHeaders, {
      set: mod.setHeaders,
      remove: mod.removeHeaders,
    });
  }

  clientRes.writeHead(statusCode, outHeaders);
  // 只写字节，不清空 resBodyChunks —— 它还要留给 emit 解码成 capture 文本。
  for (const chunk of resBodyChunks) clientRes.write(chunk);
  proxyRes.pipe(clientRes);

  escapedEmit = () =>
    emit(
      outHeaders,
      null,
      after !== undefined || (appliedRuleIds?.length ?? 0) > 0,
      [...(appliedRuleIds ?? []), ...(after?.appliedRuleIds ?? [])],
      Buffer.concat(resBodyChunks),
    );
};
```

> 📌 **声明顺序不可乱**：`escapedEmit` / `escapeCommitted` 必须在 `onBodyData` **之前**，`escapeToPipe` 必须在 `onBodyData` **之前**（都是 `const`/`let` 闭包引用，TDZ 会在运行期抛 `ReferenceError`，而根 `tsconfig.json` 是松配置不会在编译期拦住 —— 只能靠红灯暴露）。

> ⚠️ **不要在 `escapeToPipe` 里调 `fixHeadersAfterBodyRewrite`**：body 未改写，content-length 必须原样透传（spec §2.2 关键正确性点），否则客户端收到的字节数与头部声明不符。

> ⚠️ **不要清空 `resBodyChunks`**：同一个数组既喂客户端又喂 capture（spec §2.2 H1）。清空了 capture 就是空的。

- [ ] **Step 4: `end` handler 分流**

buffer 分支的 `proxyRes.on('end')`（`:593`）开头插入分流。把：

```ts
      proxyRes.on('end', () => {
        const buffered =
```

改成：

```ts
      proxyRes.on('end', () => {
        // 叛逃后 socket 的结束归 pipe 管：这里只能 emit，再 writeHead/end 会抛错或截断流。
        if (escapeCommitted) {
          escapedEmit?.();
          return;
        }
        const buffered =
```

- [ ] **Step 5: 跑测试确认两条红灯转绿**

Run: 同 Task 1 Step 4。

Expected: 两条红灯转绿（收满 3MB、`truncated:true`、`responseBodySize === 3MB`、红灯 B 的 `responseBody.length === 1MB`）。**若红灯 A 绿了但红灯 B 还红**，说明叛逃没生效 —— 回查 Step 2 的 `onBodyData` 改动是否落在 buffer 分支内。

- [ ] **Step 6: 补叛逃一致性用例（守 spec §2.2 B2）**

> 这条钉死「叛逃时 `afterResponse` 照跑」—— 没有它，后续重构可能改回「不跑 afterResponse」，导致 chunked 接口的 `modify_header(response)` 静默失效。

在测试文件末尾追加：

```ts
it(
  '叛逃后 modify_header(response) 仍生效（与 live-pipe 语义一致）',
  {timeout: 10000},
  async () => {
    const BIG = 3 * 1024 * 1024;
    const origin = await startChunkedBigOriginServer(BIG);
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const rules = new MitmRuleEngine();
    rules.addRule({
      id: 'hdr-escape',
      action: {
        type: 'modify_header',
        phase: 'response',
        set: {'x-escaped': '1'},
      },
      enabled: true,
    });
    const proxy = new MitmProxyServer(ca, () => {}, rules);
    await proxy.start(0);

    try {
      const headers = await new Promise<http.IncomingHttpHeaders>(
        (resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: proxy.getPort()!,
              path: `http://127.0.0.1:${origin.port}/big`,
              method: 'GET',
            },
            res => resolve(res.headers),
          );
          req.on('error', reject);
          req.end();
        },
      );
      assert.strictEqual(
        headers['x-escaped'],
        '1',
        '叛逃时 header 改写必须生效',
      );
    } finally {
      await proxy.stop();
      await origin.close();
    }
  },
);
```

> 现有 `requestViaProxy` 只回 `{status, body}`，不回头；这条用例需要一个能拿 headers 的变体，故内联一个 `http.request`（与 `requestViaProxy` 同形）。

- [ ] **Step 7: 跑测试并收尾门禁**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmProxyServer.test.js
npm run typecheck
npx prettier --check src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
npx eslint src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
```

Expected: 全 PASS；typecheck 零 error；prettier/eslint 零 error。

- [ ] **Step 8: 提交**

```bash
git add src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
git commit -m "fix(proxy): escape to live-pipe when response body exceeds 1MB"
```

---

## Task 3: SP1-c —— IPv6 CONNECT authority

**Files:**

- Modify: `src/modules/proxy/MitmProxyServer.ts`
- Test: `tests/unit/modules/proxy/MitmProxyServer.test.ts`

**Interfaces:**

- Produces: `parseConnectAuthority(url: string): {hostname: string; port: number} | null`（模块级私有纯函数，**剥掉方括号**）。

> 语义抄 ProxyPin `test/temp_ipv6_test.dart`；返回「剥括号」形式是为了让 §3.4 的子串匹配能命中（spec §2.3 M1）。

- [ ] **Step 1: 写失败测试**

在测试文件末尾追加：

```ts
it('parseConnectAuthority 处理 IPv6 / IPv4 / 裸域名 / 畸形', () => {
  assert.deepStrictEqual(parseConnectAuthority('[240c::1]:8080'), {
    hostname: '240c::1',
    port: 8080,
  });
  assert.deepStrictEqual(parseConnectAuthority('240c::1'), {
    hostname: '240c::1',
    port: 443,
  });
  assert.deepStrictEqual(parseConnectAuthority('[240c'), {
    hostname: '[240c',
    port: 443,
  });
  assert.deepStrictEqual(parseConnectAuthority('192.168.1.1:8080'), {
    hostname: '192.168.1.1',
    port: 8080,
  });
  assert.deepStrictEqual(parseConnectAuthority('example.com'), {
    hostname: 'example.com',
    port: 443,
  });
  assert.strictEqual(parseConnectAuthority(''), null);
});
```

> 需要把 `parseConnectAuthority` 从模块导出才能单测 —— 见 Step 3 的 `export`。若不导出，只能在类上加一个 public 包装方法（不推荐，污染 API 面）。

- [ ] **Step 2: 跑测试确认失败**

Run: 同 Task 2 Step 5。

Expected: 失败（函数不存在，swc 编译期放过、运行期 ReferenceError）。

- [ ] **Step 3: 实现 `parseConnectAuthority`**

在 `src/modules/proxy/MitmProxyServer.ts` 的 `parseRawHeaders`（`:37`）之后追加：

```ts
/**
 * 解析 CONNECT 的 authority（RFC 7231 §4.3.6）。
 * IPv6 必须带方括号且用 lastIndexOf(':') 分端口 —— 直接 split(':') 会把
 * `[240c::1]:8080` 切成 hostname=`[240c`（ProxyPin temp_ipv6_test.dart 守护此坑）。
 * hostname 一律剥掉方括号：签证书不需要，且 shouldBypass 的子串匹配需要。
 */
export function parseConnectAuthority(
  url: string,
): {hostname: string; port: number} | null {
  const authority = url.trim();
  if (!authority) return null;

  const DEFAULT_PORT = 443;
  let hostname = authority;
  let port = DEFAULT_PORT;

  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close !== -1) {
      hostname = authority.slice(1, close);
      if (authority[close + 1] === ':') {
        const parsed = parseInt(authority.slice(close + 2), 10);
        if (Number.isFinite(parsed)) port = parsed;
      }
    }
    // 找不到 ']'（畸形如 "[240c"）：整个 authority 当 host，端口取默认。
  } else {
    const lastColon = authority.lastIndexOf(':');
    if (lastColon !== -1) {
      const parsed = parseInt(authority.slice(lastColon + 1), 10);
      if (Number.isFinite(parsed)) {
        hostname = authority.slice(0, lastColon);
        port = parsed;
      }
    }
  }

  if (!hostname) return null;
  return {hostname, port};
}
```

- [ ] **Step 4: `handleConnect` 改用它**

`handleConnect`（`:306-313`）：

```ts
const [hostname, portStr] = (req.url || '').split(':');
const port = parseInt(portStr, 10) || 443;

if (!hostname) {
  clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  return;
}
```

改成：

```ts
const authority = parseConnectAuthority(req.url || '');
if (!authority) {
  clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  return;
}
const {hostname, port} = authority;
```

> 后续 `getSecureContextForHost(hostname)` 等引用 `hostname`/`port` 的代码**一行都不用改** —— 变量名保持同名。

- [ ] **Step 5: 补 import + 跑测试**

测试文件顶部加 import（按 ESLint 字母序，`MitmProxyServer` 之后）：

```ts
import {
  MitmProxyServer,
  parseConnectAuthority,
} from '../../../../src/modules/proxy/MitmProxyServer.js';
```

> 把既有的 `import {MitmProxyServer} from '.../MitmProxyServer.js';` 改写成上面的形式。

Run: 同 Task 2 Step 5。

Expected: 全 PASS（含既有用例 —— `handleConnect` 的 plaintext/IPv4 路径行为不变）。

- [ ] **Step 6: 收尾门禁 + 提交**

```bash
npm run typecheck
npx prettier --check src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
npx eslint src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
git add src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
git commit -m "fix(proxy): parse IPv6 CONNECT authority without splitting on colons"
```

---

## Task 4: SP2-a —— `normalizeHost` 纯函数 + `MitmModule` 过滤态

**Files:**

- Create: `src/modules/proxy/hostFilter.ts`
- Create: `tests/unit/modules/proxy/hostFilter.test.ts`
- Modify: `src/modules/proxy/types.ts`
- Modify: `src/modules/proxy/index.ts`
- Modify: `src/modules/proxy/MitmModule.ts`
- Test: `tests/unit/modules/proxy/MitmModule.test.ts`

**Interfaces:**

- Produces:
  - `normalizeHost(hostname: string): string` —— 小写、去尾点、去 `:port`、剥 IPv6 方括号。
  - `MitmModule.addHostFilter/removeHostFilter/listHostFilters/clearHostFilters`。
  - `MitmModule.shouldBypass(host: string): boolean`。

> ⚠️ **不要复用 `rewrite.ts::extractHost`** —— 它入参是完整 URL（内部 `new URL(url).hostname`），这里三个调用点拿到的都是裸 host（spec §3.4 M4）。两者并存：`extractHost` 用于规则匹配（URL → host），`normalizeHost` 用于过滤（host → host）。

- [ ] **Step 1: 写 `normalizeHost` 失败测试**

创建 `tests/unit/modules/proxy/hostFilter.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {normalizeHost} from '../../../../src/modules/proxy/hostFilter.js';

describe('normalizeHost', () => {
  it('小写化并去尾点', () => {
    assert.strictEqual(normalizeHost('Example.COM.'), 'example.com');
  });

  it('剥掉 IPv6 方括号', () => {
    assert.strictEqual(normalizeHost('[240c::1]'), '240c::1');
  });

  it('去掉端口后缀（不影响 IPv6 冒号）', () => {
    assert.strictEqual(normalizeHost('a.dev:8080'), 'a.dev');
    assert.strictEqual(normalizeHost('240c::1'), '240c::1');
  });

  it('空串保持空串', () => {
    assert.strictEqual(normalizeHost(''), '');
  });
});
```

- [ ] **Step 2: 实现 `normalizeHost`**

创建 `src/modules/proxy/hostFilter.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 归一化 hostname 用于域名过滤的存表与匹配（两侧都过一遍）。
 *
 * 与 `rewrite.ts::extractHost` 的区别：那个入参是完整 URL（URL → host），
 * 这个入参已经是裸 host（host → host）。调用点（handleConnect /
 * handleHttpRequest / handleWsUpgrade）拿到的都是裸 host，不要传 URL 进来。
 */
export function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (!host) return '';

  // 剥 IPv6 方括号：[240c::1] → 240c::1
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
    return host.replace(/\.$/, '');
  }
  // 去端口：仅当冒号后是纯数字（避免砍掉 IPv6 的冒号段）
  const lastColon = host.lastIndexOf(':');
  if (lastColon !== -1) {
    const suffix = host.slice(lastColon + 1);
    if (suffix.length > 0 && /^\d+$/.test(suffix)) {
      host = host.slice(0, lastColon);
    }
  }
  return host.replace(/\.$/, '');
}
```

- [ ] **Step 3: `types.ts` 增 4 组类型**

在 `src/modules/proxy/types.ts` 的 `ClearMitmRulesData`（`:296`）之后追加：

```ts
export type HostFilterAction = 'allow' | 'block';

export interface AddHostFilterParams {
  action: HostFilterAction;
  host: string;
}

export interface AddHostFilterData {
  action: HostFilterAction;
  host: string;
}

export interface RemoveHostFilterParams {
  action: HostFilterAction;
  host: string;
}

export interface RemoveHostFilterData {
  removed: boolean;
}

export interface ListHostFiltersData {
  allow: string[];
  block: string[];
}

export interface ClearHostFiltersData {
  clearedCount: number;
}
```

- [ ] **Step 4: 写 `MitmModule` 失败测试**

在 `tests/unit/modules/proxy/MitmModule.test.ts` 的 `describe('MitmModule', ...)` 末尾追加：

```ts
it('host filter 增删查清 + shouldBypass 白/黑名单语义', () => {
  const mod = new MitmModule();

  // 两表皆空 → 不过滤
  assert.strictEqual(mod.shouldBypass('a.dev'), false);

  mod.addHostFilter({action: 'block', host: 'ads.dev'});
  assert.strictEqual(mod.shouldBypass('ads.dev'), true);
  assert.strictEqual(mod.shouldBypass('ADS.DEV'), true, '大小写不敏感');
  assert.strictEqual(mod.shouldBypass('sub.ads.dev'), true, '子串匹配');
  assert.strictEqual(mod.shouldBypass('other.dev'), false);

  // 白名单一旦非空 → 黑名单失效，不在白名单即旁路
  mod.addHostFilter({action: 'allow', host: 'api.dev'});
  assert.strictEqual(mod.shouldBypass('api.dev'), false);
  assert.strictEqual(
    mod.shouldBypass('ads.dev'),
    true,
    '白名单优先，黑名单失效',
  );
  assert.strictEqual(mod.shouldBypass('other.dev'), true);

  assert.deepStrictEqual(mod.listHostFilters().data, {
    allow: ['api.dev'],
    block: ['ads.dev'],
  });

  assert.strictEqual(
    mod.removeHostFilter({action: 'allow', host: 'api.dev'}).data.removed,
    true,
  );
  assert.strictEqual(
    mod.removeHostFilter({action: 'allow', host: 'nope.dev'}).data.removed,
    false,
  );

  assert.strictEqual(mod.clearHostFilters().data.clearedCount, 1);
  assert.strictEqual(mod.shouldBypass('ads.dev'), false, '清空后不过滤');
});

it('addHostFilter 拒绝空 host', () => {
  const mod = new MitmModule();
  const result = mod.addHostFilter({action: 'block', host: '  '});
  assert.strictEqual(result.success, false);
  assert.strictEqual(mod.shouldBypass('a.dev'), false, '不落 state');
});
```

> `new MitmModule()` 无参构造已在 `MitmModule.test.ts` 中用过（走 `resolveMitmCertsDir()` 缺省），**不会真建目录**（`CaManager.init()` 是惰性）。若实测有副作用，改用 `new MitmModule(mkdtempSync(...))`。

- [ ] **Step 5: 跑测试确认失败**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/hostFilter.test.js build/tests/unit/modules/proxy/MitmModule.test.js
```

Expected: 新用例失败（`shouldBypass`/4 个方法不存在，运行期 TypeError）。既有用例 PASS。

- [ ] **Step 6: 实现 `MitmModule` 过滤态**

`src/modules/proxy/MitmModule.ts`：

**a) 顶部 import 区追加（按字母序）：**

```ts
import {normalizeHost} from './hostFilter.js';
```

以及 types 的类型导入（该文件已有 `import type {...} from './types.js';`，把新 6 个类型名加进既有列表，**不要新起一行 import**）：

```ts
  AddHostFilterData,
  AddHostFilterParams,
  ClearHostFiltersData,
  HostFilterAction,
  ListHostFiltersData,
  RemoveHostFilterData,
  RemoveHostFilterParams,
```

**b) 构造函数（`constructor`，`:60-68`）里加两个字段：**

```ts
  private readonly allowHosts = new Set<string>();
  private readonly blockHosts = new Set<string>();
```

并在紧随其后加方法（放在 `getRuleEngine()` 之后、`recordExchange` 之前）：

```ts
  // ─── 域名过滤 ──────────────────────────────

  /**
   * 是否旁路该 host（白名单优先，黑名单次之，两空不过滤）。
   * 语义对齐 ProxyPin host_filter.dart:23-46。
   */
  shouldBypass(host: string): boolean {
    const normalized = normalizeHost(host);
    if (!normalized) return false;

    if (this.allowHosts.size > 0) {
      for (const entry of this.allowHosts) {
        if (normalized.includes(entry)) return false;
      }
      return true;
    }
    if (this.blockHosts.size > 0) {
      for (const entry of this.blockHosts) {
        if (normalized.includes(entry)) return true;
      }
    }
    return false;
  }

  addHostFilter(
    params: AddHostFilterParams,
  ): MitmMethodResult<AddHostFilterData> {
    const host = normalizeHost(params.host);
    if (!host) {
      return {
        success: false,
        message: 'host 不能为空',
        data: {action: params.action, host: ''},
      };
    }
    (params.action === 'allow' ? this.allowHosts : this.blockHosts).add(host);
    return {
      success: true,
      message: `已${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`,
      data: {action: params.action, host},
    };
  }

  removeHostFilter(
    params: RemoveHostFilterParams,
  ): MitmMethodResult<RemoveHostFilterData> {
    const host = normalizeHost(params.host);
    const removed = (
      params.action === 'allow' ? this.allowHosts : this.blockHosts
    ).delete(host);
    return {
      success: removed,
      message: removed
        ? `已移除${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`
        : `未找到${params.action === 'allow' ? '允许' : '屏蔽'}域名 ${host}`,
      data: {removed},
    };
  }

  listHostFilters(): MitmMethodResult<ListHostFiltersData> {
    return {
      success: true,
      message: `白名单 ${this.allowHosts.size} 条，黑名单 ${this.blockHosts.size} 条`,
      data: {
        allow: [...this.allowHosts],
        block: [...this.blockHosts],
      },
    };
  }

  clearHostFilters(): MitmMethodResult<ClearHostFiltersData> {
    const clearedCount = this.allowHosts.size + this.blockHosts.size;
    this.allowHosts.clear();
    this.blockHosts.clear();
    return {
      success: true,
      message: `已清空 ${clearedCount} 条域名过滤`,
      data: {clearedCount},
    };
  }
```

**c) `start()`（`:100-114`）构造 `MitmProxyServer` 时把 `shouldBypass` 传进去：**

```ts
          this.rules,
          host => this.shouldBypass(host),
```

- [ ] **Step 7: `index.ts` re-export**

`src/modules/proxy/index.ts` 的 `export {` 区追加 `normalizeHost`（与 `MAX_BODY_SIZE` 等并列的 `{...} from './hostFilter.js'`），并把 6 个新类型加进底部 `export type {` 列表：

```ts
export {normalizeHost} from './hostFilter.js';
```

- [ ] **Step 8: 跑测试确认通过 + 收尾门禁**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/hostFilter.test.js build/tests/unit/modules/proxy/MitmModule.test.js build/tests/unit/modules/proxy/MitmProxyServer.test.js
npm run typecheck
npx prettier --check src/modules/proxy/hostFilter.ts src/modules/proxy/types.ts src/modules/proxy/index.ts src/modules/proxy/MitmModule.ts tests/unit/modules/proxy/hostFilter.test.ts tests/unit/modules/proxy/MitmModule.test.ts
npx eslint src/modules/proxy/hostFilter.ts src/modules/proxy/types.ts src/modules/proxy/index.ts src/modules/proxy/MitmModule.ts tests/unit/modules/proxy/hostFilter.test.ts tests/unit/modules/proxy/MitmModule.test.ts
```

Expected: 全 PASS（`MitmProxyServer.test.js` 是关键回归 —— 新增的第四构造参数对既有调用点必须可选且无行为变化）。

- [ ] **Step 9: 提交**

```bash
git add src/modules/proxy/hostFilter.ts src/modules/proxy/types.ts src/modules/proxy/index.ts src/modules/proxy/MitmModule.ts tests/unit/modules/proxy/hostFilter.test.ts tests/unit/modules/proxy/MitmModule.test.ts
git commit -m "feat(proxy): add in-process host allow/block filter state to MitmModule"
```

---

## Task 5: SP2-b —— `MitmProxyServer` 三处旁路 / 过滤

**Files:**

- Modify: `src/modules/proxy/MitmProxyServer.ts`
- Test: `tests/unit/modules/proxy/MitmProxyServer.test.ts`

**Interfaces:**

- Consumes: 新增可选构造参数 `shouldBypass?: (host: string) => boolean`。
- Produces: `handleConnect` 旁路、`handleHttpRequest` + `handleWsUpgrade` 记录过滤。

> **三个层次缺一即漏**（spec §3.1 M2）：明文 `ws://` 走 `server.on('upgrade')`，**完全不经过** `handleConnect`/`handleHttpRequest`。不补它，`mitm_add_host_filter block example.com` 之后 `ws://example.com/...` 照样被抓。

- [ ] **Step 1: 构造函数加可选参数**

```ts
  constructor(
    private readonly caManager: CaManager,
    private readonly onCaptured: (exchange: CapturedExchange) => void,
    private readonly interceptor?: MitmInterceptor,
    private readonly shouldBypass?: (hostname: string) => boolean,
  ) {}
```

- [ ] **Step 2: 写三条失败测试**

在 `tests/unit/modules/proxy/MitmProxyServer.test.ts` 末尾追加。先加一个 bypass 判定器：

```ts
/** 只旁路 blocked.dev 的判定器（模拟 MitmModule.shouldBypass）。 */
const bypassBlockedDev = (host: string): boolean =>
  normalizeHost(host).includes('blocked.dev');
```

测试文件顶部 import 加 `normalizeHost`：

```ts
import {normalizeHost} from '../../../../src/modules/proxy/hostFilter.js';
```

用例 1（HTTP 明文记录过滤）：

```ts
it('命中的 HTTP 明文请求转发成功但不产生 capture', async () => {
  const origin = await startOriginServer();
  let captured: CapturedExchange | undefined;
  const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
  await ca.init();
  const proxy = new MitmProxyServer(
    ca,
    exchange => {
      captured = exchange;
    },
    undefined,
    bypassBlockedDev,
  );
  await proxy.start(0);

  try {
    // 源站 host 是 127.0.0.1，靠 Host 头命中过滤判定
    const target = `http://blocked.dev/anything`;
    const res = await new Promise<{status: number; body: string}>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.getPort()!,
            path: target,
            method: 'GET',
            headers: {host: `127.0.0.1:${origin.port}`},
          },
          r => {
            let body = '';
            r.on('data', c => (body += c.toString('utf-8')));
            r.on('end', () => resolve({status: r.statusCode ?? 0, body}));
          },
        );
        req.on('error', reject);
        req.end();
      },
    );
    assert.strictEqual(res.status, 200, '连通性必须保留');
    assert.strictEqual(res.body, 'hello-from-origin');
    assert.strictEqual(captured, undefined, '命中过滤的域名不产生 capture');
  } finally {
    await proxy.stop();
    await origin.close();
  }
});
```

> ⚠️ 明文的 `parsed.hostname` 来自 **请求行里的绝对 URL**（不是 Host 头）。故 `path` 传 `http://blocked.dev/anything` 让 `parsed.hostname === 'blocked.dev'`，而 `headers.host` 指向真实源站保证连通。这与 `requestViaProxy` 的既有用法一致（它也是 `path: targetUrl` + `headers.host = new URL(targetUrl).host`）。

用例 2（CONNECT 旁路）：

```ts
it('命中的 HTTPS CONNECT 走旁路且不产生 capture', async () => {
  const origin = await startOriginServer();
  let captured: CapturedExchange | undefined;
  const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
  await ca.init();
  const proxy = new MitmProxyServer(
    ca,
    exchange => {
      captured = exchange;
    },
    undefined,
    bypassBlockedDev,
  );
  await proxy.start(0);

  try {
    const established = await new Promise<boolean>((resolve, reject) => {
      const socket = net.connect(proxy.getPort()!, '127.0.0.1', () => {
        socket.write(
          `CONNECT blocked.dev:443 HTTP/1.1\r\nHost: blocked.dev:443\r\n\r\n`,
        );
      });
      let buf = '';
      socket.on('data', d => {
        buf += d.toString('utf-8');
        if (buf.includes('200 Connection Established')) {
          socket.destroy();
          resolve(true);
        }
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    assert.strictEqual(established, true, '旁路隧道也要回 200');
    assert.strictEqual(captured, undefined);
  } finally {
    await proxy.stop();
    await origin.close();
  }
});
```

测试文件顶部加 `import net from 'node:net';`（`node:` 组，按字母序在 `http` 之后）。

用例 3（明文 `ws://` 记录过滤 —— 最容易漏的一条）：

```ts
it('命中的明文 ws:// 建隧道但不产生 capture', async () => {
  let captured: CapturedExchange | undefined;
  const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
  await ca.init();
  const proxy = new MitmProxyServer(
    ca,
    exchange => {
      captured = exchange;
    },
    undefined,
    bypassBlockedDev,
  );
  await proxy.start(0);

  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: proxy.getPort()!,
        path: '/socket',
        method: 'GET',
        headers: {
          host: 'blocked.dev',
          connection: 'Upgrade',
          upgrade: 'websocket',
        },
      });
      req.on('upgrade', (_res, socket) => {
        socket.destroy();
        resolve();
      });
      req.on('error', () => resolve());
      req.end();
    });
    assert.strictEqual(
      captured,
      undefined,
      '明文 ws:// 命中过滤不产生 capture',
    );
  } finally {
    await proxy.stop();
  }
});
```

> 上游 `blocked.dev` 不存在 → 隧道建不起来，但 `handleWsUpgrade` 的 `onCaptured` 在 `connectAndTunnel` 里、拿到响应头之后才调；这里断言的是**不产生 capture**，隧道是否建成不影响该断言。若 `req.on('error')` 先于 `upgrade` 触发，用例仍通过（captured 保持 undefined）—— 这条用例的守卫点是「`onCaptured` 不被调用」。

- [ ] **Step 3: 跑测试确认失败**

Run: 同 Task 2 Step 5。

Expected: 3 条新用例中「HTTP 明文」与「ws://」失败（capture 仍产生）；CONNECT 那条可能意外通过（现状也回 200、也不产生 capture）—— 它守的是**重构不回归**，可接受。

- [ ] **Step 4: `handleConnect` 旁路**

`handleConnect` 在 `const {hostname, port} = authority;` 之后、`clientSocket.write('HTTP/1.1 200 ...')` 之前插入：

```ts
// 旁路（spec §3.1）：不解密不签证书，纯传输层双向 pipe。
if (this.shouldBypass?.(hostname) === true) {
  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  const tunnel = net.connect(port, hostname, () => {
    if (head.length > 0) tunnel.write(head);
    tunnel.pipe(clientSocket);
    clientSocket.pipe(tunnel);
  });
  // 上游失败仅毁 socket，不写 capture、不打日志刷屏（spec §4）。
  tunnel.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => tunnel.destroy());
  tunnel.on('close', () => clientSocket.destroy());
  clientSocket.on('close', () => tunnel.destroy());
  return;
}
```

- [ ] **Step 5: `handleHttpRequest` 记录过滤**

`handleHttpRequest` 里 `relayResponse` 的调用（`:190-201`）无法直接跳过（relayResponse 内部会 emit）。改为在**方法开头**算 `shouldRecord`，并把它传进 `relayResponse`。

在 `const parsed = url.parse(targetUrl);`（`:149`）之后追加：

```ts
const shouldRecord = this.shouldBypass?.(parsed.hostname ?? '') !== true;
```

然后给 `relayResponse` 新增一个参数 `shouldRecord: boolean`，在 `emit` / `onCaptured` 调用点用 `shouldRecord &&` 守卫。

**最省改动的实现**：`relayResponse` 签名加 `shouldRecord: boolean = true`，并在函数体开头包一层：

```ts
const emitAll = emit;
if (!shouldRecord) emit = () => {};
```

⚠️ **不要这么做** —— `emit` 是 `const`，且静默空转会让 `end` handler 里的其他逻辑照跑。改用**显式守卫**：在 `relayResponse` 里把 `this.onCaptured({...})` 调用改为条件调用：

```ts
    const emit = (...): void => {
      if (!shouldRecord) return;
      ...
    };
```

即在 `emit` 函数体第一行加 `if (!shouldRecord) return;`。这样 capture 相关计算（`bodyToUtf8`、`Buffer.concat`）也一并跳过，省 CPU。

调用点（`handleHttpRequest` 与 `handleDecryptedRequest`）传参：

```ts
this.relayResponse(
  requestId,
  startTime,
  flow,
  before && before.action === 'forward' ? before.appliedRuleIds : undefined,
  proxyRes,
  clientRes,
  shouldRecord,
);
```

`handleHttpRequest` 里 `shouldRecord` 如 Step 5 开头算；`handleDecryptedRequest` **恒传 `true`**（spec §3.1：能进入说明已签了证书，旁路决策发生在更早的 `handleConnect`）。

- [ ] **Step 6: `handleWsUpgrade` 记录过滤**

`handleWsUpgrade` 的 `this.onCaptured({...})`（`:268`）整块包一层：

```ts
        if (this.shouldBypass?.(hostname) !== true) {
          this.onCaptured({
            ...
          });
        }
```

> 只跳过 `onCaptured`，**隧道照建**（保证连通，spec §3.1）。

- [ ] **Step 7: 跑测试确认通过 + 收尾门禁**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/MitmProxyServer.test.js build/tests/unit/modules/proxy/MitmModule.test.js build/tests/unit/modules/proxy/hostFilter.test.js
npm run typecheck
npx prettier --check src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
npx eslint src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
```

Expected: 全 PASS。既有用例必须全绿 —— 它们不传第四参，`shouldBypass` 为 `undefined`，`?.()` 短路返回 `undefined !== true` → 不过滤。

- [ ] **Step 8: 提交**

```bash
git add src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
git commit -m "feat(proxy): bypass and filter CONNECT, plain HTTP and ws:// by host"
```

---

## Task 6: SP2-c —— 4 个 MCP 工具 + manifest 注册

**Files:**

- Create: `src/tools/proxy/addHostFilter.ts`
- Create: `src/tools/proxy/listHostFilters.ts`
- Create: `src/tools/proxy/removeHostFilter.ts`
- Create: `src/tools/proxy/clearHostFilters.ts`
- Modify: `src/tools/proxy/index.ts`
- Modify: `src/tools/proxy/manifest.ts`
- Test: `tests/unit/tools/proxy/tools.test.ts`

**Interfaces:**

- Consumes: `getRuntime().mitmModule.*`（模式见 `addRewriteRule.ts`）、`defineTool`、`ToolCategory.NETWORK`、`zod`。
- Produces: 4 个工具，名字见 spec §3.3 表。

- [ ] **Step 1: 更新 `EXPECTED_TOOLS`**

`tests/unit/tools/proxy/tools.test.ts` 的 `EXPECTED_TOOLS`（`:11-23`）在 `mitm_export_har` 之后追加：

```ts
  'mitm_add_host_filter',
  'mitm_list_host_filters',
  'mitm_remove_host_filter',
  'mitm_clear_host_filters',
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/tools/proxy/tools.test.js
```

Expected: 新增 4 条失败（`toolsByName.get(name)` 为 undefined）。

- [ ] **Step 3: 创建 `addHostFilter.ts`**

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {AddHostFilterParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const addHostFilter = defineTool({
  name: 'mitm_add_host_filter',
  description:
    '新增一条 MITM 域名过滤（allow 白名单 / block 黑名单），进程内生效直到 stop 或 clear。白名单非空时黑名单失效：不在白名单里的域名全部旁路（不解密不抓包）。host 为子串匹配，大小写不敏感。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod
      .enum(['allow', 'block'])
      .describe('allow=白名单（仅抓这些域名）；block=黑名单（跳过这些域名）。'),
    host: zod
      .string()
      .describe('hostname 子串，大小写不敏感（如 `ads.example.com`）。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.addHostFilter(
      request.params as AddHostFilterParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_add_host_filter',
    });
  },
});
```

- [ ] **Step 4: 创建 `listHostFilters.ts`**

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listHostFilters = defineTool({
  name: 'mitm_list_host_filters',
  description: '列出当前生效的 MITM 域名过滤（白名单 allow 与黑名单 block）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.listHostFilters();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_list_host_filters',
    });
  },
});
```

- [ ] **Step 5: 创建 `removeHostFilter.ts`**

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {RemoveHostFilterParams} from '../../modules/proxy/index.js';
import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const removeHostFilter = defineTool({
  name: 'mitm_remove_host_filter',
  description: '移除一条 MITM 域名过滤（需与添加时相同的 action 与 host）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    action: zod.enum(['allow', 'block']).describe('要移除哪张表里的条目。'),
    host: zod.string().describe('添加时用的 hostname 子串。'),
  },
  handler: async (request, response) => {
    const result = getRuntime().mitmModule.removeHostFilter(
      request.params as RemoveHostFilterParams,
    );
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_remove_host_filter',
    });
  },
});
```

- [ ] **Step 6: 创建 `clearHostFilters.ts`**

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearHostFilters = defineTool({
  name: 'mitm_clear_host_filters',
  description: '清空全部 MITM 域名过滤（白名单与黑名单一起清）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = getRuntime().mitmModule.clearHostFilters();
    response.setStructuredContent({
      ...result,
      tooltype: 'mitm_clear_host_filters',
    });
  },
});
```

- [ ] **Step 7: `index.ts` + `manifest.ts` 注册**

`src/tools/proxy/index.ts` 在 `export {exportMitmHar} from './exportMitmHar.js';` 之后追加：

```ts
export {addHostFilter} from './addHostFilter.js';
export {listHostFilters} from './listHostFilters.js';
export {removeHostFilter} from './removeHostFilter.js';
export {clearHostFilters} from './clearHostFilters.js';
```

`src/tools/proxy/manifest.ts` 的 `tools` 数组末尾（`exportMitmHar` 之后）追加：

```ts
    {
      modulePath: './proxy/addHostFilter.js',
      handlerName: 'addHostFilter',
    },
    {
      modulePath: './proxy/listHostFilters.js',
      handlerName: 'listHostFilters',
    },
    {
      modulePath: './proxy/removeHostFilter.js',
      handlerName: 'removeHostFilter',
    },
    {
      modulePath: './proxy/clearHostFilters.js',
      handlerName: 'clearHostFilters',
    },
```

> `manifest.ts` 的 license 头是 `Copyright 2026 Browser-CLI` —— **保持原样，不要改成 Google LLC**。

- [ ] **Step 8: 跑测试确认通过 + 收尾门禁**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/tools/proxy/tools.test.js
npm run typecheck
npx prettier --check src/tools/proxy/addHostFilter.ts src/tools/proxy/listHostFilters.ts src/tools/proxy/removeHostFilter.ts src/tools/proxy/clearHostFilters.ts src/tools/proxy/index.ts src/tools/proxy/manifest.ts tests/unit/tools/proxy/tools.test.ts
npx eslint src/tools/proxy/addHostFilter.ts src/tools/proxy/listHostFilters.ts src/tools/proxy/removeHostFilter.ts src/tools/proxy/clearHostFilters.ts src/tools/proxy/index.ts src/tools/proxy/manifest.ts tests/unit/tools/proxy/tools.test.ts
```

Expected: 全 PASS。`npm run build` 会跑 `build:index`，自动刷新 `src/tools/generated-tools-index.ts` 的 `GENERATED_TOOL_REGISTRY`。

> ⚠️ `generated-tools-index.ts` 是生成物，若它进了 git 应一并提交；若被 `.gitignore` 忽略则不要 `git add`。用 `git status --porcelain` 确认。

- [ ] **Step 9: 提交**

```bash
git add src/tools/proxy/addHostFilter.ts src/tools/proxy/listHostFilters.ts src/tools/proxy/removeHostFilter.ts src/tools/proxy/clearHostFilters.ts src/tools/proxy/index.ts src/tools/proxy/manifest.ts tests/unit/tools/proxy/tools.test.ts
git commit -m "feat(proxy): add mitm host filter tools (add/list/remove/clear)"
```

---

## Task 7: 收尾验证

**Files:** 只读

- [ ] **Step 1: 全量相关单测**

Run:

```bash
npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/modules/proxy/*.test.js build/tests/unit/tools/proxy/*.test.js
```

Expected: 全 PASS（含 `CaManager.test.js`、`ProxyStore.test.js`、`rewrite.test.js` 三个既有回归）。

- [ ] **Step 2: 类型门禁**

Run: `npm run typecheck`

Expected: 零 error。本轮不动 `src/web-ui/**`，**不需要** `npm run web:typecheck`。

- [ ] **Step 3: 范围核对**

Run: `git diff --name-only HEAD~6..HEAD`

Expected: 恰好下列文件（6 个 commit 合计）：

```
src/modules/proxy/MitmProxyServer.ts
src/modules/proxy/hostFilter.ts
src/modules/proxy/MitmModule.ts
src/modules/proxy/types.ts
src/modules/proxy/index.ts
src/tools/proxy/addHostFilter.ts
src/tools/proxy/listHostFilters.ts
src/tools/proxy/removeHostFilter.ts
src/tools/proxy/clearHostFilters.ts
src/tools/proxy/index.ts
src/tools/proxy/manifest.ts
tests/unit/modules/proxy/MitmProxyServer.test.ts
tests/unit/modules/proxy/MitmModule.test.ts
tests/unit/modules/proxy/hostFilter.test.ts
tests/unit/tools/proxy/tools.test.ts
```

（`src/tools/generated-tools-index.ts` 若未被 gitignore 则附加一行。）

若出现越界文件，`git diff HEAD~6..HEAD -- <越界文件>` 看清楚回退，不顺手修无关文件。**特别确认没有** `src/web/`、`src/web-ui/`、`worker/`、`src/modules/session/**`、`src/modules/network/**` 的文件。

- [ ] **Step 4: 手工验证（不可跳过，对齐 spec §5）**

1. `npm run build && npm run start` 起服务。
2. 起一个 >1MB 的本地源站（**两个变体各验一次**）：
   - 带 `content-length`：

     ```powershell
     node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'text/plain','content-length':String(3*1024*1024)});s.end(Buffer.alloc(3*1024*1024,'a'))}).listen(9911)"
     ```

   - chunked（不设 content-length）：

     ```powershell
     node -e "require('http').createServer((q,s)=>{s.writeHead(200,{'content-type':'text/plain'});for(let i=0;i<48;i++)s.write(Buffer.alloc(65536,'b'));s.end()}).listen(9912)"
     ```

3. 调 `mitm_add_rule` 加一条 `modify_body` / `phase:'response'` 规则，再 `start_mitm_proxy`。
4. `curl -x http://127.0.0.1:<port> http://127.0.0.1:9911/` 与 `:9912/`。
   Expected: **curl 收满 3145728 字节且不挂**（修复前挂死）；响应头 `content-length` 与实收字节数一致。
5. `list_mitm_requests` → 该记录 `truncated: true`。
6. `get_mitm_request({id})` → `responseBody` 有前 1MB 文本（`MitmRequestSummary` 不含 `responseBody`，必须走 `get_mitm_request`，spec §5）。
7. 加一条 `modify_header` / `phase:'response'` 规则，重跑 chunked 那条。
   Expected: curl 响应头里能看到该 header（叛逃时 `afterResponse` 照跑）。
8. `mitm_add_host_filter({action:'block', host:'<某域名>'})` → 用 `curl -x` 访问该域名。
   Expected: 连通正常，但 `list_mitm_requests` 里**不出现**该域流量。
9. `mitm_list_host_filters` → 看到刚加的条目；`mitm_clear_host_filters` → 流量重新出现。

Expected: 4/5/6/7/8/9 全成立。

- [ ] **Step 5: 收尾**

Run: `git status --porcelain`

Expected: 干净。若有输出，按 Task 归属补提交（只列对应文件，不要 `git add -A`）。
