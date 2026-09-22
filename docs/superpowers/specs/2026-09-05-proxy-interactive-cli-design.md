# Proxy 模块交互式终端 REPL 设计规范 (Proxy Interactive CLI Design Spec)

- **创建日期**：2026-09-05
- **状态**：Approved Specification
- **文档路径**：`docs/superpowers/specs/2026-09-05-proxy-interactive-cli-design.md`
- **模块归属**：`src/modules/proxy/`
- **主要作者**：Antigravity & User

---

## 1. 背景与业务目标 (Context & Goals)

### 1.1 背景

`src/modules/proxy`（以 `MitmModule` 为外观门面）现已具备完整的 HTTP/HTTPS MITM 抓包、CA 动态证书颁发、请求响应改写（Rewrite Engine）、主机黑白名单过滤（Host Filter）、SOCKS5 上游链路转发与本地进程流量关联能力。
然而，当前该能力主要面向 MCP 客户端及后台 Worker 自动化链路暴露，缺乏开发者在终端直接进行交互式抓包分析、实时日志监视、动态下发改写规则以及一键切换系统代理的轻量独立工作流。

### 1.2 核心目标 (Goals)

1. **开箱即用的 REPL**：支持通过 `browsercli proxy` 或 `npm run proxy:cli` 快速在当前进程启动代理并进入交互式命令行，无缝融入统一的 `browsercli` 命令行工具体系。
2. **极简高效与零外部依赖**：严格基于 Node.js 原生 `node:readline` 与标准 I/O 构建，遵循 KISS 与标准库优先（Ponytail）原则，无多余第三方重型 TUI 依赖。
3. **全功能命令覆盖**：提供对齐 `MitmModule` 底层能力的一站式交互指令，包括服务启停、实时流量流控（tail）、请求检索与报文详情、cURL 重放生成、改写规则配置、主机过滤、系统代理切换、HAR 导出与本地进程追踪。
4. **Prompt-Safe 非阻塞流式回显**：在开启实时流量监控（tail）时，异步到达的请求日志输出绝不打乱用户正在终端编辑的命令字符。
5. **系统代理四重安全退出门禁**：建立退出生命周期钩子，确保在任何异常、终止信号或正常退出时恢复宿主机系统代理，守住网络不中断的红线。
6. **高内聚可测性**：I/O 流解耦注入，提供完备的自动化单元测试（测试覆盖率达标，拒绝手工自嗨）。

### 1.3 非目标 (Non-Goals)

1. **不做全屏 TUI 复杂窗口分屏**：不引入 `blessed` / `ink` 等重型依赖，坚持原生行式 REPL 交互。
2. **不搞重复的数据存储**：直接复用底层 `ProxyStore` 既有的环形 FIFO 内存缓存，不另建二级存储。
3. **不替代 MCP 工具协议**：作为独立 CLI 调试工具并存，不改变既有 MCP Tool 接口与契约。

---

## 2. 系统架构与文件规划 (Architecture & File Layout)

### 2.1 文件组织结构

```text
src/modules/proxy/
├── BrowserCli.ts          # [新增] REPL 核心类：命令分发、补全、流控打印与状态机
├── cli.ts               # [新增] 独立可执行入口脚本：启动参数解析、信号监听与生命周期管控
├── MitmModule.ts        # [已有] MITM 抓包核心门面
├── index.ts             # [更新] 导出 BrowserCli 等核心类型
src/cli/commands/
└── proxy.ts             # [新增] browsercli proxy 子命令：桥接 browsercli 与 BrowserCli
src/cli/app.ts           # [更新] 注册 proxy 子命令
package.json             # [更新] 新增 "proxy:cli" 脚本
tests/unit/modules/proxy/
└── BrowserCli.test.ts     # [新增] BrowserCli 独立单元测试
```

### 2.2 模块职责划分

```text
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│       src/cli/commands/proxy.ts      │  │       src/modules/proxy/cli.ts       │
│  - 作为 browsercli proxy 子命令挂载    │  │  - 作为独立脚本运行 (npm run proxy:cli) │
│  - 解析命令行参数并启动 REPL 会话    │  │  - 注册退出清理拦截器与信号守卫       │
└──────────────────┬───────────────────┘  └──────────────────┬───────────────────┘
                   │                                         │
                   └────────────────────┬────────────────────┘
                                        │ 依赖注入 (MitmModule, stdin, stdout)
┌───────────────────────────────────────▼────────────────────────────────────────┐
│                        src/modules/proxy/BrowserCli.ts                           │
│  - 词法分词与命令分发器 (Tokenizer & Command Registry)                         │
│  - Tab 自动补全器 (Completer)                                                 │
│  - 终端安全日志输出 (Prompt-Safe Logger: \r\x1b[K + 恢复 Prompt)              │
│  - 会话交互状态机 (tailEnabled, selectedId, isPrompting)                      │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ 委托调用真实业务方法
┌───────────────────────────────────────▼────────────────────────────────────────┐
│                       src/modules/proxy/MitmModule.ts                          │
│  (startMitmProxy, stopMitmProxy, listMitmRequests, enableSystemProxy...)       │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 命令分词与语法规范 (Tokenizer & Lexer Grammar)

### 3.1 分词规则

1. **空白符分隔**：命令和参数之间以连续的空格或制表符分隔。
2. **引号长文本支持**：
   - 支持使用双引号 `"` 或单引号 `'` 包裹包含空格的参数（如 URL、JSON 响应体、Header 等）。
   - 引号内的字符原样提取，不按空格拆分。
   - 示例：`rule add mock "/api/v1/user info" 200 '{"status":"ok"}'` 准确切分为 5 个 Token。
3. **大小写无关性**：顶层命令名不区分大小写（`ls`、`LS` 均等效）。
4. **快捷别名映射 (Aliases)**：
   - `l` / `list` → `ls`
   - `s` → `show`
   - `c` → `curl`
   - `h` / `?` → `help`
   - `q` → `exit`

---

## 4. 详细命令契约与交互规格 (Command Specifications)

### 4.1 服务生命周期控制 (Server Lifecycle)

#### `start [port] [upstream]`

- **说明**：启动 MITM 代理服务。
- **参数**：
  - `port` (可选，整数，范围 1~65535，默认 8888)。
  - `upstream` (可选，SOCKS5 代理 URL，如 `socks5://127.0.0.1:1080`)。
- **回显**：成功后输出监听端口、上游状态及 CA 根证书路径；更新提示符为 `proxy[<port>]>`。
- **容错**：若代理已处于运行状态，输出黄色警告 `[WARN] Proxy is already running on port <port>. Use restart to change settings.`。

#### `stop`

- **说明**：停止代理服务并释放底层监听端口。
- **回显**：输出 `[INFO] Proxy stopped.`；提示符变更为 `proxy[stopped]>`。

#### `restart [port] [upstream]`

- **说明**：原子化顺序执行 `stop` 与 `start`，平滑重启服务。

#### `status`

- **说明**：输出当前代理系统状态仪表盘。
- **展示内容**：
  - 代理运行状态（RUNNING / STOPPED）
  - 监听地址与端口
  - 上游 SOCKS5 代理配置及连通性
  - 本地系统代理接管状态（ENABLED / DISABLED）
  - 内存已捕获请求数
  - 当前生效改写规则数
  - 当前主机过滤数（Allow / Block）
  - 靶向进程过滤配置

---

### 4.2 流量查看、详情与重放 (Traffic Inspection & Replay)

#### `tail [on|off]`

- **说明**：开启或关闭实时流量流控输出。
- **行为**：
  - 无参数时切换当前状态（Toggle）。
  - 开启后，新完成的请求在终端实时单行回显：
    `[#<id>] <status> <method> <url> (<duration>ms, <size>) [MODIFIED]`
  - 采用 ANSI 颜色渲染：2xx 绿色、3xx 蓝色、4xx 黄色、5xx 红色，改写请求附加品红色标签。
  - 必须由 Prompt-Safe 机制保障不冲散用户当前正在编辑的终端行。

#### `ls [limit] [filter]`

- **说明**：分页列出捕获的历史请求列表。
- **参数**：
  - `limit` (可选，整数，默认 15，硬上限 100)。
  - `filter` (可选，字符串，对 Host、Path 或 Method 进行不区分大小写的子串过滤)。
- **表格列定义**：
  `ID | METHOD | STATUS | DURATION | SIZE | URL`
  严格计算列宽并在超宽时优雅截断 URL，保留关键路径。

#### `show [id] [part]`

- **说明**：全量展开查看单条请求的完整报文。
- **参数**：
  - `id` (可选，默认为当前聚焦的 `selectedId` 或最新一条请求 `#latest`)。
  - `part` (可选，`all` | `req` | `res` | `headers` | `body`，默认 `all`)。
- **结构分段**：
  1. **General**：请求 ID、时间戳、耗时、协议、客户端 PID/进程名。
  2. **Request Headers**：标准键值排版。
  3. **Request Body**：支持 JSON 语法美化排版；非文本或超过 64KB 文本自动截断保护。
  4. **Response Headers**：包含 Cookie、Cache-Control 等关键信息。
  5. **Response Body**：自动处理解压后内容展示。

#### `curl [id]`

- **说明**：将指定请求转换为开箱即用的 Bash cURL 命令。
- **参数**：`id` (可选，默认当前/最新请求)。
- **实现细节**：复用既有的 `formatCurl` 与 `stripManagedHeaders`，安全剔除受管请求头，保留完整的 Method、URL、Headers 及 Body。

#### `clear`

- **说明**：清空内存中所有捕获的请求数据，重置计数器与 `selectedId`。

---

### 4.3 请求改写规则管理 (Rewrite Rules)

- `rule ls`：列表展示已生效规则（ID、类型、URL 匹配模式、动作描述）。
- `rule add mock <urlPattern> <status> [body]`：快速创建 Mock 响应规则。
- `rule add redirect <urlPattern> <targetUrl>`：快速创建 URL 重定向规则。
- `rule add header <urlPattern> <headerKey> <headerValue>`：快速创建 Header 注入/覆写规则。
- `rule rm <ruleId>`：精确移除指定 ID 的规则。
- `rule clear`：清空所有改写规则。

---

### 4.4 主机过滤白黑名单 (Host Filters)

- `filter ls`：打印当前的 Allow 与 Block 清单。
- `filter allow <hostPattern>`：加入白名单模式（支持通配符如 `*.target.com`），白名单外的流量直接旁路透传，大幅节省抓包资源。
- `filter block <hostPattern>`：加入黑名单模式（如忽略分析埋点、静态资源 CDN）。
- `filter rm <hostPattern>`：移除特定主机的过滤规则。
- `filter clear`：清空全部主机过滤规则。

---

### 4.5 系统代理与 CA 证书管控 (System Proxy & CA)

- `sysproxy on`：调用底层 `SystemProxyManager.enableProxy()`，一键设置系统代理为 `127.0.0.1:<port>`。
- `sysproxy off`：调用 `SystemProxyManager.restore()`，一键恢复直连。
- `sysproxy status`：显示系统代理当前设置状态。
- `ca path`：输出 `CaManager` 根证书（`ca.crt` / `ca.key`）的绝对路径，并输出当前操作系统（Win/macOS/Linux）的手工信任命令。
- `ca export [destDir]`：导出根证书文件到指定目录（方便传给移动端或沙箱）。

---

### 4.6 本地进程过滤与应用追踪 (Process Tracking)

- `proc ls`：列出当前正在与代理通信的本机进程列表（PID、进程名、TCP 连接数）。
- `proc target <name|PID>`：锁定仅抓取特定应用进程的流量。
- `proc clear`：取消进程过滤，恢复全系统捕获。

---

### 4.7 导出与通用辅助 (Export & Help)

- `har export [filePath]`：将当前会话请求导出为标准 HAR 1.2 规范文件（默认写入 `./artifacts/proxy-<timestamp>.har`）。
- `help [command]`：打印整体帮助卡片或具体命令的用法说明。
- `exit` / `quit` / `q`：终止 REPL 会话，触发清理逻辑优雅退出。

---

## 5. Tab 智能补全矩阵 (Autocomplete Matrix)

`BrowserCli.ts` 实现原生的 `readline.Completer` 回调：

```typescript
completer(line: string): [string[], string]
```

补全查找树规则如下：

| 用户当前输入行  | 触发 Tab 补全候选项                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 空字符串 / 空白 | 列出所有顶层核心命令 (`start`, `stop`, `status`, `ls`, `show`, `tail`, `rule`, `filter`, `sysproxy`, `ca`, `proc`, `har`, `curl`, `clear`, `help`, `exit`) |
| `st`            | `start`, `status`                                                                                                                                          |
| `s`             | `start`, `status`, `show`, `stop`, `sysproxy`                                                                                                              |
| `rule`          | `ls`, `add`, `rm`, `clear`                                                                                                                                 |
| `rule add`      | `mock`, `redirect`, `header`                                                                                                                               |
| `filter`        | `ls`, `allow`, `block`, `rm`, `clear`                                                                                                                      |
| `sysproxy`      | `on`, `off`, `status`                                                                                                                                      |
| `ca`            | `path`, `export`                                                                                                                                           |
| `proc`          | `ls`, `target`, `clear`                                                                                                                                    |
| `tail`          | `on`, `off`                                                                                                                                                |
| `show` / `curl` | 动态扫描当前 `ProxyStore` 中最新的 5 个请求 ID（形如 `#42`, `#41`），支持免手工输入 ID 补全                                                                |

---

## 6. 技术实现与核心机制 (Technical Implementation Details)

### 6.1 Prompt-Safe 非阻塞日志输出算法

当 `tail on` 活跃时，后台由 `onExchange` 事件触发新请求日志。为了不打乱用户正在键入的行：

```typescript
private safeLog(message: string): void {
  if (!this.rl) {
    this.output.write(message + '\n');
    return;
  }
  // 1. 获取当前输入行内容及光标位置
  const currentLine = this.rl.line;
  // 2. 清除当前终端行
  this.output.write('\r\x1b[K');
  // 3. 打印实时日志消息
  this.output.write(message + '\n');
  // 4. 重绘提示符与未完成的输入字符
  this.rl.prompt(true);
}
```

### 6.2 大报文防崩溃与截断保护

- 响应体类型检查：通过 `isBinaryContentType` 与 Magic Number 检测，对二进制内容输出 `[Binary: <size>, use har export]`。
- 文本长度限制：单次 `show` 打印文本正文最大阈值为 64KB，超出时输出截断警告并指引 `har export`。

### 6.3 四重系统代理退出恢复门禁

在 `src/modules/proxy/cli.ts` 与 `src/cli/commands/proxy.ts` 中注册进程事件：

```typescript
let isExiting = false;
async function cleanupAndExit(code = 0) {
  if (isExiting) return;
  isExiting = true;
  try {
    cli.close();
    await mitmModule.stopMitmProxy();
    await mitmModule.restoreSystemProxy();
  } catch (err) {
    // 强制兜底
  } finally {
    process.exit(code);
  }
}

process.on('SIGINT', () => cleanupAndExit(0));
process.on('SIGTERM', () => cleanupAndExit(0));
process.on('uncaughtException', err => {
  console.error('[FATAL]', err);
  cleanupAndExit(1);
});
process.on('exit', () => {
  void mitmModule.restoreSystemProxy();
});
```

### 6.4 单元测试隔离性设计

- `BrowserCli` 构造函数接收抽象接口：

  ```typescript
  constructor(
    private readonly module: MitmModule,
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  )
  ```

- 单元测试中使用 Node 内置 `PassThrough` 流作为虚拟终端，可编程式向 `input` 写入字符串并监听 `output` 捕获断言输出，完全避免对物理终端或全局环境的依赖。

---

## 7. 质量保障与验收标准 (Quality Gate & Verification)

1. **类型检查门禁**：运行 `npm run typecheck`，0 错误，TypeScript 严格模式通过。
2. **架构规则检查**：运行 `npm run check-arch`，Layer L1 与 L3 调用关系合规，0 环路。
3. **格式与 Lint 门禁**：运行 `npx eslint src/modules/proxy/ src/cli/`，符合 Prettier 与 ESLint 规范。
4. **单元测试门禁**：新增 `tests/unit/modules/proxy/BrowserCli.test.ts`，运行 `node --experimental-strip-types --test tests/unit/modules/proxy/BrowserCli.test.ts` 或编译后 `node --require ./build/tests/setup.js --test build/tests/unit/modules/proxy/BrowserCli.test.js`，涵盖：
   - 命令解析与 Tokenizer（双引号、单引号、空格、异常语法）
   - Tab 补全器（一级与二级命令联动）
   - 代理启停与状态切换（对齐 `MitmModule` API）
   - 规则与过滤器的增删查清
   - Prompt-Safe 流控打印输出
   - 优雅退出与资源清理
5. **端到端功能验证**：通过构建产物在终端环境中真实执行 `node build/src/cli/bin/browsercli.js proxy --no-auto-start` 及 `npm run proxy:cli -- --no-auto-start` 进行全流程冒烟测试。
