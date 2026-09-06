# BrowserCLI Heavy SPA Reverse Engineering Optimization — System Design Spec

- **Date:** 2026-08-22
- **Status:** In Review (已按代码现状回填修订)
- **Target Subsystems:** `proxycli/`, `src/worker/`, `src/modules/debugger/`, `src/modules/network/`, `src/modules/hook/`, `src/tools/`

> 修订说明：原稿将本规范写成“将要实现的改造”，但经与 `refactor` 分支代码比对，原问题
> 列表中的多数项**已经落地**，且部分设计项与既有实现直接冲突。本版先回填现状，再仅保留
> 真实的剩余增量，并记录关键冲突决策（见 §4）。

---

## 1. Current State Review

原始问题清单 → 当前落地状态（证据见右侧路径）：

| # | 原始问题 | 状态 | 现状证据 |
|---|---|---|---|
| 1 | Worker 死锁 / `409 WORKER_BUSY` 泄漏 | **已解决** | `WorkerActivityCoordinator`（runTool 允许并发 + runBrowserOperation 互斥门 + `raceWithAbort`）：`src/worker/WorkerActivityCoordinator.ts:66-116`；`WorkerHttpClient.invoke` 超时自动 `cancelJob`：`proxycli/src/WorkerHttpClient.ts:236-243`；`apiV1.rejectIfBusy` 结构化 409：`src/web/routes/apiV1.ts:279-311` |
| 2 | 脚本搜索下载全部脚本超时 | **已解决** | `ScriptManager.searchInScripts` 已做 cached 本地搜索 + `Debugger.searchInContent` 预筛 + 仅命中脚本加载源码：`src/modules/debugger/ScriptManager.ts:540-691`；两套搜索工具共存：`search_in_sources`（`src/tools/debugger/index.ts:943`）、`search_in_scripts`（`src/tools/collector/searchInScripts.ts:26`） |
| 3 | 大响应体阻塞 | **部分解决** | `NetworkModule.getRequest` 已按 `maxBodyLength`（默认 `DEFAULT_GET_BODY_LENGTH=300`）截断并追加 `... [truncated]`：`src/modules/network/NetworkModule.ts:414-463`；但缺 `fullBody/saveTo` 与 `isTruncated/totalBodyLength/previewLength/savedPath` 元数据（见增量 2） |
| 4 | fetch hook 漏 XHR | **已解决** | `HookTypeRegistry` 提供分离的 `fetch` 与 `xhr` 类型；xhr 已 patch open/send 并捕获 status/responseText：`src/modules/hook/HookTypeRegistry.ts:126,278` |
| 5 | 多 frame 执行上下文歧义 | **已解决（有意保留显式报错，不做隐式 top 帧降级，见决策 D6）** | `evaluate_script` 返回结构化上下文列表 + `--frameId`/`--allowAnyFrame` 提示：`src/tools/script/script.ts:103-149` |
| 6 | 二进制/protobuf WS 解码开销 | **部分解决** | `websocketFormatter.guessHintFromHead` 已识别 Protobuf/JSON/Gzip/MsgPack/Zstd/ping 头（含 varint field tag 前缀): `src/formatters/websocketFormatter.ts:256-296`；`analyze_websocket_messages` 已做模式指纹分组：`src/tools/network/analyzeMessages.ts:16`；缺零 schema 字段解析 + 嵌入 JSON 提取（见增量 3） |
| 7 | CLI 参数/输出不一致 | **部分解决** | hook `action`/`capture` schema 已实现：`src/modules/hook/HookManager.ts:37-45`；但 `direction` 无 `'both'`（见增量 5），list 命令无 `--json`（见增量 6） |

---

## 2. Goals & Non-Goals (Revised)

### Goals（仅保留真实剩余增量）
1. **CLI 自愈**：`WorkerHttpClient` 对 409 做退避重试，仍忙则返回结构化 busy 错误。
2. **网络吞吐元数据**：`get_network_request` 补充 `fullBody`/`saveTo` 与截断元数据字段，避免多 MB 负载贴进 CLI 序列化。
3. **WS 零 schema 解码**：在既有 `guessHintFromHead` 启发式之上，对命中 Protobuf 的帧做 varint 字段解析与嵌入 JSON 提取，产出结构化 `decodedJson`。
4. **协议级 hook 回退**：`create_hook` 提供 opt-in 的 CDP `Fetch.enable` 协议级拦截，覆盖 JS hook 被绕过/禁用场景。
5. **CLI 契约收尾**：`direction` 增加可选 `'both'`；list 系列命令支持 `--json`。

### Non-Goals
- 不更换 Playwright/CDP 浏览器引擎。
- 不实现完整 `.proto` 编译器/代码生成（启发式 + 零 schema 提取足够）。
- **不再新增读写分离的 Exclusive/Probe 工具分类**：现有 `runTool`（并发）+ `runBrowserOperation`（互斥门）已满足隔离需求，进一步分类属过度设计（YAGNI，见决策 D1）。

---

## 3. Remaining Incremental Design

### 增量 1：`WorkerHttpClient` 409 退避重试（P1→P2）

- 位置：`proxycli/src/WorkerHttpClient.ts::invoke`（`224-261`）。
- 行为：当任务返回错误码 `WORKER_BUSY` 且当前工具为 probe 型（`readOnlyHint` 为真）时，按 `[200ms, 500ms, 1000ms]` 退避重试（最多 3 次，总预算 3s）。
- 仍忙：抛结构化错误，携带当前 `jobId` / `operation`（复用 `JobStatus.error.recovery` 通道，见 `WorkerHttpClient.ts:251-257`）。
- 依赖：任务返回体需带 `error.code === 'WORKER_BUSY'`（现状 `WorkerBusyError.code` 已为此值）。

### 增量 2：`get_network_request` 元数据与落盘（P1）

- 位置：`src/modules/network/NetworkModule.ts::getRequest`（`414`）+ `src/modules/network/NetworkTypes.ts::GetNetworkRequestData`（`256-283`）。
- **默认值保持不变**（`DEFAULT_GET_BODY_LENGTH=300` 字符），仅新增**可选**字段，向后兼容：
  ```typescript
  interface GetNetworkRequestData {
    // ...existing
    isTruncated: boolean;      // 是否被截断
    totalBodyLength: number;   // 完整响应体字节/字符数
    previewLength: number;     // 实际返回的长度
    savedPath?: string;        // saveTo 时写盘路径
  }
  ```
- 新增参数：`fullBody?: boolean`（跳过截断）、`saveTo?: string`（字节流直写文件，返回 `savedPath`，不填充终端缓冲）。
- 注意：不采纳原稿“默认 4KB”的表述，避免破坏 `get_network_request` 与 `replay`（`DEFAULT_REPLAY_BODY_LENGTH=2000`）的既有默认契约。

### 增量 3：WS 零 schema Protobuf/JSON 解码增强（P2）

- 位置：`src/formatters/websocketFormatter.ts`（`256-296`）+ `src/modules/network/NetworkModule.ts::analyzeWebSocketMessages` / `getWebSocketMessage`。
- 在既有 `guessHintFromHead` 的 varint 前缀启发式基础上，对命中 `Protobuf` 的帧：
  1. 解析 varint field tag + wire type；
  2. 扫描长度定界字段中的 UTF-8 切片，匹配 JSON 对象/数组边界（`{...}` / `[...]`）；
  3. 命中有效 JSON 时，置入 `decodedJson` 并标注 `decodeType: 'protobuf-embedded-json'`；否则 `decodeType: 'protobuf'`。
- 挂载方式（已落地）：给 `get_websocket_message` 增加**可选** `decode?: 'auto' | 'protobuf' | 'json' | 'raw'`（默认 `'auto'`），返回 `decodeType` 与可选的 `decodedJson`；**不**在 `get_websocket_messages` 上新增解码参数（避免与“先 analyze 再按 groupId 取数”的既有工作流冲突，见决策 D2）。
- `analyze_websocket_messages` 的逐帧 `decode` 延后：其职责是按模式指纹分组统计而非逐帧解码，单帧解码以 `get_websocket_message` 承载（决策 D2 的细化）。
- 关于负载上限：现状无 `maxPayloadSize` 参数（全仓无匹配）。若需限制单帧解码规模，在 `WebSocketCollector` 侧新增，取值与现状核对后再定。

### 增量 4：`create_hook` 协议级回退（P2，opt-in）

- 位置：`src/tools/hook/CreateHook.ts`（`name: 'create_hook'`，`21`）+ `src/modules/hook/HookTypeRegistry.ts`。
- 现状 `fetch`/`xhr` 分离类型已覆盖 JS 层双协议（见 §1 #4），**不新增**“统一 fetch+xhr”类型。
- 新增 opt-in 参数 `protocolFallback?: boolean`（默认 `false`），随 `create()` 返回值与 `HookMeta.config` 透传留存。
- **交付边界**：本迭代仅落地数据层透传；CDP `Fetch.enable` 协议级拦截的运行时启用接线依赖浏览器/CDP 会话生命周期，列为后续独立计划。
- 保持默认零注入哲学（与 `AGENTS.md` 反检测分层一致，协议层仅在工具显式需要时激活）。

### 增量 5：`direction` 增加 `'both'`（P2）

- 位置：`src/tools/network/getMessages.ts:14`、`src/tools/network/analyzeMessages.ts:14`（`DIRECTION_OPTIONS`）。
- 新增可选值 `'both'`，按时间序合并 sent + received；**默认保持不变**（现状缺省即不过滤方向），不改破坏性默认。

### 增量 6：CLI `call --json` 纯数据输出（P2）

- 位置：`proxycli/src/commands/tool-dispatcher.ts` + `proxycli/src/commands/shared/tool-args.ts`（`TOOL_CONTROL_FLAGS`）。
- 语义澄清：list 类工具（`list_network_requests`/`list_pages`/`list_frames`/`list_scripts`）经 `proxycli call <tool>` 统一入口调用；`--json` 是 CLI 输出层 flag，非 MCP 工具参数。为 `call --json` 时直接输出工具的原始 structuredContent（纯 JSON，无 `command/target/tool` 包装），便于 jq/grep 自动化。

---

## 4. Decision Records

| 决策 | 内容 | 依据 |
|---|---|---|
| D1 | **不再做读写分离工具分类** | 现有 `runTool`（并发）+ `runBrowserOperation`（互斥门）已隔离，Exclusive/Probe 分类与 `browserOperation` 门重叠，属 YAGNI |
| D2 | **WS 解码挂 `analyze_websocket_messages`/`get_websocket_message`，不进 `get_websocket_messages`** | 复用既有“先 analyze 再 groupId 取数”工作流与 `guessHintFromHead`，避免平行造轮子 |
| D3 | **网络默认值保留 `300` 字符，不升 4KB** | 避免破坏 `get_network_request`/`replay` 既有默认契约；`fullBody`/`saveTo` 以 opt-in 提供 |
| D4 | **fetch/xhr 保持分离类型，不合并** | `HookTypeRegistry` 已双类型覆盖；合并会改 `create_hook` CLI 语义 |
| D5 | **`direction:'both'` 仅作可选值，不改默认** | 现有缺省语义（不做方向过滤）不应被破坏性改变 |
| D6 | **evaluate_script 不做“默认降级 top 帧”** | 现状结构化诊断 + `--allowAnyFrame` 已满足；隐式降级会掩盖真实歧义，与证据优先原则相悖 |

---

## 5. Verification & Testing Strategy

1. **409 退避（增量 1）**：mock 服务端持续返回 `WORKER_BUSY`，断言 `invoke` 按 `[200,500,1000]` 重试 3 次后抛出结构化 busy 错误；mock 第二次返回 done，断言首轮重试即成功。
2. **网络元数据/落盘（增量 2）**：5MB 测试负载 → 默认返回 ≤300 字符且 `isTruncated:true`、`totalBodyLength` 正确；`saveTo` 写盘后 `savedPath` 存在、字节数与 `totalBodyLength` 一致；`fullBody:true` 完整返回。
3. **WS 解码（增量 3）**：用 ByteDance 网关二进制帧样本（protobuf 头 + JSON 体）→ 断言 `decodedJson` 提取成功、`decodeType:'protobuf-embedded-json'`；纯 protobuf 无 JSON 体 → `decodeType:'protobuf'`。
4. **协议级回退（增量 4）**：`protocolFallback:false` 时不启用 `Fetch.enable`；`true` 时能拦截 JS 层 hook 之外的请求。
5. **CLI 契约（增量 5/6）**：`direction:'both'` 合并顺序正确；`--json` 输出可被 `jq` 直接解析，无 ANSI 序列。

---

## 6. Rollout Plan

- **Phase 1（P1 吞吐）**：增量 2（网络元数据 + fullBody/saveTo）。
- **Phase 2（P2 能力）**：增量 3（WS 解码）、增量 4（协议级回退）。
- **Phase 3（P2 契约与自愈）**：增量 5（direction both）、增量 6（--json）、增量 1（409 退避）。