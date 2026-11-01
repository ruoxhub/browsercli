# Browser-CLI 连接与控制 Ego Lite 浏览器 (Ego-Bridge) 实施计划

> **状态说明 (DEPRECATED)**: 本实施计划对应的 ego 连接桥接层已于 2026-10 下线并彻底移除。详见 [ADR 0003: Remove Ego Bridge Layer](../../adr/0003-remove-ego-bridge-layer.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `browsercli` 能够通过轻量本地 WebSocket CDP 桥接连接并接管运行中的 `ego lite` 浏览器，使全部 100+ 逆向分析、动态 Hook 与抓包工具直接生效于真实用户会话，同时物理隔离用户日常标签页。

**Architecture:**

1. `browsercli` 在后台按需拉起 `ego-browser nodejs` 驱动的轻量桥接服务（`ego-bridge-worker.mjs`），维持独立的 Agent TaskSpace，并在桥接层内置 CDP 协议垫片（Polyfill）与 Target 虚拟防火墙；
2. 桥接服务暴露出标准的本地 WebSocket CDP 端点，`BrowserManager` 通过 Patchright 的 `chromium.connectOverCDP` 接入；
3. 遵循官方生命周期规范，默认正常退出时自动清理 TaskSpace（`finish({ keep: [] })`），支持通过 `--keep-page` 保留现场给用户。

**Tech Stack:** TypeScript, Node.js (>=20), Patchright, WebSocket (ws / native http), Chrome DevTools Protocol (CDP), `ego-browser` CLI & Native Bindings.

**Spec:** `docs/superpowers/specs/2026-10-28-browsercli-ego-bridge-design.md`

## Global Constraints

- 不修改 `ego lite` 的 C++ 源码、二进制与 Chromium 内核。
- 桥接进程必须在独立回环地址（`127.0.0.1`）监听，严禁对外暴露公共端口。
- 绝不接管或关闭非当前 Agent TaskSpace 创建的用户日常标签页。
- 桥接层必须主动垫平 `Browser.getVersion`，使 Patchright 建立连接的首步握手能够成功。
- 现有独立 Patchright / CloakBrowser 启动模式保持 100% 向后兼容。

## Review Focus

- 当 `ego.sendCDPMessage` 返回 `Browser.getVersion` not found 时，桥接层必须返回标准合法的 Chromium 版本结构体，避免 Patchright 握手直接报错。
- 当 Patchright 发送 `Target.setAutoAttach` 时，桥接层必须过滤非本 TaskSpace 的 Target 事件，防止用户私人标签页被广播进 `context.pages()`。
- 当用户在 Ego 界面点击接管夺权（TaskSpace 变为 `user`）时，桥接层应将 CDP 错误转换为标准 JSON-RPC 协议异常，避免死循环挂死。
- 当父进程意外崩溃或退出时，桥接子进程必须通过 stdin 探针与保活心跳在 3 秒内自我销毁，避免端口占用和僵尸进程残留。
- 默认退出时执行 `task.finish({ keep: [] })`，传入 `--keep-page` 时执行 `task.finish({ keep: "all" })`，严格尊重用户的保留现场偏好。

---

### Task 1: 桥接核心工作脚本与 CDP 垫片 (ego-bridge-worker.mjs)

**Files:**

- Create: `src/modules/browser/ego/ego-bridge-worker.mjs`
- Test: `tests/unit/browser/ego/ego-bridge-worker.test.ts`

**Interfaces:**

- Consumes: `globalThis.ego` (Ego Lite Native Bindings) 或通过 `ego-browser nodejs` 环境运行。
- Produces: 监听本地 HTTP/WebSocket 端口，向 stdout 输出格式为 `[ego-bridge:ready] ws://127.0.0.1:<port>/devtools/browser/<guid>` 的就绪字符串。支持处理标准 CDP 消息及 `Browser.getVersion` 拦截。

- [ ] **Step 1: 编写 bridge worker 消息拦截与协议垫片单元测试**

编写测试文件 `tests/unit/browser/ego/ego-bridge-worker.test.ts`，模拟注入 `FakeEgo` 对象，测试：

1. 拦截 `Browser.getVersion` 并返回标准 Chromium 版本对象；
2. 过滤非本 Space 的 `Target.attachedToTarget` 事件；
3. 透明透传带 `sessionId` 的普通 CDP 请求；
4. 退出信号触发 `task.finish({ keep: [] })`。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test -- tests/unit/browser/ego/ego-bridge-worker.test.ts`
预期：FAIL（文件尚不存在）。

- [ ] **Step 3: 实现 `src/modules/browser/ego/ego-bridge-worker.mjs`**

实现完整功能的轻量 worker 脚本：

- 创建原生 HTTP Server 并升级 WebSocket（使用内置协议或纯轻量 WS 解析）；
- 初始化 TaskSpace（`const task = await taskSpace("browsercli-" + hash)`）；
- 实现 CDP 消息路由器：拦截 `Browser.getVersion` 合成并回复响应；拦截 `Target.setAutoAttach` 维护 Target 白名单；将其他消息转发至 `ego.sendCDPMessage`；
- 监听 `ego.onCDPMessage`，仅放行白名单 Target 的事件推送；
- 监听父进程输入流 `process.stdin.on('close')` 触发优雅清理；
- 打印就绪行 `[ego-bridge:ready] ws://...`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test -- tests/unit/browser/ego/ego-bridge-worker.test.ts`
预期：PASS。

- [ ] **Step 5: 提交 Task 1 成果**

```bash
git add src/modules/browser/ego/ego-bridge-worker.mjs tests/unit/browser/ego/ego-bridge-worker.test.ts
git commit -m "feat(ego): add ego-bridge-worker with CDP polyfills and Target firewall"
```

---

### Task 2: Ego 桥接进程生命周期管理器 (EgoBridgeManager)

**Files:**

- Create: `src/modules/browser/ego/EgoBridgeManager.ts`
- Create: `src/modules/browser/ego/ego-detect.ts`
- Test: `tests/unit/browser/ego/EgoBridgeManager.test.ts`

**Interfaces:**

- Consumes: 操作系统文件系统（检测安装路径）、Node.js `child_process.spawn`。
- Produces: `class EgoBridgeManager`，提供 `start(options?: { keepPage?: boolean }): Promise<{ wsEndpoint: string }>` 和 `stop(): Promise<void>`。

- [ ] **Step 1: 编写 EgoBridgeManager 生命周期与路径探测单元测试**

编写测试文件 `tests/unit/browser/ego/EgoBridgeManager.test.ts`，验证：

1. `findEgoBrowserBinary()` 正确检索 Windows 默认安装目录（`C:\Program Files\Citro Labs\ego lite\Application\*\ego-browser.exe`）及 macOS 路径；
2. `start()` 正确启动子进程并解析 stdout 的 `[ego-bridge:ready]` 正则提取 `wsEndpoint`；
3. 超时或进程异常退出时抛出友好错误；
4. `stop()` 正确向子进程发送终止信号并等待回收。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test -- tests/unit/browser/ego/EgoBridgeManager.test.ts`
预期：FAIL（类与模块未定义）。

- [ ] **Step 3: 实现 `ego-detect.ts` 与 `EgoBridgeManager.ts`**

- `src/modules/browser/ego/ego-detect.ts`：实现跨平台的 `findEgoBrowserBinary(): string | null`；
- `src/modules/browser/ego/EgoBridgeManager.ts`：实现 `EgoBridgeManager` 类，管理子进程的拉起、端口等待 Promise、错误捕获及进程退出钩子（`process.on('exit')` 清理）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test -- tests/unit/browser/ego/EgoBridgeManager.test.ts`
预期：PASS。

- [ ] **Step 5: 提交 Task 2 成果**

```bash
git add src/modules/browser/ego/ego-detect.ts src/modules/browser/ego/EgoBridgeManager.ts tests/unit/browser/ego/EgoBridgeManager.test.ts
git commit -m "feat(ego): implement EgoBridgeManager process lifecycle and binary detector"
```

---

### Task 3: 改造 BrowserManager 与引擎连接层

**Files:**

- Modify: `src/types/browser.ts`
- Modify: `src/modules/browser/browser-helpers.ts`
- Modify: `src/modules/browser/browser.ts`
- Test: `tests/unit/browser/ego/ego-browser-manager.test.ts`

**Interfaces:**

- Consumes: `EgoBridgeManager`、`patchright.chromium.connectOverCDP`。
- Produces: `BrowserManager` 支持 `config.browser = 'ego'`，调用 `ensureBrowser()` 时通过 EgoBridge 接入并创建/管理独立专属 Page。

- [ ] **Step 1: 编写 BrowserManager 连接 Ego 模式单元测试**

编写测试 `tests/unit/browser/ego/ego-browser-manager.test.ts`，Mock `EgoBridgeManager` 与 `chromium.connectOverCDP`，验证：

1. 当配置为 `{ browser: 'ego' }` 时，启动 `EgoBridgeManager` 并获取 `wsEndpoint`；
2. 调用 `connectOverCDP(wsEndpoint)` 成功建立 Browser 与 BrowserContext；
3. 验证默认获取/创建的页面正确绑定到 `BrowserManager.activePage`；
4. 调用 `closeBrowser()` 时能联动触发 `EgoBridgeManager.stop()`。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test -- tests/unit/browser/ego/ego-browser-manager.test.ts`
预期：FAIL。

- [ ] **Step 3: 在 `BrowserManager` 中支持 Ego 模式**

- 在 `src/types/browser.ts` 中将 `'ego'` 扩充为合法的 `BrowserType` / `browser` 配置项；
- 在 `src/modules/browser/browser.ts` 的 `launchBrowser()` 中增加 `options.browser === 'ego'` 分支：
  - 调用 `EgoBridgeManager.getInstance().start()`；
  - 使用 `chromium.connectOverCDP(wsEndpoint)` 接入；
  - 确保将该 context 中的独立 Agent 页面设为主活动 Page；
  - 在 `closeBrowser()` 中调用 `EgoBridgeManager.stop()`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test -- tests/unit/browser/ego/ego-browser-manager.test.ts`
预期：PASS。

- [ ] **Step 5: 提交 Task 3 成果**

```bash
git add src/types/browser.ts src/modules/browser/browser.ts src/modules/browser/browser-helpers.ts tests/unit/browser/ego/ego-browser-manager.test.ts
git commit -m "feat(browser): add ego browser type support to BrowserManager via connectOverCDP"
```

---

### Task 4: CLI 参数与配置项透传 (`--browser ego` / `--keep-page`)

**Files:**

- Modify: `src/config/schema.ts`
- Modify: `src/cli/` 相关入口命令
- Test: `tests/unit/cli/browsercli-ego-args.test.ts`

**Interfaces:**

- Consumes: `yargs` CLI 选项配置与 Zod 配置校验。
- Produces: 用户可在终端通过 `browsercli --browser ego`、环境变量 `BROWSERCLI_BROWSER=ego`，以及 `browsercli close --keep-page` 控制行为。

- [ ] **Step 1: 编写 CLI 命令行参数解析测试**

编写测试 `tests/unit/cli/browsercli-ego-args.test.ts`，测试：

1. 传入 `--browser ego` 时正确解析为 `browser: 'ego'`；
2. 环境变量 `BROWSERCLI_BROWSER=ego` 生效；
3. `close` 命令接收 `--keep-page` 标志并透传。

- [ ] **Step 2: 运行测试验证失败**

运行：`npm test -- tests/unit/cli/browsercli-ego-args.test.ts`
预期：FAIL。

- [ ] **Step 3: 在配置模式与 CLI 参数中增加支持**

- 在 `src/config/schema.ts` 中放宽 `browser` 枚举以允许 `'ego'`；
- 在 CLI 启动选项中添加 `--browser` 候选值及 `--keep-page` 选项，透传给 `BrowserManagerConfig`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npm test -- tests/unit/cli/browsercli-ego-args.test.ts`
预期：PASS。

- [ ] **Step 5: 提交 Task 4 成果**

```bash
git add src/config/schema.ts src/cli/ tests/unit/cli/browsercli-ego-args.test.ts
git commit -m "feat(cli): support --browser ego and --keep-page flags"
```

---

### Task 5: 全链路端到端真机集成与逆向工具验证

**Files:**

- Create: `tests/integration/ego-bridge.integration.test.ts`

**Interfaces:**

- Consumes: 完整的 `browsercli` 运行时、运行中的 `ego lite` 真实浏览器（或本地自动化环境）。
- Produces: 验证一套完整的逆向工作流（打开网页 -> 动态 Hook 采样 -> 网络抓包 -> 提取 Storage -> 退出清理）。

- [ ] **Step 1: 编写真机/环境 E2E 集成测试**

在 `tests/integration/ego-bridge.integration.test.ts` 中：

1. 启动 `browsercli` 并指定 `browser: 'ego'`；
2. 检查连接成功建立，且活动页面为独立新建的 Agent 页面；
3. 执行页面导航到测试 HTML（`page.goto("http://127.0.0.1:...")`）；
4. 使用 `browsercli` 的核心工具（如 `inject_hook` 拦截特定函数、提取 Cookie 快照）；
5. 验证执行 `close` 并确认 TaskSpace 优雅退出。

- [ ] **Step 2: 执行全量单元测试与集成测试验证**

运行：`npm run typecheck && npm run test:unit`
预期：所有现有测试和新增单元测试 100% PASS。

- [ ] **Step 3: 运行真机集成测试**

运行：`node --require ./build/tests/setup.js --test build/tests/integration/ego-bridge.integration.test.js`
预期：PASS。

- [ ] **Step 4: 提交 Task 5 与构建产物**

```bash
git add tests/integration/ego-bridge.integration.test.ts
git commit -m "test(ego): add end-to-end integration test for ego bridge workflow"
```
