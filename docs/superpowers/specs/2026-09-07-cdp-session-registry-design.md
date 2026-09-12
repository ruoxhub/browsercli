# CDP 会话隔离与泄露治理设计（方案 1：基于 Daemon Session 隔离）

日期：2026-09-07
状态：已批准（基于 2026-09-07 评审结论：放弃单进程 Registry 内存复合状态机方案 A，采纳基于原生 Daemon Session 的方案 1 物理进程隔离，并收敛散点 CDP 泄露）
范围决策：方案 1——利用现有 `workspaceHash × sessionName` 架构做多 Agent 物理隔离，清理无效死代码，并针对底层约 12 处未做 `detach` 的散点补齐自动释放。

---

## 1. 背景与核心决策

### 1.1 现状分析与原方案 A 缺陷

原设计（方案 A）试图在单个 Daemon 进程内构建 `CdpSessionRegistry`，以 `(agentId, page)` 为键维护内存级 Session 复用表。然而在深度代码审计后发现存在严重冲突与过度设计：

1. **CLI 命令短生命周期冲突**：`proxycli` 是单次命令独立执行即断开退出的短期进程。若每次生成随机 `agentId`，将破坏连续命令间的 `selectedPage` 状态；若手工透传或配置 `agentId`，则侵入了大量底层接口。
2. **长生命周期持有者事实偏差**：代码中仅 `DebuggerContextProvider` 具有跨调用持有 Session 的特性。原方案 A 将 `WasmCollector`、`CodeCollector` 误归类为长持有者并引入 `{ pinned: true }`、owner 校验、跳过 TTL 扫描等，造成了新的泄露风险与复杂度。
3. **并发限制**：单 Daemon 内部受限于 `rejectIfBusy` / `WORKER_BUSY`，同一时刻仅能串行执行工具调用，无法真正服务多 Agent 并发。

### 1.2 架构选择：方案 1（Daemon Session 隔离）

利用 proxycli 已有的会话架构（`src/cli/sessionPaths.ts` 及 `src/ipc/registry.ts`），天然支持多会话隔离：

- 每个 Agent 指定或继承自己的会话名：`proxycli -s <agent-name>` 或环境变量 `PROXYCLI_SESSION=<agent-name>`。
- 每个会话自动拥有一个独立的 Local Daemon 进程及本地命名管道（Named Pipe / Unix Domain Socket）。
- 各 Daemon 拥有专属的 `BrowserManager`、`ToolContextProvider`、`DebuggerManager` 与页面选择状态，**在 OS 进程级实现彻底隔离**。
- 天然支持多 Agent 并发调用，各 Agent 间零状态污染、零调试器互踩。

---

## 2. 治理目标

1. **多 Agent 强隔离**：明确并确立以 `--session` / `PROXYCLI_SESSION` 作为多 Agent 隔离的标准规范。
2. **消灭 CDP Session 泄露**：针对系统内约 12 处创建了 CDP Session 却未调用 `detach()` 的瞬态工具散点，补齐异常安全的自动释放逻辑。
3. **死代码清理**：移除零生产调用的 `SessionManager.ts` 及其测试，消除对会话隔离概念的历史误导。
4. **保持极致简单 (Ponytail / KISS)**：不新增庞大的 Registry 状态机、不改动 IPC 帧结构、不引入全局 TTL 扫描。

---

## 3. 详细设计

### 3.1 多 Agent 会话使用规范

- **单 Agent / 手动操作（默认）**：
  不传参数，默认使用 `default` 会话，与现状 100% 保持一致。
- **多 Agent 自动化场景（推荐）**：
  在子 Agent 启动环境或 Shell 中注入会话名：

  ```bash
  export PROXYCLI_SESSION="agent-${SUBAGENT_ID}"
  proxycli call select_page --index 0
  proxycli call click_element --selector "#btn"
  ```

  或者通过命令行显式指定：

  ```bash
  proxycli -s worker-1 call ...
  ```

- **共享单个物理 Chrome（可选资源优化）**：
  当多个 Agent 需轻量级共享同一浏览器实例时，启动主浏览器调试端口后，各 Agent 分别执行连接即可：

  ```bash
  proxycli -s agent-1 browser connect --browser-url http://127.0.0.1:9222
  proxycli -s agent-2 browser connect --browser-url http://127.0.0.1:9222
  ```

### 3.2 瞬态 CDP 会话辅助工具 `withCdpSession`

针对 `tools/input/*`、`tools/emulation/*`、`modules/collector/*` 等短时操作，提供统一的自动安全释放包装函数：

```ts
/**
 * src/modules/browser/cdpUtils.ts
 */
export async function withCdpSession<T>(
  page: Page,
  fn: (client: CDPSession) => Promise<T>,
): Promise<T> {
  const client = await page.context().newCDPSession(page);
  try {
    return await fn(client);
  } finally {
    try {
      await client.detach();
    } catch {
      // 忽略已关闭或 Target 销毁错误
    }
  }
}
```

### 3.3 散点泄露收敛清单

将下列原本直接 `await page.context().newCDPSession(page)` 且未执行 `detach()` 的瞬态调用收敛为 `withCdpSession`：

1. `src/tools/input/clickAt.ts:33`
2. `src/tools/input/setFiles.ts:34`
3. `src/tools/emulation/emulateCpu.ts:33`
4. `src/tools/emulation/emulateMobile.ts:114, 140`
5. `src/tools/emulation/emulateNetwork.ts:70`
6. `src/tools/navigation/navigatePage.ts:95`
7. `src/tools/stealth/stealth.ts:140`
8. `src/modules/collector/PageInteraction.ts:53, 103`
9. `src/modules/collector/PageInfo.ts:357`
10. `src/modules/stealth/StealthScripts2025.ts:620`

_白名单例外（保持现状）：_

- `DebuggerContextProvider.ts`：跨调用单例长生命周期，通过已有 `dispose(page)` 显式管理释放。
- `startPerformanceTrace.ts`：数据录制中持续跨调用流转，由 `stopPerformanceTrace` 显式 `detach`。
- `evaluateInPageRuntime.ts`：为保持专用无 Debugger 域环境，自建自卸，不走通用包装。
- `BrowserTargetInspector.ts`：基于 Target 拓扑构建。

### 3.4 清理死代码

- 删除文件：
  - `src/modules/browser/SessionManager.ts`
  - `tests/unit/browser/SessionManager.test.ts`
- 移除导出与失效注释：
  - `src/modules/browser/index.ts` 中的 `export {SessionManager} from './SessionManager.js';`
  - `src/modules/browser/browser.ts:47` 中的 `@see {@link src/browser/SessionManager.ts}` 注释引用。

---

## 4. 验证与回归计划

1. **类型安全验证**：`npm run typecheck` 零错误。
2. **单元测试回归**：
   - 移除 SessionManager 测试后，`npm run test:unit` 验证 CLI 会话测试（`sessionPaths.test.ts`、`sessions.test.ts`）以及各工具单元测试无意外中断。
   - 新增 `tests/unit/modules/browser/cdpUtils.test.ts`，验证 `withCdpSession` 的执行成功与异常抛出时均能确保 `detach()` 触发。
3. **格式与规范检查**：`npm run check-format`。
