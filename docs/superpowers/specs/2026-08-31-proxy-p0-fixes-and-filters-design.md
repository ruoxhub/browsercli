# Proxy 域 P0 修复与过滤能力设计 Spec

- **日期**：2026-08-31
- **状态**：可执行设计（已获批准，2026-08-31 经一轮 spec 审查修订），待 writing-plans 拆解
- **上游参照**：`open-source/proxypin`（Apache-2.0，逐文件核实见附注）
- **目标模块**：`src/modules/proxy/` + `src/tools/proxy/`
- **前序约束**：`2026-08-26-mitm-proxy-module-design.md`（方案 A 纯 Node 引擎）、
  `2026-08-30-mitmproxy-proxy-gap-analysis.md`（改写规则已落地）、
  `2026-08-31` 口头批准的 P0 范围 + 两条 AskUserQuestion 决策（全进程内、工具镜像 rewrite 4 件套）

---

## 1. 背景与结论

`2026-08-26` 交付了「抓」链路，`2026-08-30` 之前的改写规则把「拦 + 改 + 导」补齐到规则
式能力面。但对 ProxyPin 逐文件对照后，暴露**一个实测缺陷**与**三个高性价比缺口**：

1. **（缺陷，实测确认）buffer 分支截断导致客户端挂死** —— 见 §2。
2. **（缺口）域名过滤** —— 抓 App/终端流量时无白/黑名单，系统证书吊销、推送长连接、
   遥测等噪声会把 2000 条环形缓冲冲光，且为不想抓的域名签假证书徒增失败面。
3. **（缺口）大 body 流式阈值** —— 与缺陷同源（见 §2），一并修。
4. **（缺口）结构化过滤未下沉到 REST / Session** —— `matchesPredicate` 已是纯函数但只有
   MCP 工具在用，Web UI 只能按 `urlFilter` 子串做服务端查询。

**本轮范围（SP1 + SP2）**：修缺陷 + 域名过滤 + 流式阈值 + 4 个域名过滤 MCP 工具。
**明确排除（SP3，下一轮另行 brainstorming）**：结构化过滤下沉 Session/REST/web-ui。

**决策（已拍板）**：

- SP1 + SP2 全进程内，不引入任何持久化（遵守 `2026-08-26` 的「不落盘」约束，与现有
  rewrite 规则一致）。
- 域名过滤 MCP 工具镜像 rewrite 的 4 件套（add/list/remove/clear）。

---

## 2. SP1 —— 修复 buffer 分支截断挂死 + IPv6 authority

### 2.1 缺陷根因（已读码 + 探针实测）

`MitmProxyServer.relayResponse`（`src/modules/proxy/MitmProxyServer.ts`）有两条响应路径：

```ts
// :541-542 —— bufferBody 判定：只要有任意一条启用的 modify_body/response 规则就为真，
//            与 URL 无关、不看响应大小（全局生效）
const bufferBody =
  !isBinary && this.interceptor?.hasResponseBodyRules() === true;
```

`hasResponseBodyRules()`（`rewrite.ts:203-211`）只要规则集里存在一条 `enabled &&
modify_body && phase==='response'` 即返回 true。

buffer 分支（`:591-649`）的截断路径问题集合，逐行：

```ts
proxyRes.on('data', onBodyData);          // :592  —— 越限后不再 push，只置 truncated
proxyRes.on('end', () => {
  const buffered = !truncated && resBodyChunks.length > 0
    ? Buffer.concat(resBodyChunks) : null;  // :594 —— 越限即弃已 buffer 的 1MB 前缀
  ...
  clientRes.writeHead(statusCode, outHeaders);  // :633 —— outHeaders 原样带上游 content-length
  if (outBody !== null) clientRes.end(outBody);
  else clientRes.end();                     // :638 —— outBody=null（截断+无改写）→ 零字节 body
});
```

**三重伤害**（探针：真实 3MB 源站 + 真实代理 + 真实 http client）：

| 路径                            | 客户端               | capture                                         |
| ------------------------------- | -------------------- | ----------------------------------------------- |
| live-pipe（无 response 体规则） | 收完整 3MB，正常 end | `truncated:true, size:3145728, bodyLen:1048576` |
| buffer（有 response 体规则）    | **4s 超时挂住**      | `truncated:true, size:3145728, bodyLen:null`    |

1. **客户端挂死**：拿到 `content-length: 3145728` 但零字节 body。触发门槛极低——只要加过
   一条 response 改写规则，任何 >1MB 的非二进制响应（1.5MB JSON 接口足够）都中招。
2. **捕获质量倒退**：已 buffer 的 1MB 前缀被 `:594` 丢弃，反而不如不加规则时的 live-pipe。
3. **改写静默失效**：`body=null` → `afterResponse` 的 modify_body `continue`（`rewrite.ts:356`），
   规则不生效且 `appliedRuleIds` 也不记录，用户无从知晓。

### 2.2 修复方案（根治：越限叛逃到 live-pipe）

设计目标三合一：**客户端收到完整流、capture 保留前 1MB 文本、改写语义与 live-pipe 完全一致**。

核心机制：**buffer 分支在累计响应体越限的那一刻叛逃到 live-pipe**。`onBodyData` 里一旦
`totalResSize` 达到 `MAX_BODY_SIZE`（即 `truncated` 被置位的那一刻），触发 `escapeToPipe()`：

1. **调 `afterResponse`，传 `body: null` + `truncated: true`** —— 与 live-pipe 同构（live-pipe
   传 `body: null` + `truncated: false`；`truncated` 不参与规则匹配，`rewrite.ts` 的
   `afterResponse` 从不读它，故两者规则判定结果一致）。header 改写照常生效；body 改写因
   `rewrite.ts:356` 的 `body === null → continue` 天然跳过，**不需要「不跑 afterResponse」这个特例**。
2. 套用 header 改写得到 `outHeaders`，立即 `clientRes.writeHead(statusCode, outHeaders)`
   （`outHeaders` 仍原样带上游 content-length，因为随后 flush 的是**完整**字节流，长度吻合）；
3. 把当前 `resBodyChunks` 里的**字节**写给 `clientRes`（已 buffer 的原始压缩字节，完整可发）。
   ⚠️ **只写字节，不清空 `resBodyChunks` 数组** —— 它还要留给 capture（见第 5 点）。
4. `proxyRes.pipe(clientRes)` 接管后续字节；
5. 置 `truncated = true` + `escapeCommitted = true` 门闩：此后 chunk 不再进入 `resBodyChunks`
   （capture 缓冲冻结在 1MB），但 `totalResSize` 继续累计（供 `responseBodySize` 用）。
   `emit` 时仍用**同一个 `resBodyChunks`**：`responseBody = bodyToUtf8(concat(resBodyChunks))`、
   `truncated: true` —— 与 live-pipe 的 `bodyLen:1048576` 对齐，不需要第二个缓冲；
6. `logger.warn` `[MitmProxy] response body 超过 1MB，跳过 response body 改写规则`。
   不加新字段，用既有 `truncated` 表达「body 不完整」。

**关键正确性点（写死进实现）**：已 buffer 的是**压缩后原始字节**（gzip/br/deflate 未解），
不能「截断了只发一半」。叛逃 flush 的是**完整**原始流 + 后续 pipe，客户端拿到的是与上游
一模一样的字节，content-length 吻合。`resBodyChunks` 只是这同一批字节的引用 —— 字节写给
客户端后**数组原封不动**，留给 `emit` 解码成文本。

**`end` handler 必须分流**：buffer 分支的 `proxyRes.on('end')` 现在一口气干四件事
（`afterResponse` / `writeHead` / `clientRes.end` / `emit`）。叛逃后这个 handler **仍会触发**，
必须开头判 `escapeCommitted`：为真则**跳过 `writeHead` 与 `clientRes.end`**（socket 的结束
归 `pipe` 管），只 `emit`。否则重复 `writeHead` 抛错、`end()` 把 pipe 的流截掉。

**为何必须统一 `afterResponse` 语义**（不是可选优化）：若叛逃时干脆不跑 `afterResponse`，
同一个逻辑响应只因源站有没有发 content-length 就会有两种结果 —— 带 content-length 走
live-pipe 时 `modify_header(response)` 生效，chunked 走叛逃时不生效。用户会报「我的加头规则
在 chunked 接口上不工作」。统一后两条路径行为一致。

**判定期优化**（不是正确性必需，但省内存）：`bufferBody` 判定加一条 content-length 预判
——响应头已声明 `content-length` 且 > `MAX_BODY_SIZE` 时直接不进 buffer（走 live-pipe），
连那 1MB 都不用 buffer。对无 content-length / chunked 的响应，仍由「数据期叛逃」兜底覆盖。

**Session 证据链交互（显式决策，不可略过）**：`MitmModule.recordExchange`
（`MitmModule.ts:86-93`）只在 `modified=true` 时不喂 Session 水槽（`RuntimeServices.ts:86-89`
→ `captureEngine.ingestRequest`）。统一语义后叛逃路径与 live-pipe 逐字节等价：

- 命中 `modify_header(response)` → `after` 非 `undefined` → `modified=true` → **不入 Session**；
- 纯 `modify_body(response)` → `body=null` 不命中 → `after` 为 `undefined` → `modified=false`
  → 前 1MB 残体（`truncated:true`）**仍入 Session**。

这与「今天 live-pipe 上一个 >1MB chunked 响应」的行为**完全相同**，故 SP1 不新增 Session 侧
策略。若后续认为 `truncated` 残体污染证据链，属 SP3 范畴（见 §6）。

### 2.3 IPv6 CONNECT authority 修复

`handleConnect`（`MitmProxyServer.ts:306`）现用 `req.url.split(':')` 解析 authority，
`CONNECT [240c::1]:8080` 会被切成 hostname=`[240c`、port=`409f...`（ProxyPin 的
`temp_ipv6_test.dart` 正是守护此坑）。

修法（语义抄 ProxyPin `temp_ipv6_test.dart`，翻译成 TS）：

- 若以 `[` 开头且能找到 `]`：host = `[` 与 `]` 之间（**剥掉方括号**），`]` 后若紧跟 `:` 则其后为端口；
  找不到 `]`（畸形如 `[240c`）则整个 authority 当 host，端口取默认；
- 否则取 `lastIndexOf(':')` 分端口，仅当后缀能 `parseInt` 时才拆（`example.com` 无端口 → 默认）。

**hostname 一律返回「剥掉方括号」的形式**（如 `240c::1` 而非 `[240c::1]`）。两条理由：
`CaManager.getSecureContextForHost` 签证书不需要括号；且 §3.4 的 `shouldBypass` 做子串匹配，
保留括号会让用户 `mitm_add_host_filter 240c::1` 永远匹配不上。

逻辑放一个私有纯函数 `parseConnectAuthority(url: string): {hostname: string; port: number} | null`，
供 `handleConnect` 使用，便于单测。

### 2.4 SP1 测试（node:test，镜像目录）

**⚠️ 大 body 用例必须写两条，缺一不可** —— §2.2 有两条独立路径，只测一条会让另一条成为死代码：

- `tests/unit/modules/proxy/MitmProxyServer.test.ts` 增 4 条：
  1. **红灯 A（判定期预判 → live-pipe）**：源站返回固定 `content-length: 3MB` + 一条
     `modify_body(response)` 规则，断言客户端收满 3MB 且 `end`。此路径走 §2.2 的
     content-length 预判，**不进 buffer 分支**。（当前实现此条挂死）
  2. **红灯 B（数据期叛逃 → escapeToPipe）**：源站用 `Transfer-Encoding: chunked` 发 3MB
     （**不带 content-length**）+ 同样的规则，断言客户端收满 3MB 且 `end`、capture 的
     `truncated === true` 且 `responseBody` 有前 1MB、`responseBodySize === 3MB`。
     **此条才真正覆盖 §2.2 的叛逃代码**；只写 A 不写 B，叛逃路径零覆盖率。（当前实现此条同样挂死）
  3. **叛逃一致性（守 B2）**：同上 chunked 源站，但规则换成 `modify_header(response)`，
     断言客户端在**响应头里**收到该 header（证明叛逃时 `afterResponse` 照跑，
     与 live-pipe 语义统一）。
  4. `parseConnectAuthority`：`[240c::1]:8080` / `240c::1` / 畸形 `[240c` / IPv4 / 裸域名
     五组断言（语义抄 ProxyPin `temp_ipv6_test.dart`，翻译成 TS），并断言 hostname **不含方括号**。

**两条红灯都必须带显式 `{timeout: 10000}`**：node:test 默认 timeout 是 `Infinity`，修复前
不设超时会让 CI **永久挂住**而不是报红。仓库已有先例（`CodeCollector.guards.test.ts`、
`PageController.test.ts` 等均传 `{timeout: N}`）。

- 复用现有 `startOriginServer` / `requestViaProxy` 测试具（已存在）。大 body 源站需两个变体：
  A 用 `writeHead(200, {'content-length': 3MB}) + Buffer.alloc(BIG)`；B 用**不设
  content-length** 的分块 `res.write()`（Node 自动切 chunked）。都不必真起慢速流。

---

## 3. SP2 —— 域名过滤 + 流式阈值 + 4 个 MCP 工具

### 3.1 域名过滤（拦截旁路 + 记录过滤）

语义对齐 ProxyPin `components/host_filter.dart`（白名单优先，黑名单次之），但裁剪为
全进程内、无持久化：

- **白名单非空时**：不在白名单里的域名 = 全部旁路（拦截式白名单）。
- **否则黑名单非空时**：命中黑名单的域名 = 旁路。
- 两表皆空 = 不过滤（现状）。

`shouldBypass(hostname: string): boolean` 由 `MitmModule` 持有（类似 `rules`），构造
`MitmProxyServer` 时传入（新增可选构造参数，调用点仅 `MitmModule.start` 一处）。

**旁路 / 过滤的三个层次（三处都要改，缺一即漏）**：

1. **HTTPS CONNECT 旁路**（核心价值）：`handleConnect` 里 `shouldBypass(hostname)` 为真时，
   **不解密不签证书**，**无条件先写** `200 Connection Established`（与现状 `:313` 一致，
   也是真实代理的标准做法 —— 客户端期望立刻拿到 200），再 `net.connect(port, hostname)`
   双向 pipe，把 `head` 先写过去。不产生任何 `onCaptured` 记录；上游失败仅毁 socket（§4）。
2. **HTTP 明文 + 记录过滤**：`handleHttpRequest` 里 `shouldBypass` 为真时仍转发（保证连通），
   但跳过 `onCaptured`。实现上加一个 `shouldRecord = !this.shouldBypass(host)` 的判断。
3. **明文 `ws://` upgrade + 记录过滤**：`handleWsUpgrade`（`:214`，明文走
   `server.on('upgrade')`）**完全不经过上面两处**，仍在 `:268` 调 `onCaptured`。
   必须在 `handleWsUpgrade` 开头同样判 `shouldBypass` → 仍建隧道（保证连通）但跳过
   `onCaptured`。**不补这条，`mitm_add_host_filter block example.com` 之后
   `ws://example.com/...` 照样被抓。**

> **WSS（`wss://`）不需要在 `handleWsUpgrade` 处理**：它先走 `handleConnect`，
> 旁路后 miniServer 根本不会创建，`handleWsUpgrade` 不会被调用。
>
> **HTTPS 已解密后的 `handleDecryptedRequest` 也不需要改**：能进入说明已签了证书，
> 旁路决策发生在更早的 `handleConnect`。故「记录过滤」的实现点是 `handleHttpRequest`
> 与 `handleWsUpgrade` 两处，不是 `handleDecryptedRequest`。

**`shouldBypass` 入参口径**：三个调用点拿到的都是**裸 host**（CONNECT 用
`parseConnectAuthority` 的 hostname、`handleHttpRequest` 用 `parsed.hostname`、
`handleWsUpgrade` 用 `parsed.hostname`），统一先过 `normalizeHost`（见 §3.4）再传给
`shouldBypass`。

### 3.2 流式阈值

SP1 §2.2 的「越限叛逃」已经实现了流式阈值语义（大 body 停止 buffer、直接 pipe、保留截断
标记）。**SP2 不需要额外代码**，只在 spec 里声明：live-pipe 与 buffer 两条路径对 >1MB 响应
统一的行为是「pipe 完整字节 + capture 保留前 1MB + `truncated:true` + header 改写照常生效」。
测试由 SP1 §2.4 的用例一并覆盖（红灯 A 覆盖 live-pipe、红灯 B 覆盖叛逃、
叛逃一致性钉死两条路径语义统一）。

### 3.3 工具层（镜像 rewrite 4 件套 + manifest 注册）

新增 `src/tools/proxy/` 下 4 个 `defineTool`（`ToolCategory.NETWORK`）：

| 文件                  | 工具名                    | readOnlyHint | schema                                                                         |
| --------------------- | ------------------------- | ------------ | ------------------------------------------------------------------------------ |
| `addHostFilter.ts`    | `mitm_add_host_filter`    | false        | `action: 'allow'\|'block'`、`host: string`（同 id 覆盖，参考 rewrite addRule） |
| `listHostFilters.ts`  | `mitm_list_host_filters`  | true         | — 返回 `{allow, block}` 两列表                                                 |
| `removeHostFilter.ts` | `mitm_remove_host_filter` | false        | `action`、`host`                                                               |
| `clearHostFilters.ts` | `mitm_clear_host_filters` | false        | —                                                                              |

- `manifest.ts` 增 4 条 tool entry，`npm run build:index` 纳入 `GENERATED_TOOL_REGISTRY`。
- `index.ts`（tools/proxy）增 4 个 re-export。
- handler 全部走 `getRuntime().mitmModule.<method>()`，模式与 `addRewriteRule.ts` 一致。

### 3.4 MitmModule 新增方法

- `addHostFilter(action, host)` / `removeHostFilter(action, host)` / `listHostFilters()` /
  `clearHostFilters()`，均返回 `MitmMethodResult<...>`。
- 内部存 `allow: Set<string>` + `block: Set<string>`，`shouldBypass(host)` 按 §3.1 语义
  （白名单非空 → 不在白名单即旁路；否则黑名单命中即旁路；两空不过滤）。
- 新增纯函数 **`normalizeHost(hostname: string): string`**：小写化、去尾点、去 `:port` 后缀、
  剥 IPv6 方括号。存表前与匹配前**两侧都归一化**，匹配为子串包含（对齐
  `rewrite.ts` 里 `extractHost(view.url).toLowerCase().includes(needle)` 的口径）。

  > ⚠️ **不要复用 `rewrite.ts::extractHost`** —— 它入参是**完整 URL**（内部走 `new URL(url).hostname`），
  > 而这里三个调用点拿到的都已经是裸 host，拿 URL 解析器去归一化 hostname 属于误用。
  > 两者并存：`extractHost` 用于规则匹配（URL → host），`normalizeHost` 用于过滤（host → host）。

- `start()` 构造 `MitmProxyServer` 时把 `shouldBypass` 传进去（新增可选构造参数，
  调用点仅 `MitmModule.start` 一处；`shouldBypass` 内部自己调 `normalizeHost`）。

### 3.5 SP2 测试

- `tests/unit/modules/proxy/MitmModule.test.ts` 增：host filter 增删查清、`shouldBypass`
  白/黑名单语义（白名单非空则黑名单失效、两空不过滤）。
- `tests/unit/modules/proxy/MitmProxyServer.test.ts` 增（**三个层次各一条，对应 §3.1**）：
  1. 命中的 HTTP 明文请求**转发成功但不产生 capture 记录**。
  2. HTTPS CONNECT 命中的域名走旁路：用 raw socket 发一个 CONNECT，断言收到
     `200 Connection Established` 后 socket 上透传的是隧道而非 TLS 证书——简化版
     可只断言「不产生 capture 且隧道建立」。
  3. **明文 `ws://` 命中的域名：隧道建立成功但不产生 capture 记录**（守 §3.1 第 3 点，
     这是最容易漏的一条 —— 漏了它，屏蔽后 `ws://` 流量照样进列表）。
- `tests/unit/tools/proxy/tools.test.ts` 增 4 个新工具名到 `EXPECTED_TOOLS`。

---

## 4. 错误处理

- 旁路隧道上游连接失败 → 毁 socket，不写 capture（不产生 `502`，因为压根没签证书、没进
  HTTP 语义，纯传输层）。
- 域名匹配：非法输入（空 host）→ `addHostFilter` 返回 `success:false`，不落 state。
- 叛逃路径：`pipe` 错误由 `proxyRes.on('error')` / socket `error` 兜底，与 live-pipe 一致。

---

## 5. 验证闭环（对齐 CLAUDE.md「最终变更验证闭环」）

1. `npm run typecheck`
2. `npm run test:unit`（重点：`tests/unit/modules/proxy/`、`tests/unit/tools/proxy/`）
3. `npm run check-format`
4. 端到端手动：`start_mitm_proxy` → 加一条 response 改写规则 → `curl -x` 拉一个 >1MB 响应
   （**分别验一次带 content-length 的与一次 chunked 的**），确认：
   （a）curl 收满不挂；（b）`list_mitm_requests` 里该记录 `truncated:true`（注意
   `MitmRequestSummary` **不含 `responseBody`**，要看前 1MB 文本须再调
   `get_mitm_request({id})`）；（c）`mitm_add_host_filter` 屏蔽某域名后该域流量不再出现。
5. 若任一步失败，修复后**重跑同一步**，最后一次代码修改后重新拿新鲜通过证据。

---

## 6. 边界（本轮刻意不做）

- **SP3 结构化过滤下沉 Session/REST/web-ui** —— 下一轮单独 brainstorming。
- 不引入任何持久化层；域名过滤与 rewrite 规则同为进程内态。
- 不做 SOCKS5 服务端、证书下载页、系统代理设置、HTTP/2 全量（沿 `2026-08-26` 裁剪与
  gap-analysis 结论）。
- 不改 `src/web/`、`src/web-ui/`、`browsercli/`、`worker/`。
- **沿用 1MB 阈值**（不跟 ProxyPin 的 4MB）：`MAX_BODY_SIZE` 来自
  `src/modules/network/constants.ts` 的 `MAX_CAPTURED_BODY_BYTES`，与浏览器抓包链路共用，
  调它会波及 network 域，本轮不动。
- **Session 侧对 `truncated` 残体的策略**：本轮与现有 live-pipe 行为对齐（详见 §2.2 末尾），
  若后续认为残体污染证据链，连同「结构化过滤下沉」一并归入 SP3。
- **manifest ↔ registry 一致性断言**：`tools.test.ts` 遍历的是 `index.js` 的导出，
  `manifest.ts` 写漏了测不出来。本轮可加可不加，若加则断言
  `manifest.tools` 每个 entry 都能在 `GENERATED_TOOL_REGISTRY` 里找到。

---

## 附注：ProxyPin 侧关键坐标（本轮依据）

- 大 body 直通哲学：`channel_dispatcher.dart:113`（`buffer.length > maxBodyLength` → relay）、
  `http/codec.dart:75 maxBodyLength = 4096000`。
- 域名过滤语义：`components/host_filter.dart:23-46`（白名单优先、黑名单次之）。
- IPv6 authority 坑：`test/temp_ipv6_test.dart`。
- SSE/WS 逐帧、zstd、规则持久化、优先级等 —— 见 2026-08-31 分析正文，均不在本轮 P0。
