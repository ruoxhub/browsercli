# CLI 调用工具完整流程

> 以 `js-reverse call list-network-requests` 为例，详细追踪从终端输入到工具执行的完整调用链。

## 架构概览

JSReverser-MCP 采用 **CLI + Daemon 双进程架构**，通过 Unix Socket（Linux/macOS）或 Named Pipe（Windows）进行 IPC 通信：

```
┌─────────────────────┐          ┌──────────────────────────────┐
│  CLI 进程            │          │  Daemon 进程                 │
│  (js-reverse)        │          │  (node daemon.js)           │
│                     │   IPC    │                              │
│  runAxiCli()        │◄────────►│  startSocketServer()         │
│    ↓                │  Socket  │    ↓                         │
│  toolDispatcher     │          │  handleRequest()              │
│    ↓                │          │    ↓                         │
│  sendCommand()      │          │  ensureToolsLoaded()          │
│    ↓                │          │    ↓                         │
│  successOutput()    │          │  tool.handler()              │
│                     │          │    ↓                         │
│                     │          │  browser.pages()              │
│                     │          │  networkCollector.getData()   │
└─────────────────────┘          └──────────────────────────────┘
                                          ↕
                                   Chrome DevTools
                                   Protocol (CDP)
```

## 完整调用链（9 步）

### ① CLI 入口 — 命令解析与路由

**文件**: `src/bin/js-reverse.ts`

```typescript
await runAxiCli<DaemonContext>({
  commands: {
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    call: toolDispatcherCommand,    // ← js-reverse call 走这里
    'call-skill': callSkillCommand,
    'list-skills': listSkillsCommand,
    'list-tools': listToolsCommand,
    repl: replCommand,
    scaffold: scaffoldCommand,
  },
});
```

`axi-sdk-js` 框架解析命令行参数，将 `call` 子命令路由到 `toolDispatcherCommand`。

### ② 参数解析与校验

**文件**: `src/cli/commands/tool-dispatcher.ts`

```typescript
export const toolDispatcherCommand: AxiCliCommand<DaemonContext> = async (args, _ctx) => {
  const parsed = parseArgs(args);
  const toolName = parsed.positionals[0];  // "list-network-requests"

  // 1. 校验工具名是否存在
  const meta = getToolMeta(toolName);
  if (!meta) {
    const suggestions = searchTools(toolName).map(t => t.name).slice(0, 5);
    throw new AxiError(`未知工具：${toolName}`, 'UNKNOWN_TOOL', suggestions);
  }

  // 2. CLI 字符串参数 → 工具参数类型转换
  const toolArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (typeof value === 'boolean') { toolArgs[key] = value; continue; }
    const schemaType = meta.schema[key];
    if (schemaType === 'number') toolArgs[key] = Number(value);
    else if (schemaType === 'boolean') toolArgs[key] = value === 'true';
    else if (typeof value === 'string' && value.includes(','))
      toolArgs[key] = value.split(',').map(s => s.trim());
    else toolArgs[key] = value;
  }
```

**关键逻辑**：
- `parseArgs(args)` — 解析位置参数和 `--flag value` 格式
- `getToolMeta(toolName)` — 从工具注册表查找 schema，用于参数类型推断
- 类型转换：`string` → `number` / `boolean` / `string[]`（逗号分隔自动拆分数组）
- 找不到工具时，`searchTools()` 提供模糊匹配建议（最多 5 个）

### ③ IPC 消息发送

**文件**: `src/daemon/client.ts` → `sendCommand()`

```typescript
const result = await sendCommand({
  method: 'invoke_tool',
  tool: toolName,                    // "list-network-requests"
  args: toolArgs,                    // { filter: "xhr", preserve: true }
});
```

`sendCommand()` 内部流程：

1. **Pre-flight 检查**：`checkDaemonReady()` — 检查 daemon 是否在运行
   - Linux/macOS：检查 socket 文件是否存在且为 socket 类型
   - Windows：检查 ready 标记文件
2. **创建 Socket 连接**：`createConnection(socketPath)`
3. **序列化并发送**：`socket.write(JSON.stringify(request) + '\0')`
   - 消息以 `\0`（null 字节）作为分隔符
4. **等待响应**：监听 `data` 事件累积响应，`end` 事件触发解析
5. **超时保护**：`socket.setTimeout(5000)` — 5 秒无响应则 reject

### ④ Daemon 接收消息

**文件**: `src/daemon/daemon.ts` → `PipeTransport` + `onmessage`

```typescript
server = createServer(socket => {
  const transport = new PipeTransport(socket, socket);
  transport.onmessage = async (message: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch (err) {
      transport.send(JSON.stringify({success: false, error: 'Invalid JSON'}));
      socket.end();
      return;
    }
    const response = await handleRequest(parsed as DaemonMessage);
    transport.send(JSON.stringify(response));
    socket.end();
  };
});
```

`PipeTransport` 是双向流式传输层，负责：
- 消息边界检测（基于 `\0` 分隔符）
- 自动分帧和重组
- 错误处理和连接管理

### ⑤ 请求路由分发

**文件**: `src/daemon/daemon.ts` → `handleRequest()`

```typescript
async function handleRequest(msg: DaemonMessage) {
  if (msg.method === 'invoke_tool') {
    const {tool, args = {}} = msg;
    // ...进入工具调用流程
  }
  if (msg.method === 'invoke_skill') { /* ... */ }
  if (msg.method === 'list_skills')   { /* ... */ }
  if (msg.method === 'list_tools')   { /* ... */ }
  if (msg.method === 'stop')         { /* ... */ }
  if (msg.method === 'status')       { /* ... */ }
}
```

IPC 协议支持 6 种方法：

| 方法 | 用途 | CLI 对应 |
|------|------|----------|
| `invoke_tool` | 调用单个 MCP 工具 | `js-reverse call <tool>` |
| `invoke_skill` | 调用逆向技能 | `js-reverse call-skill <skill>` |
| `list_tools` | 列出所有可用工具 | `js-reverse list-tools` |
| `list_skills` | 列出所有可用技能 | `js-reverse list-skills` |
| `stop` | 停止 daemon | `js-reverse stop` |
| `status` | 查看 daemon 状态 | `js-reverse status` |

### ⑥ 工具懒加载与浏览器上下文构造

**文件**: `src/daemon/daemon.ts` → `ensureToolsLoaded()` + context 构造

```typescript
// 懒加载：首次调用时才注册工具
async function ensureToolsLoaded(): Promise<void> {
  if (_toolsLoaded) return;
  if (_loadToolsPromise) return _loadToolsPromise;
  _loadToolsPromise = (async () => {
    const {registerBuiltInTools, listTools} = await import('../tools/index.js');
    registerBuiltInTools();
    _toolsLoaded = true;
    _cachedToolsList = listTools();
  })();
  return _loadToolsPromise;
}

// 查找目标工具
const tools = await getCachedTools();
const targetTool = tools.find(t => t.name === tool);

// 构造 context（浏览器操作的上下文对象）
const context = {
  getPages: () => cachedPages,
  getSelectedPage: () => runtime.browserManager.getCurrentPage(),
  getNetworkRequests: (includePreserved?: boolean) => {
    const page = runtime.browserManager.getCurrentPage();
    if (!page || !_networkCollector) return [];
    return _networkCollector.getData(page, includePreserved);
  },
  // ... 30+ 个上下文方法
};
```

**关键设计**：
- **懒加载**：工具注册不在 daemon 启动时完成，而是首次调用时 `import()` 动态加载
- **缓存**：`_cachedToolsList` 缓存工具列表，后续调用直接命中
- **上下文注入**：每个工具 handler 接收 `request`、`response`、`context`、`runtime` 四个参数
- **NetworkCollector**：daemon 级别初始化，绑定到浏览器实例，按页面隔离数据

### ⑦ 工具 Handler 执行

以 `list-network-requests` 为例：

**文件**: `src/tools/network.ts`

```typescript
// 工具定义（简化）
{
  name: 'list_network_requests',
  description: '列出当前页面的网络请求',
  schema: {
    filter: { type: 'string', description: '按类型过滤: xhr, fetch, document, script, stylesheet, image' },
    urlPattern: { type: 'string', description: 'URL 正则过滤' },
    preserve: { type: 'boolean', description: '是否保留已收集的数据（不清空）' },
  },
  handler: async (request, response, context, runtime) => {
    // handler 内部逻辑：
    // 1. 从 context 获取当前页面
    // 2. 从 NetworkCollector 获取请求数据
    // 3. 根据 filter/urlPattern 过滤
    // 4. 填充 response._lines 和 response flags
  }
}
```

Handler 通过 `context` 对象访问浏览器能力：
- `context.getSelectedPage()` — 获取当前活动页面
- `context.getNetworkRequests()` — 从 NetworkCollector 取数据
- `response.appendResponseLine()` — 追加文本输出
- `response.setIncludeNetworkRequests(true)` — 标记需要附带网络数据

### ⑧ 结果组装与返回

**文件**: `src/daemon/daemon.ts` → `handleRequest()` 返回值组装

```typescript
const resultData: any = {};
if (response._includePages) {
  // 附加页面信息：index, title, url, webSocketDebuggerUrl
  resultData.pages = pages.map((p, i) => ({ index: i, title: ..., url: ... }));
}
if (response._includeNetwork) {
  // 附加网络请求：id, url, method, type
  resultData.networkRequests = requests.map((req, idx) => ({
    id: idx, url: req.url(), method: req.method(), type: req.resourceType(),
  }));
}
if (response._lines.length > 0) {
  resultData.text = response._lines.join('\n');
}
if (response._structuredContent !== null) {
  Object.assign(resultData, response._structuredContent);
}

return { success: true, result: JSON.stringify(resultData) };
```

### ⑨ CLI 输出格式化

**文件**: `src/cli/commands/tool-dispatcher.ts` → `successOutput()`

```typescript
if (result.success) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.result as string);
  } catch {
    parsed = result.result || '执行成功';
  }
  return successOutput({
    command: 'call',
    tool: toolName,
    result: parsed,
  });
}
```

`successOutput()` 将结果格式化为 **TOON 格式**（axi-sdk-js 的表格输出格式）输出到终端。

---

## IPC 协议规范

### DaemonMessage（CLI → Daemon）

```typescript
interface DaemonMessage {
  method: 'invoke_tool' | 'invoke_skill' | 'list_skills' | 'list_tools' | 'stop' | 'status';
  tool?: string;                      // invoke_tool 时必填
  skill?: string;                     // invoke_skill 时必填
  args?: Record<string, unknown>;     // 工具/技能参数
}
```

### DaemonResponse（Daemon → CLI）

```typescript
interface DaemonResponse {
  success: boolean;
  result?: string;     // JSON 字符串，需要二次解析
  error?: string;      // 错误信息
  message?: string;    // 状态消息（如 "stopping"）
}
```

### 传输层

- **协议**: JSON + `\0` 分隔符
- **Linux/macOS**: Unix Domain Socket (`/tmp/js-reverse-daemon.sock`)
- **Windows**: Named Pipe (`\\.\pipe\js-reverse-daemon`)
- **超时**: 客户端 5 秒，daemon 无超时限制
- **连接模型**: 每次请求建立新连接，请求-响应模式

---

## 错误处理

| 场景 | 行为 | 用户提示 |
|------|------|----------|
| Daemon 未运行 | `checkDaemonReady()` 返回 false | `后台服务未运行。请先执行：js-reverse start --browserUrl <chrome-debug-url>` |
| 工具名不存在 | `tools.find()` 返回 undefined | `未知工具：xxx` + 模糊匹配建议 |
| 工具执行失败 | handler 抛出异常 | `工具执行失败：${error}` |
| IPC 超时 | 5 秒无响应 | `IPC 请求超时` |
| JSON 解析失败 | `JSON.parse()` 抛出 | `响应解析失败：${err}` |
| 浏览器未连接 | `runtime.browserManager.getBrowser()` 返回 null | 各工具 handler 内部处理 |

---

## 调用示例

### 基本调用

```bash
js-reverse call list-network-requests
```

### 带参数调用

```bash
# 过滤 XHR 请求
js-reverse call list-network-requests --filter xhr

# 过滤 URL 匹配的请求
js-reverse call list-network-requests --urlPattern "api\\.example\\.com"

# 保留已收集数据不清空
js-reverse call list-network-requests --preserve true
```

### 参数类型自动转换

```bash
# number 类型自动转换
js-reverse call get_network_request --id 3

# boolean 类型自动转换
js-reverse call click_element --selector "#btn" --doubleClick true

# 逗号分隔自动拆分为数组
js-reverse call some_tool --items "a,b,c"
# → args.items = ["a", "b", "c"]
```

---

## 完整时序图

```
User            CLI (js-reverse)            Daemon (daemon.ts)           Chrome
 │                   │                           │                        │
 │ call list-req     │                           │                        │
 │──────────────────►│                           │                        │
 │                   │ parseArgs()               │                        │
 │                   │ getToolMeta()             │                        │
 │                   │ type conversion            │                        │
 │                   │                           │                        │
 │                   │ sendCommand({             │                        │
 │                   │   method: "invoke_tool",  │                        │
 │                   │   tool: "list-network-req"│                        │
 │                   │   args: {...}             │                        │
 │                   │ })                        │                        │
 │                   │                           │                        │
 │                   │ ═══ socket.connect() ═══► │                        │
 │                   │                           │                        │
 │                   │                           │ PipeTransport           │
 │                   │                           │ .onmessage()            │
 │                   │                           │ JSON.parse()            │
 │                   │                           │                        │
 │                   │                           │ handleRequest()         │
 │                   │                           │   ↓                     │
 │                   │                           │ ensureToolsLoaded()     │
 │                   │                           │   ↓                     │
 │                   │                           │ getCachedTools()        │
 │                   │                           │   ↓                     │
 │                   │                           │ tools.find()            │
 │                   │                           │   ↓                     │
 │                   │                           │ browser.pages()  ◄─────┤ CDP
 │                   │                           │   ↓                     │
 │                   │                           │ targetTool.handler()    │
 │                   │                           │   ↓                     │
 │                   │                           │ NetworkCollector        │
 │                   │                           │   .getData()     ◄─────┤ CDP
 │                   │                           │   ↓                     │
 │                   │                           │ response assembly       │
 │                   │                           │   ↓                     │
 │                   │                           │ {success: true,         │
 │                   │                           │  result: JSON}          │
 │                   │                           │                        │
 │                   │ ◄═══ socket.end() ════════ │                        │
 │                   │                           │                        │
 │                   │ JSON.parse(result)         │                        │
 │                   │ successOutput()            │                        │
 │                   │                           │                        │
 │ TOON 格式输出     │                           │                        │
 │◄──────────────────│                           │                        │
```

---

## 相关文件索引

| 文件 | 职责 |
|------|------|
| `src/bin/js-reverse.ts` | CLI 入口，axi-sdk-js 命令注册 |
| `src/cli/commands/tool-dispatcher.ts` | `call` 命令处理：参数解析、类型转换、IPC 调用 |
| `src/cli/tools-meta.ts` | 工具元数据与 schema 定义 |
| `src/cli/args-parser.ts` | CLI 参数解析器 |
| `src/cli/output.ts` | TOON 格式化输出 |
| `src/daemon/client.ts` | IPC 客户端：`sendCommand()`, `startDaemon()`, `stopDaemon()` |
| `src/daemon/daemon.ts` | Daemon 主进程：socket 服务器、请求路由、工具调用 |
| `src/daemon/types.ts` | IPC 协议类型定义（DaemonMessage, DaemonResponse） |
| `src/daemon/utils.ts` | 工具函数：socket 路径、PID 管理、就绪检测 |
| `src/tools/network.ts` | `list_network_requests` 等网络工具实现 |
| `src/tools/runtime.ts` | JSHookRuntime 单例，浏览器管理器 |
| `src/tools/index.ts` | 工具注册入口（懒加载） |
| `src/PageCollector.ts` | NetworkCollector：网络请求数据收集器 |
| `src/third_party/index.ts` | PipeTransport：IPC 双向流式传输层 |