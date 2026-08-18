# Worker 反调试卡死自愈与工程一致性设计规范 (Design Spec)

- **日期**: 2026-08-18
- **模块**: Worker 运行时 / 执行管线 / CDP 协议层 / CLI 客户端 / Skill 规范
- **状态**: Approved (Design Stage)
- **文档路径**: `docs/superpowers/specs/2026-08-18-worker-anti-debug-resilience-and-consistency-design.md`

---

## 1. 背景与核心问题

在逆向包含强反调试（如无限 debugger、定时器死循环、内存炸弹、死锁 eval）的页面时，系统常陷入以下严重可用性故障：

1. **“伪超时”与 CDP 队列挂死**：`timeoutUtils.ts` 采用 `Promise.race` 做 10s 超时控制。Node.js 侧虽然抛错返回，但 Chrome V8 仍在卡死执行，底层的 CDP 命令队列永久排队阻塞，导致后续对该页面的所有工具调用均无响应。
2. **缺乏状态感知与级联等待**：当页面卡死后，上层调度往往连续尝试多个工具（如 `get_hook_data`、`collect_code`、`query_dom`），每个工具都会傻等 10s～300s，严重浪费 Agent 上下文与时间预算。
3. **Cancel 与 Disconnect 自身被挂死**：`/api/v1/jobs/:id/cancel` 与 `/api/v1/browser/disconnect` 强依赖 `await current.execution`，若底层 Promise 永远不 settle，取消和断开请求自身也会永久挂起。
4. **重连竞态 502**：`disconnect` 后立即 `connect` 时，因 Chrome 端口重启与 DevTools 协议栈就绪的时序延迟，易产生 502 错误。
5. **客户端与 Worker 版本脱节**：`browsercli/` 与 Worker 独立构建，本地全局 CLI 可能缺失最新能力或参数。
6. **文档与代码 Schema 不一致**：`skills/**/*.md` 中的命令行示例因代码重构而滞后，导致 LLM 生成不存在的参数（如 `--target`, `--force`）。

---

## 2. 总体架构与自愈状态机

```
                      [ 工具请求 / Job 启动 ]
                                │
                                ▼
                   ┌───────────────────────────┐
                   │  PageHealthTracker 前置检查 │
                   └────────────┬──────────────┘
                                │
             ┌──────────────────┴──────────────────┐
     [状态为 UNRESPONSIVE]                   [状态为 HEALTHY / DEGRADED]
             │                                     │
   是否为恢复类工具?                               │
      ├─ 否 ──► 0ms 快速失败 (Fast-Fail)            │
      └─ 是 ──► 放行执行                            ▼
                                         ┌─────────────────────┐
                                         │  wrapFrameWithTimeout│
                                         └──────────┬──────────┘
                                                    │
                                      ┌─────────────┴─────────────┐
                                  [正常完成]                    [超时触发 (10s)]
                                      │                           │
                                      ▼                           ▼
                             重置连续失败计数为 0         下发 Runtime.terminateExecution
                                                           + Page.stopLoading (软中断)
                                                                  │
                                                                  ▼
                                                      PageHealthTracker 记入 1 次超时
                                                      (连续 >= 2 次升为 UNRESPONSIVE)
```

---

## 3. 详细设计规范

### 3.1 建议 1：超时由“竞速”升级为“主动中断” (timeoutUtils.ts / WorkerActivityCoordinator)

* **目标**：在 `evaluate` 超时或 Job 被 Abort 时，真正释放 V8 执行线程与底层 CDP 通道。
* **机制**：
  1. `wrapFrameWithTimeout(frame, timeoutMs, page)` 升级为感知底层 Page / CDPSession。
  2. 超时发生时，不仅 reject 本地 Promise，且立即异步触发：
     * `cdpSession.send('Runtime.terminateExecution')`：打断 V8 死循环并抛出 TerminationException。
     * `cdpSession.send('Page.stopLoading')`：终止网络和资源加载卡死。
  3. `WorkerActivityCoordinator.runTool(..., signal)` 在 `signal.aborted` 时，联动调用活跃 Page 的中断探针。

### 3.2 建议 2：页面健康度追踪与 0ms 快速失败 (PageHealthTracker / ToolExecutionPipeline)

* **目标**：杜绝向已卡死页面盲目发起工具调用，拦截无效等待。
* **机制**：
  1. **状态定义**：
     * `HEALTHY`：正常。
     * `DEGRADED`：发生过 1 次 evaluate 超时并成功软中断。
     * `UNRESPONSIVE`：连续 $\ge 2$ 次超时、或 `terminateExecution` 失败、或 CDP 会话失联。
  2. **快速失败策略**：
     * 在 `ToolExecutionPipeline` 中，除以下白名单工具外，对 `UNRESPONSIVE` 页面直接抛出 `PAGE_UNRESPONSIVE (409)`：
       * 白名单工具：`reload_page`、`close_page`、`browser_disconnect`、`check_browser_health`。
  3. **健康检测工具**：
     * 新增/扩充 `check_browser_health` 工具，支持主动发送 300ms 超时的轻量探测（`1+1`）刷新健康状态。

### 3.3 建议 3：Job 取消增强与 Disconnect 幂等强平 (apiV1.ts / BrowserConnectionManager)

* **目标**：保证取消和断开请求绝对不会被底层悬挂的 Promise 阻塞。
* **机制**：
  1. **Force Cancel 语义**：
     * `/api/v1/jobs/:id/cancel` 提供 1000ms 的优雅等待窗口。若 1000ms 内 `current.execution` 未 settle，或者请求携带 `force=true`，直接从 `activeJob` 中解绑，并将 `JobStore` 置为 `cancelled`，解封 Worker。
  2. **Disconnect 幂等强平**：
     * `/api/v1/browser/disconnect` 时，同步将全部 active/pending jobs 标记为 `cancelled (BROWSER_DISCONNECTED)`。
     * 强行重置 `BrowserManager` 实例，Patchright 内部会自动 reject 掉所有尚未 settle 的 CDP 请求。

### 3.4 建议 4：Reconnect 健壮性与退避重试 (BrowserConnectionManager.connectBrowser)

* **目标**：消除断开重连过程中的 502 偶发故障。
* **机制**：
  1. 在 `connectBrowser` 引入 3 次指数退避重试（300ms $\rightarrow$ 600ms $\rightarrow$ 1200ms）。
  2. 在执行 `connectOverCDP` 前，调用 `waitForBrowserReady` 探测 `/json/version` 端点，确保 Target 列表已可访问后再进入 CDP 握手。

### 3.5 建议 5：CLI 构建发布一致性 (package.json / browsercli/)

* **目标**：避免本地全局 CLI 与 Worker 协议及能力脱节。
* **机制**：
  1. 根目录 `npm run build` 默认执行 `npm run build:cli`，确保 `browsercli/build` 同步生成。
  2. `browsercli` 在请求 `GET /api/v1/health` 时校验 capabilities，如遇缺少特定路由，输出清晰的升级指令提示。

### 3.6 建议 6：Skill 文档与 Schema 自动化比对 (scripts/verify-skills-schema.ts)

* **目标**：杜绝文档中手写命令参数产生的幻觉（如 `--target`, `--force`）。
* **机制**：
  1. 编写 `scripts/verify-skills-schema.ts` 脚本：
     * 正则解析 `skills/**/*.md` 中的 `browsercli call <toolName> [args...]`。
     * 动态加载 `src/tools/generated-tools-index.ts` 中的工具定义，利用 Zod Schema 做参数合法性校验。
     * 集成至 `npm test`，一旦文档参数错误，CI/测试立即报错。

---

## 4. 交付物与影响范围

| 模块 | 修改/新增文件 | 变更性质 |
| :--- | :--- | :--- |
| **超时与中断** | `src/worker/timeoutUtils.ts`<br>`src/worker/WorkerActivityCoordinator.ts` | 增加 CDP 级 `Runtime.terminateExecution` 与 Abort 联动 |
| **健康度追踪** | `src/worker/context/PageHealthTracker.ts` (新增)<br>`src/worker/ToolExecutionPipeline.ts`<br>`src/tools/page/checkBrowserHealth.ts` | 增加页面健康状态机与 0ms 快速失败 |
| **Job 与断开** | `src/web/routes/apiV1.ts`<br>`src/worker/BrowserConnectionManager.ts` | 增加 Force cancel 窗口，disconnect 强平释放 |
| **重连探针** | `src/worker/BrowserConnectionManager.ts` | 增加重试机制与 `waitForBrowserReady` |
| **CLI 联动** | `package.json`<br>`browsercli/src/WorkerHttpClient.ts` | 根构建联动与 capabilities 校验 |
| **文档校验** | `scripts/verify-skills-schema.ts` (新增)<br>`package.json` | 自动化扫描文档代码块与工具 Schema 比对 |

---

## 5. 验收标准

1. **主动中断验证**：对执行 `while(true){}` 的页面调用 `frame.evaluate`，10s 超时触发后，底层能够成功下发 `terminateExecution`，随后发起新的轻量 `evaluate` 能够正常响应，不再永久排队。
2. **快速失败验证**：页面连续 2 次超时被标记为 `UNRESPONSIVE` 后，调用 `get_hook_data` 等非恢复工具在 5ms 内立即返回 `PAGE_UNRESPONSIVE` 错误；调用 `reload_page` 能够正常执行并重置健康状态。
3. **取消不阻塞验证**：针对死锁 Job 发起 `POST /api/v1/jobs/:id/cancel?force=true`，接口在 1s 内立即响应，Worker 状态被成功解封。
4. **重连 502 消除**：连续执行 10 次 `disconnect` $\rightarrow$ `connect` 快速切换，成功率 100%，无 502 报错。
5. **Schema 校验脚本**：运行 `npm run verify-skills` 能准确识别出文档中非法的参数。
