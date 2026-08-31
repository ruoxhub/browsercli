# mitmproxy 深度分析与 proxy 模块完善路线

- **日期**：2026-08-30
- **状态**：差距分析（结论导向，供分波决策；非可执行实现 spec）
- **上游参照**：`open-source/mitmproxy`（MIT License，已核实 `LICENSE`）
- **目标模块**：`src/modules/proxy/` + `src/tools/proxy/`（6 个 `mitm_*` 工具）
- **前序约束**：`2026-08-26-mitm-proxy-module-design.md`（方案 A — 纯 Node MITM 引擎，不换引擎）
- **关联**：`2026-08-30-jshookmcp-gap-analysis.md` §4.1 已标 proxy 域「缺 GraphQL/HTTP2」

---

## 1. 目的与结论摘要

`2026-08-26` 版把 anything-analyzer 的纯 Node MITM 引擎迁入，交付了「抓」这条链路（HTTP 直转
/ HTTPS CONNECT 动态签证书 / ws 隧道 + 内存环形缓冲 + 6 工具）。但引擎是**单向观察**：只转发 + 回调
`onCaptured`，看不到的 mitmproxy 另一半是「**拦 + 改 + 导**」。

本文对照 mitmproxy 源码梳理它的能力面，产出「该补什么、不该补什么」决策表与分波路线，结论：

1. **不换引擎、不引跨语言运行时**。mitmproxy 的协程分层核心（`proxy/layer.py`）是 Python asyncio
   生成器状态机，不移植；只平移它的**能力面语义**（事件钩子 / Flow 模型 / 过滤 DSL / 改写规则 / 导出族）。
2. **最高价值缺口是「在途拦截改写」**：当前只能抓不能改，而项目方法论（`Observe-first` /
   `Hook-preferred` / `Evidence-first`）里「改包验证 hook 假设」需要它。mitmproxy 的
   modifyheaders / modifybody / maplocal / mapremote / blocklist / intercept 是可直接平移的最小规则集。
3. **次高价值缺口是结构化过滤 + 导出**：`list_mitm_requests` 只有 `urlFilter` 子串；导出只有
   `saveTo` 写响应体。mitmproxy 的 flowfilter DSL 与 export/savehar 家族是现成蓝本。
4. **排除**：完整 addon 脚本引擎、命令系统、透明/反向代理、DNS/QUIC/TCP 通用代理、内容视图
   （contentviews）——超「非浏览器流量逆向」主线，或已被 `analyzer` 域 AI 能力覆盖。

---

## 2. mitmproxy 架构与能力面解析

### 2.1 引擎骨架（不移植，仅了解）

- **协程分层核心** `mitmproxy/proxy/layer.py`：`Layer._handle_event` 是 Python 生成器，yield
  blocking `Command` 会暂停，收到对应 `CommandCompleted` 后继续——用「看似阻塞实为协程」的方式组织
  TCP → TLS → HTTP/WS/DNS/QUIC 协议栈。`next_layer.py` 通过 `next_layer` 钩子嗅探首包字节决定下一层
  （TLS 直连 / HTTP CONNECT / DNS / rawtcp）。这套是 Python 专属，Node 侧由 `MitmProxyServer` 的
  `connect`/`upgrade` 事件分支等价覆盖，**不迁移**。

### 2.2 Addon 事件钩子模型（★ 可平移的骨架）

- `mitmproxy/addonmanager.py`：addon 装载与事件分发中心。
- `mitmproxy/hooks.py`：定义生命周期事件（`request` / `requestheaders` / `response` /
  `responseheaders` / `websocket_message` / `tcp_message` / `client_connected` …）。
- `mitmproxy/addons/__init__.py:34 default_addons()`：27 个默认 addon，全部是「对事件的响应函数」。
  任何拦截/改写/导出能力都 = 挑几个事件 + 一个 addon 类。

**平移点**：当前 `MitmProxyServer` 是「转发 + `onCaptured(exchange)`」单向链路，缺少请求/响应在途的
**改写插桩点**。只要在 `handleDecryptedRequest`（转发前）与 `relayResponse`（回传前）各加一个构造注入
钩子（`beforeRequest` / `afterResponse`），就能承载 2.3 的全部改写能力。这是**一处小改点，解锁一个大能力面**。

### 2.3 拦截改写族（★ 直接迁移的规则集）

全部是「`/流过滤器/正则/替换` 三段式」字符串规则，`utils/spec.py::parse_spec` 统一解析。天然契合
`defineTool` + zod schema，无需脚本 VM：

| addon              | 事件                           | 语义                                                      |
| :----------------- | :----------------------------- | :-------------------------------------------------------- |
| `blocklist.py`     | request                        | 命中即返回指定状态码（`444` = 断连不响应），`flow.kill()` |
| `intercept.py`     | request/response               | 命中即 `flow.intercept()` 暂停，等 `resume()`             |
| `modifyheaders.py` | requestheaders/responseheaders | 按 header 名删/改；`@path` 读文件                         |
| `modifybody.py`    | request/response               | `re.sub` 正则替换 body（`re.DOTALL`）                     |
| `maplocal.py`      | request                        | URL 正则 → 本地文件，`Response.make(200, ...)` 短路       |
| `mapremote.py`     | request                        | URL 正则 → 另一远程 URL（`request.url` setter 同步 host） |
| `anticache.py`     | request                        | 删 `if-modified-since`/`if-none-match`，防 304            |
| `anticomp.py`      | request                        | `accept-encoding: identity`，逼服务器回未压缩             |
| `disable_h2c.py`   | request                        | 删 `upgrade: h2c` 头，杀 `PRI * HTTP/2.0` 前导            |

### 2.4 Flow 模型（`flow.py`）

每条事务是 `Flow`（`request` / `response` / `error` / `websocket` + `intercepted`/`marked`/
`is_replay`/`comment`/`metadata`）。关键方法是 `intercept()` / `resume()`（asyncio.Event 阻塞）、
`kill()`（打 `Error(KILLED)`，可断连）。首版可只借 `kill()` 语义（blocklist 的 444/断连）。

### 2.5 FlowFilter DSL（`flowfilter.py`）

`~q`(有请求无响应) `~s`(有响应) `~m rex`(方法) `~u rex`(URL) `~d rex`(域名) `~c code`(状态码)
`~h/hq/hs rex`(头) `~b/bq/bs rex`(body) `~t rex`(content-type) `~a`(资源) `~websocket`/`~tcp`/`~dns`，
支持 `!`(not) `&`(and) `|`(or) 括号分组。裸 rex 等价 `~u`。当前 `MitmModule.listRequests` 只有
`urlFilter` 大小写不敏感子串，**无方法/状态/域名/头/body 谓词**——这是最便宜、收益立现的完善点。

### 2.6 Flow/Message 数据模型（`http.py` / `flow.py`）

- `Message` 同时保留 `raw_content`（压缩后原始字节）与 `content`（解码后、`strict=False` 时降级），
  `text` 做 charset 推断。**二进制不丢证据**。
- `stream` 属性：`False` 全程 buffer，`True` 只转发不 buffer，或给一个逐 chunk 变换函数。控制内存。
- `Response.make` / `Request.make` 简化构造；`anticache()`/`anticomp()`/`constrain_encoding()` 内置方法。

当前 `MitmProxyServer.relayResponse` 与 `bodyToUtf8` 的差距：① **永远先 buffer 到 1MB 再 pipe**（无
流式阈值，大响应/视频下载白吃内存）；② **`isBinary` 时把 requestBody/responseBody 直接置 null**（证据
丢失，回不来了）。

### 2.7 导出族

- `export.py`：`curl` / `httpie` / `raw` / `raw_request` / `raw_response`。curl 生成含
  `--compressed`、`--resolve`、`-H`、`-X`、`-d`。
- `savehar.py`：HAR 1.2（含 timings connect/ssl/send/wait/receive、websocket `_webSocketMessages`、
  二进制 base64 + `encoding` 字段）。`flow_entry()` 是现成的 HAR schema 蓝本。
- `save.py`：流式 dump（边抓边写）+ `+` 前缀追加 + `strftime` 文件轮转。
- `cut.py`：按属性路径（`request.headers[set-cookie]`、`request.content`）提取字段，多流 → CSV。
- `stickycookie.py` / `stickyauth.py`：按 host 记住 cookie/auth，重放时自动补回——逆向「带登录态重放」刚需。
- `serverplayback.py` / `clientplayback.py`：服务器侧 mock / 客户端侧重放（请求 hash 匹配）。等价能力本项目
  `NetworkModule.replayEngine` + `replay_*` 工具已覆盖，proxy 域**无需再建**（见 §4.3）。

当前 proxy 域导出只有 `get_mitm_request` 的 `saveTo`（写 `responseBody`）。curl/HAR/dump 全部缺失；
其中 curl 可**复用** `src/modules/network/replayEngine.ts::formatCurl`。

### 2.8 证书与 TLS（`tlsconfig.py` / `addons/tls.py`）

`TlsConfig.tls_start_client` 做 ALPN 协商（client ALPN 透传、h2 开关）、SNI 证书选择、cipher 控制；
`server` 侧 `ssl_insecure`/`ssl_verify_upstream_trusted_ca` 决定上游证书校验。当前 `CaManager` 已覆盖
动态签 CA + 叶子证书 + AKI 修复（Android 398 天），TLS 配置面可后续按 `keylog`/h2 单项评估，不整体移植。

---

## 3. 逐域对照决策表

判定沿用 jshookmcp gap-analysis 的三分类：✅ 已有 / ⚠️ 缺口 / 🚫 排除。

| mitmproxy 能力                                                   | 首页文件                                | 本项目现状                                                       | 判定                              |
| :--------------------------------------------------------------- | :-------------------------------------- | :--------------------------------------------------------------- | :-------------------------------- |
| 结构化流过滤器                                                   | `flowfilter.py`                         | `list_mitm_requests` 仅 `urlFilter` 子串                         | ⚠️ P0                             |
| 请求改写（block/map_local/map_remote/modify_header/modify_body） | `blocklist.py` 等 5 addon               | 无，只能抓                                                       | ⚠️ P1                             |
| 拦截暂停/恢复                                                    | `intercept.py` / `flow.py::intercept`   | 无                                                               | ⚠️ P1（首版只做 kill 语义）       |
| 流式阈值 / raw+content 双留                                      | `http.py::Message.stream/raw_content`   | 全 buffer、二进制丢 body                                         | ⚠️ P0                             |
| curl/raw 导出                                                    | `export.py`                             | 无（`replayEngine.formatCurl` 可复用）                           | ⚠️ P0                             |
| HAR 导出                                                         | `savehar.py`                            | 无                                                               | ⚠️ P1                             |
| 流式 dump + 轮转                                                 | `save.py`                               | 无（仅内存环形缓冲，spec 明确不落盘）                            | ⚠️ P2                             |
| 字段裁剪 CSV                                                     | `cut.py`                                | 无                                                               | ⚠️ P2                             |
| WebSocket 逐帧记录                                               | `websocket.py`                          | ws 只发 `isWebSocket:true`，无逐帧                               | ⚠️ P2                             |
| sticky auth/cookie 重放                                          | `stickyauth.py`/`stickycookie.py`       | 无                                                               | ⚠️ P2（可并入 network replay 域） |
| anticache/anticomp                                               | `anticache.py`/`anticomp.py`            | 无（`bodyToUtf8` 会解码 gzip 但不主动 anti）                     | ⚠️ P2                             |
| HTTP/2（ALPN h2）                                                | `tlsconfig.py`/`_http2.py`              | 无                                                               | ⚠️ P2（gap-analysis 已标）        |
| 上游代理 / SOCKS5                                                | `_upstream_proxy.py`                    | spec 明确裁剪                                                    | ⚠️ 单列（不强求）                 |
| CA onboarding 页                                                 | `onboarding.py`/`onboardingapp/`        | spec 明确裁剪（cert download page）                              | ⚠️ 可选恢复                       |
| 完整 addon 脚本引擎                                              | `script.py`                             | 无（MCP 工具 + 规则，无需 VM）                                   | 🚫                                |
| 命令系统（`foo.bar` cmd）                                        | `command.py`                            | 无（工具形态不同）                                               | 🚫                                |
| 透明/反向代理模式                                                | `mode_servers.py`                       | 无（只做显式代理 `-x`）                                          | 🚫                                |
| DNS/QUIC/TCP/UDP 通用代理                                        | `layers/dns.py` 等                      | 无（超 HTTP/WS 主线）                                            | 🚫                                |
| 内容视图（json/graphql/zip/image…）                              | `contentviews/`                         | 已有 `analyzer` AI 能力（CryptoScriptExtractor/TrafficPurifier） | 🚫（graphql 单项见 §5）           |
| 服务器 mock / 客户端重放                                         | `serverplayback.py`/`clientplayback.py` | `NetworkModule.replayEngine` 已覆盖                              | ✅ 已覆盖                         |

---

## 4. 关键缺口细化

### 4.1 过滤能力（P0，最小 diff）

`MitmModule.listRequests`（`src/modules/proxy/MitmModule.ts:137-171`）当前只有 `urlFilter` 子串。
平移 `flowfilter.py` 的一个子集即可：`method`、`statusCode`、`host`/`domain`、`headerContains`、
`bodyContains`，各为可选 zod 字段，AND 组合。无需完整 DSL 解析器（`! & |` 分组留到有实证需求再上）。

### 4.2 body 采集语义（P0）

`MitmProxyServer.relayResponse`（`MitmProxyServer.ts:408-470`）：

- 引入流式阈值：响应超过 `MAX_BODY_SIZE` 时不 buffer 而是直接 `pipe`，`truncated` 标记保留；
  低于阈值才 buffer 供 llm/导出。对齐 `Message.stream` 语义。
- 二进制不再丢证据：`isBinary` 时保留 `responseBody` 为 null 但补 `bodyTruncatedBytes`/`bodyEncoding`
  提示，或在 `CapturedExchange` 增加可选 `rawBodyBase64`（首版可仅加长度提示，避免内存膨胀）。

### 4.3 在途拦截改写（P1，核心）

`MitmProxyServer` 构造增注 `beforeRequest?` / `afterResponse?` 两个可选回调。`MitmModule` 持有规则集，
工具层新增：

| 工具                                   | mitmproxy 对应     | 语义                                                |
| :------------------------------------- | :----------------- | :-------------------------------------------------- |
| `mitm_add_block_rule`                  | `blocklist.py`     | `/urlFilter/status` 命中即短路返回 code（444=断连） |
| `mitm_map_local`                       | `maplocal.py`      | `/urlRegex/localPath` 命中读本地文件短路            |
| `mitm_map_remote`                      | `mapremote.py`     | `/urlRegex/replacement` 重写目标 URL                |
| `mitm_modify_header`                   | `modifyheaders.py` | 按名删/改请求或响应头                               |
| `mitm_modify_body`                     | `modifybody.py`    | 正则替换请求或响应体                                |
| `mitm_clear_rules` / `mitm_list_rules` | —                  | 规则管理                                            |

全部规则式、可 `clear`，对齐「规则不落盘、进程内有效」现有约束。不引入 `flow.intercept()` 阻塞暂停
（首版不做，`kill()` → 断连语义先行）。

### 4.4 导出能力（P0/P1）

- `get_mitm_request` 增加 `format: 'curl' | 'raw'` 导出（`curl` 复用 `formatCurl`）。
- 新增 `mitm_export_har`（P1）：把当前缓冲全量/HAR 1.2（`savehar.py::flow_entry` 为 schema 蓝本）。
- 字段裁剪/CSV（`cut.py`）与流式 dump（`save.py`）列为 P2，需打破「仅内存」约束，视需求再定。

---

## 5. 分波路线

| 波次               | 内容                                                                                                                                      | 前置       | 规模                                            |
| :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :--------- | :---------------------------------------------- |
| **P0**（立即）     | ① `list_mitm_requests` 结构化过滤（method/status/domain/header/body）；② 流式阈值 + 二进制不丢证据；③ `get_mitm_request` 增 curl/raw 导出 | 无         | 3 文件小 diff                                   |
| **P1**（核心）     | ④ beforeRequest/afterResponse 插桩 + 6 个改写规则工具（block/map_local/map_remote/modify_header/modify_body + 规则管理）；⑤ HAR 导出      | P0         | MitmProxyServer + MitmModule + types + 5~7 工具 |
| **P2**（单项评估） | ⑥ ws 逐帧采样；⑦ HTTP/2；⑧ sticky auth/cookie 重放（倾向并入 network 域 replay）；⑨ 流式 dump/CSV                                         | P1         | 视单项定                                        |
| 悬挂               | 上游代理、CA onboarding 页、graphql contentview 结构化解包（并入 gap-analysis 的 graphql P1）                                             | 有实证需求 | 不主动                                          |

每波实施前单独走 `brainstorming → writing-plans → 设计审批`（与 jshookmcp gap-analysis §5 一致）。

---

## 6. 与既有约束的对齐

1. **不换引擎**：`2026-08-26` 方案 A（纯 Node）继续成立。mitmproxy 只贡献「能力面语义」，P1 的插桩
   点加在 `MitmProxyServer` 现有 `handleDecryptedRequest`/`relayResponse` 内，不改其对外结构。
2. **Session 水槽**：`MitmModule.recordExchange`（`MitmModule.ts:62-70`）先旧链路（ProxyStore）再新
   链路（`onExchange` 水槽）。新增改写/导出不得改变 exchange 落点顺序，改写规则应只影响**转发后的**
   采样（或显式标记 `modified`，不静默污染 session 链路的「真实流量」证据）。这是逆向证据链的
   Evidence-first 要求，与「抓真实流量」的默认语义必须区分。
3. **反检测分层**：MITM 抓包本身不注入 JS，与四层反检测无冲突；不改动 `BrowserManager` 启动路径。
4. **许可证**：mitmproxy 为 MIT（已核实 `LICENSE`），与 Apache-2.0 兼容；clean-room 平移仅取语义，
   不复制实现文本（与 jshookmcp AGPL 划界不同，无 AGPL 负担）。

---

## 7. 风险与未决

1. P1 改写规则「规则式」没有 `flowfilter` 的通用性（无 `& | !`），首版以「可选字段 AND 组合 + 每个
   规则一个 `urlFilter` 前缀」替代。若未来规则组合变复杂，再评估是否引入精简 DSL。
2. P1 的 beforeRequest 改写「请求体对上游重发」需要重建 content-length/host，`MitmProxyServer` 现按
   `clientReq.headers` 原样转发，改 body 后要同步这些头——实现时需补 `Body 重写后头修正` 子任务。
3. 过滤/导出的「工具数」为设计时点估算，落地以单波 brainstorming 回填。
4. ws 逐帧采样与 `NetworkModule` 的 WebSocket 能力（CDP）有命名/语义重叠，P2 时需明确「proxy 域 ws
   采样」与「network 域 ws 分析」的边界，避免重复实现。
