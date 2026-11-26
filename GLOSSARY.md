# BrowserCLI Context

面向浏览器逆向工程与自动化的守护进程和 CLI 工具链，基于 Patchright 提供持久化浏览器会话、页面级调试/Hook/抓包能力与结构化工具执行。

## Language

### Runtime Ownership

**DaemonSession**:
由工作区路径与会话名唯一标识的本地守护进程实例，通过命名管道或 Unix Socket 接收 CLI 的工具调用请求。
_Avoid_: Session, WorkerSession, MCP Server

**SessionContext**:
单次守护进程生命周期内的浏览器级聚合根，持有浏览器连接、隔离上下文、页表、并发调度与跨页复用资产。
_Avoid_: Runtime, ToolContextProvider, ServiceLocator, GlobalContext

**BrowserPage**:
单个浏览器标签页的领域聚合根，收敛该页专属的调试、监听、快照、网络拦截、单页捕获缓冲与健康状态，并随页面关闭统一释放。
_Avoid_: PageContext, ActivePage, SelectedPage

**PageHook**:
绑定于单个 `BrowserPage` 运行时的动态钩子，支持显式卸载以还原原函数，并随所属标签页关闭自动释放。
_Avoid_: FunctionHook, McpHook, RuntimeHook

**PersistentHook**:
绑定于浏览器上下文而非单个标签页的初始化注入钩子，在既有页面及后续新开弹窗或导航页面中持续生效，不因父页面关闭而销毁。
_Avoid_: GlobalHook, ContextHook

### Tool Model

**ToolScope**:
工具在类型层声明的运行边界，分为页级（绑定目标 `BrowserPage`）、浏览器级（操作跨页或连接状态）与无状态级（离线计算，不依赖浏览器连接）。
_Avoid_: CallMode, ToolType, ExecutionMode

**ToolManifest**:
在构建期从工具定义静态提取的纯数据清单，供 CLI 在不加载浏览器与逆向运行时依赖的前提下完成命令发现与参数解析。
_Avoid_: ToolsMeta, GeneratedIndex

**DeclarativeResponse**:
工具执行时只记录输出意图（如附加快照、网络明细、控制台摘要或结构化负载），由统一物化阶段集中查询、格式化并裁剪的响应契约。
_Avoid_: Accumulator, RawResult
