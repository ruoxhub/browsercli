# Browser-CLI 连接与控制 Ego Lite 浏览器 (Ego-Bridge) 设计方案

## 1. 意图与背景 (Intent & Why)

### 背景
`browsercli` 是一个面向专业前端 JavaScript 逆向、动态 Hook 采样、网络抓包重放与反混淆的标准化工具系统（MCP Server + CLI）；
`ego lite` 则是一款专为人类与 AI Agent 协同设计的深度定制 Chromium 浏览器，具备多 Space 隔离、保留真实用户会话/Cookie、零配置免安全审批弹窗直连以及人机控制权流转（`handOff`）等能力。

### 核心诉求
用户希望将两者能力打通，通过 `browsercli` 控制与接管正在运行的 `ego lite` 浏览器，使现有的 100+ 专业逆向与自动化工具（如 JSVMP 探针、AST 还原、请求回溯、动态 Hook）能直接在用户真实登录的日常网页中生效，而无需重新配置登录态或面对反爬/审批阻碍。

---

## 2. 目标与非目标 (Goals, Non-Goals & Anti-Goals)

### 目标 (Goals)
1. **浏览器引擎无缝接入**：在 `browsercli` 的 `BrowserManager` 中新增对 `ego lite` 浏览器的适配支持（如通过命令行参数 `--browser ego` 或配置项指定）。
2. **零侵入标准 CDP 桥接**：利用 `ego-browser nodejs` 原生注入的 `globalThis.ego.sendCDPMessage` 与 `ego.onCDPMessage` 建立双向 WebSocket 桥接服务（`EgoCdpBridge`），暴露出标准的 CDP WebSocket 端点。
3. **100% 工具链兼容**：`browsercli` 底层基于 Patchright 的 `connectOverCDP` 直接连接该桥接端点，无缝使用现有的网络抓包、Hook 注入、DOM 交互、Cookie/Storage 快照等全量工具。
4. **生命周期与 Space 协同**：在桥接中规范管理 `TaskSpace`（任务空间），确保 Agent 仅在属于自己的 TaskSpace 内操作，并在任务交接与完成时正确遵循 ego 的所有权规范。

### 非目标 (Non-Goals)
1. 不修改 `ego lite` 的 C++ 源码、闭源客户端二进制或 Chromium 内核。
2. 不把 `browsercli` 繁重的 AST 转换器、Daemon 基础设施全量搬入 `ego-browser` 内部作为脚本运行。
3. 不破坏 `browsercli` 原有的独立 Patchright / CloakBrowser 启动模式（原有启动与反检测能力完全保持向后兼容）。

### 反目标 (Anti-Goals)
1. **严禁越界破坏用户个人 Space**：严禁在未经用户审批的情况下通过强制 Claim 篡改或清空用户非 Agent 的个人日常标签页和 Profile 全局 Cookie。
2. **严禁引入不可靠的死循环轮询**：桥接进程与 `browsercli` Daemon 必须具备优雅的握手、保活与自动退出机制，避免残留僵尸进程。

---

## 3. 技术路线与权衡 (Approaches Considered)

| 方案 | 架构说明 | 优势 | 劣势与放弃原因 |
| :--- | :--- | :--- | :--- |
| **方案 A：在 `browsercli` 增加 Ego Bridge 驱动（选定）** | `browsercli` 启动一个轻量级的 `ego-browser nodejs` 子进程作为本地 WebSocket CDP 桥接器，Patchright 通过 `connectOverCDP` 接入。 | 1. 100+ 逆向工具零修改直接复用；<br>2. 架构清晰，插件式扩展；<br>3. 保持原有反检测与无头环境兼容性。 | 需要管理一个轻量 Node 桥接子进程的生命周期。 |
| **方案 B：将 `browsercli` 工具重写移植进 `ego-browser`（已否决）** | 把 AST 分析、抓包重写、Daemon 体系塞入 `open-source/ego-lite/package/ego-browser` 内部。 | 单纯用 `ego-browser nodejs` 脚本即可调用所有 API。 | 1. 工程量极大，重复造轮子；<br>2. 破坏 `ego-browser` 的轻量定位；<br>3. 强绑定桌面客户端，失去无头环境能力。 |
| **方案 C：强制为 `ego.exe` 开启 `--remote-debugging-port`（已否决）** | 外部直接探测或强开 ego 的 TCP 调试端口。 | 纯原生 CDP，无需中继进程。 | 1. ego 默认不开放网络端口；<br>2. 开启网络端口会触发 Chromium 远程调试安全审批弹窗，破坏用户免审批直连体验。 |

**决策**：选定**方案 A**。

---

## 4. 详细系统架构与交互流程 (System Architecture)

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                 Browser-CLI 客户端与 MCP 工具层               │
│        (Network, Hook, Storage, DOM, JSVMP, AST...)         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│           BrowserManager (Patchright Core Engine)           │
│        chromium.connectOverCDP("ws://127.0.0.1:<port>/ego")  │
└──────────────────────────────┬──────────────────────────────┘
                               │  标准的 WebSocket CDP 协议
┌──────────────────────────────▼──────────────────────────────┐
│                  EgoCdpBridge (后台桥接进程)                 │
│      运行于: ego-browser nodejs ego-bridge-worker.mjs       │
│                                                             │
│  - WebSocket Server (接收标准 CDP 命令，返回 JSON 响应)        │
│  - 维持 TaskSpace 绑定 (ego.createTaskSpace / useTaskSpace) │
│  - 双向映射:                                                 │
│      ws.on('message') -> ego.sendCDPMessage(msg)            │
│      ego.onCDPMessage -> ws.send(msg)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │  Native Bindings (globalThis.ego)
┌──────────────────────────────▼──────────────────────────────┐
│              Ego Lite 宿主进程 (ego.exe Chromium)           │
│            (已登录会话、Agent TaskSpace、页面 Target)         │
└─────────────────────────────────────────────────────────────┘
```

### 关键组件职责与用户决策

1. **页面初始化与隔离模式（已确认）**：
   - **默认行为**：连接 `ego lite` 时，桥接层和 `BrowserManager` **始终在独立的 Agent TaskSpace 中创建全新专属标签页**（例如通过 `task.newPage()` 或复用专属的 `p1`），在此独立页面上执行所有的导航、抓包和 Hook 操作；
   - **非干扰保护**：绝不附着或接管用户当前正处于前台的活动标签页，保证用户的日常浏览与 Agent 的自动化/逆向工作互不干扰、并行运作。

2. **`EgoBridgeServer`（桥接核心脚本与协议垫片）**：
   - 使用 Node.js 原生 `node:http` 或轻量 WebSocket 在本地回环地址（`127.0.0.1`）监听一个动态空闲端口；
   - **CDP 协议垫片 (Polyfill)**：拦截外部连接发起的 `Browser.getVersion` 等浏览器全局指令，由桥接器主动合成并返回标准 Chromium 版本响应，彻底解决当前 Ego Lite 未开放 `Browser.*` 域导致 Patchright `connectOverCDP` 握手崩溃的问题；
   - **Target 虚拟防火墙 (Virtual Firewall)**：针对 Patchright 默认发送的 `Target.setAutoAttach`，在桥接层建立白名单过滤，只向上层广播属于当前 Agent TaskSpace 的标签页，物理隔绝用户私人标签页（如邮箱、个人后台等），彻底消除隐私泄露与误操作风险；
   - 在启动时初始化或复用带有命名哈希的 TaskSpace（如 `browsercli-<workspace-hash>`）；若检测到该 Space 已被用户夺权（ownership 为 `user`），自动安全递增后缀新建独立 Space，避免并发与命名冲突；
   - 监听 WebSocket 连接，将外部传入的 CDP 帧直接调用 `ego.sendCDPMessage`；将 `ego.onCDPMessage` 异步接收到的事件反向推送到 WebSocket 客户端；
   - 终端打印就绪标识：`[ego-bridge:ready] ws://127.0.0.1:<port>/devtools/browser/<guid>`。

3. **生命周期与清理策略（对齐 ego-browser 官方规范）**：
   - 参考 `open-source/ego-lite/package/ego-browser` 官方设计：
     - **默认正常退出**：执行 `await task.finish({ keep: [] })`，干净关闭 Agent 创建的临时标签页并销毁 TaskSpace，防止孤儿页面积聚；
     - **保留现场模式**：当传入 `--keep-page` 或用户显式要求保留时，执行 `await task.finish({ keep: "all" })`，将逆向分析标签页移交给用户（ownership 转为 `user`），完整保留网络断点与分析现场供人工复核；
     - **用户页面天然保护**：任何非 Agent 创建的用户原生标签页均受底层保护，`finish({ keep: [] })` 永远不会误关闭用户个人的任何页面。

4. **`EgoBrowserProvider`（集成到 `browsercli` 中）**：
   - 位于 `src/modules/browser/` 目录下；
   - 负责检测本地是否存在安装的 `ego lite` / `ego-browser.exe`；
   - 通过 `spawn` 启动桥接进程，解析 stdout 的就绪握手行；
   - 调用 `chromium.connectOverCDP(wsEndpoint)` 获取 `BrowserContext`，无缝挂接为 `BrowserManager` 的活动实例。

5. **CLI 与启动参数扩展**：
   - 在 `browsercli` 命令及配置文件中支持 `--browser=ego`；
   - 当设置 `--browser=ego` 时，自动跳过本地无头 Chrome 启动，改为唤起 Ego 桥接链路。

---

## 5. 约束与边界条件 (Constraints & Boundaries)

1. **Space 所有权守卫**：
   - 当用户在 ego 界面中手动点击接管（进入 User 控制状态）时，底层 `ego.sendCDPMessage` 会拒绝执行。桥接器需捕获 `ego.onSendCDPMessageError` 并以标准 CDP Error（如 `EGO_TASK_SPACE_INACTIVE`）规范返回，避免调用方挂死。
2. **生命周期自动回收**：
   - 当 `browsercli` 进程退出（SIGINT/SIGTERM/正常退出）时，自动通知并销毁 `EgoBridgeServer` 桥接子进程；
   - 桥接进程设置心跳与父进程保活探针，父进程断开时自我销毁，避免端口占用和泄漏。
3. **跨平台兼容**：
   - 优先支持 Windows 与 macOS（ego lite 目前支持的主流平台），自动解析默认安装路径下的 `ego-browser` 可执行文件。

---

## 6. 留给构建者的实现细节 (What's Left to the Builder)

1. **桥接脚本的宿主选型**：编写独立的自包含 `ego-bridge-worker.mjs`，通过 `ego-browser nodejs` 直接加载执行。
2. **SessionId 路由**：标准 CDP 在多标签页场景下依赖 `sessionId`（Flattened Target 模式），桥接器需确保传入的 `sessionId` 在 `ego.sendCDPMessage` 中被正确透明转发。
3. **单元测试与集成测试**：
   - 在无 real ego 实例时，提供 `FakeEgoBridge` 用于 CI 中的单元测试；
   - 编写连接检测与超时恢复的集成测试用例。
