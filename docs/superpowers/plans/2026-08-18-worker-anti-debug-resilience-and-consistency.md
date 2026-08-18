# Worker 反调试卡死自愈与工程一致性实施计划 (Implementation Plan)

- **Spec 依据**: `docs/superpowers/specs/2026-08-18-worker-anti-debug-resilience-and-consistency-design.md`
- **目标**: 实现 CDP 级超时主动中断、页面健康度追踪与快速失败、Job 强平与幂等断开、重连退避探针、CLI 构建联动与 Skill 文档 Schema 校验。

---

## 阶段规划概览

| 阶段 | 涵盖模块 | 预估任务数 | 核心验证指标 |
| :--- | :--- | :--- | :--- |
| **Phase 1 (P0: 核心自愈)** | 超时中断 (`timeoutUtils.ts`) + Job 取消强平 (`apiV1.ts`) | 3 Tasks | 死锁 Job 取消不阻塞，超时打断 V8 执行 |
| **Phase 2 (P1: 快速感知)** | 页面健康追踪 (`PageHealthTracker.ts`) + 快速失败 + 重连健壮性 | 3 Tasks | 卡死页面 0ms 快速失败，重连 0 次 502 |
| **Phase 3 (P2: 工程闭环)** | CLI 构建联动 + Skill 文档 Schema 自动比对脚本 | 2 Tasks | 根目录联动编译，Skill 文档无幻觉参数 |

---

## Phase 1: 核心自愈机制（CDP 主动中断与 Job 强平）

### Task 1.1: `timeoutUtils.ts` 改造为 CDP 主动中断
- **目标**: 超时发生时，不仅 reject 本地 Promise，且下发 `Runtime.terminateExecution` 与 `Page.stopLoading`。
- **文件**:
  - `src/worker/timeoutUtils.ts`
  - `tests/unit/worker/timeoutUtils.test.ts`
- **实施要点**:
  - `wrapFrameWithTimeout` 接受可选的 Page 实例或 CDPSession 获取器。
  - 在 `setTimeout` 回调中，调用 `cdpSession.send('Runtime.terminateExecution').catch(...)`。
  - 导出 `terminateFrameExecution(frame: Frame): Promise<void>` 独立辅助函数。
- **验证**:
  - 单元测试模拟超时分支，验证 `terminateExecution` 被正确调用。

### Task 1.2: `WorkerActivityCoordinator.ts` 与 AbortSignal 深度集成
- **目标**: 当任务外部 `controller.abort()` 触发时，主动级联中断底层正在运行的 CDP 动作。
- **文件**:
  - `src/worker/WorkerActivityCoordinator.ts`
  - `tests/unit/worker/WorkerActivityCoordinator.test.ts`
- **实施要点**:
  - 完善 `raceWithAbort`，支持挂载 abort 时的销毁/中断回调。
- **验证**:
  - 单元测试验证 signal abort 后活跃 tool 计数立即递减。

### Task 1.3: `apiV1.ts` Job Cancel 与 Browser Disconnect 强平
- **目标**: 消除 `await current.execution` 导致的取消死锁，实现 1s 优雅超时强平。
- **文件**:
  - `src/web/routes/apiV1.ts`
  - `tests/unit/web/apiV1Jobs.test.ts`
- **实施要点**:
  - `/api/v1/jobs/:id/cancel` 引入 `Promise.race([current.execution, sleep(1000)])` 保护，超时或 `force=true` 立即解绑 `activeJob` 并标记 `jobStore.cancel`。
  - `/api/v1/browser/disconnect` 遍历未完成 Jobs 批量标记 `cancelled (BROWSER_DISCONNECTED)`，并在 1.5s 超时后强制 reset 实例。
- **验证**:
  - 运行 `npm run test:unit` 验证 Job 取消接口在未 resolve 时依然能 200/202 成功返回。

---

## Phase 2: 状态追踪与重连韧性（健康度追踪 + 快速失败 + 502 消除）

### Task 2.1: 实现 `PageHealthTracker` 状态机
- **目标**: 记录每个 Page 的连续超时次数与健康状态。
- **文件**:
  - `src/worker/context/PageHealthTracker.ts` (新增)
  - `src/worker/ToolContext.ts`
  - `tests/unit/worker/PageHealthTracker.test.ts` (新增)
- **实施要点**:
  - 维护 `Map<string, { status: PageHealthStatus; consecutiveTimeouts: number; lastError?: string }>`。
  - 提供 `recordSuccess(pageId)`, `recordTimeout(pageId)`, `isPageHealthy(pageId)` 等接口。
  - 连续 $\ge 2$ 次超时标记为 `UNRESPONSIVE`。

### Task 2.2: `ToolExecutionPipeline.ts` 集成 0ms 快速失败
- **目标**: 对 `UNRESPONSIVE` 页面的普通工具调用直接抛出 `PAGE_UNRESPONSIVE`，放行恢复类工具。
- **文件**:
  - `src/worker/ToolExecutionPipeline.ts`
  - `src/utils/errors.ts`
  - `tests/unit/worker/ToolExecutionPipeline.test.ts`
- **实施要点**:
  - 在 `validateAndPrepare` 后检查当前选定 Page 的健康状态。
  - 若为 `UNRESPONSIVE` 且工具不在恢复白名单（`reload_page`, `close_page`, `browser_disconnect`, `check_browser_health`），直接抛出 `createToolError(ErrorCodes.PAGE_UNRESPONSIVE, ...)`。

### Task 2.3: `BrowserConnectionManager.ts` 重连退避与就绪探测
- **目标**: 消除断开后立即重连时的 502 偶发故障。
- **文件**:
  - `src/worker/BrowserConnectionManager.ts`
  - `tests/unit/worker/BrowserConnectionManager.test.ts`
- **实施要点**:
  - 在 `connectBrowser` 引入 3 次指数退避重试循环（300ms, 600ms, 1200ms）。
  - 在调用 `BrowserManager.getInstance().ensureBrowser()` 之前，先调用 `waitForBrowserReady` 确保 DevTools 端口就绪。
- **验证**:
  - 单元/集成测试模拟连接抖动，验证重试逻辑生效。

---

## Phase 3: 工程一致性闭环（构建联动与 Skill Schema 校验）

### Task 3.1: 根目录构建联动与 CLI 能力探测
- **目标**: 构建主仓库时自动编译 `browsercli`，并在版本不匹配时给出升级指引。
- **文件**:
  - `package.json`
  - `scripts/post-build.ts`
  - `browsercli/src/WorkerHttpClient.ts`
- **实施要点**:
  - 在 `package.json` 中配置 `build:cli: "cd browsercli && npm run build"`，并加入 `npm run build` 流程。
  - `browsercli` 在请求时对比 Worker 版本，如遇 404/缺少路由输出 `Tip: 请运行 npm run build 重新编译`。

### Task 3.2: 编写 `scripts/verify-skills-schema.ts` 文档参数校验脚本
- **目标**: 自动化检查 `skills/**/*.md` 中的命令行参数合法性。
- **文件**:
  - `scripts/verify-skills-schema.ts` (新增)
  - `package.json` (加入 `npm run verify-skills`)
- **实施要点**:
  - 正则扫描 Markdown 代码块中的 `browsercli call <toolName> [args...]`。
  - 提取工具名与参数名，与 `src/tools/generated-tools-index.ts` 动态加载的 Zod Schema 比对。
  - 发现非法参数输出文件路径、行号与详细差异并非 0 退出。
- **验证**:
  - 运行 `node --experimental-strip-types scripts/verify-skills-schema.ts` 验证扫描结果。

---

## 最终验证与回归检查命令

```bash
# 1. 类型检查
npm run typecheck

# 2. 单元测试全量执行
npm run test:unit

# 3. 文档 Skill Schema 自动化比对
npm run verify-skills

# 4. 代码格式与规范检查
npm run check-format
```
