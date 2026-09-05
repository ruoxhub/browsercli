# Local Applications 进程级透明代理设计 Spec

- **日期**：2026-09-05
- **状态**：已获批准（经 4 轮需求对齐与 3 节架构/接口/UI 分段设计），待 writing-plans 拆解
- **上游参照**：`open-source/mitmproxy`（MIT License，Web UI `Modes/Local.tsx` 与 `LocalRedirector` 交互语义）
- **目标模块**：
  - `src/modules/proxy/SystemProxyManager.ts`（新建：系统代理生命周期与防断网兜底）
  - `src/modules/proxy/ProcessConnectionTracker.ts`（新建：活跃联网进程发现与端口反查 PID）
  - `src/modules/proxy/MitmModule.ts`（扩展：Local Applications 门面与配置持有）
  - `src/modules/proxy/MitmProxyServer.ts`（扩展：连接来源反查、智能分流透传与进程元数据注入）
  - `src/modules/proxy/types.ts`（扩展：类型定义）
  - `src/web/routes/proxy.ts`（扩展：进程列表与 Local Apps 配置 REST API）
  - `src/tools/proxy/`（新增：`mitm_list_local_processes.ts`、`mitm_configure_local_apps.ts`）
  - `src/web-ui/src/components/proxy/LocalAppsControl.tsx`（新建：对标 mitmproxy 的 Local Applications 控制组件）
  - `src/web-ui/src/components/proxy/ProxyControlBar.tsx`（扩展：无缝集成控制组件）
  - `src/web-ui/src/stores/proxy.ts`（扩展：Local Apps 状态与请求列表展示）

---

## 1. 背景与核心价值

当前 Reverser-CLI 的 MITM 代理已具备「HTTP/HTTPS 抓包、动态证书签发、在途改写（Rewrite）、HAR 导出、域名黑白名单过滤」能力，但仍属于**显式代理模式**（监听例如 8888 端口）。
逆向分析桌面客户端（如微信小程序/PC版、小红书桌面端、各类私有客户端、CLI 命令行工具）时存在两大痛点：

1. **需繁琐配置系统代理或应用代理**：不同应用设置代理入口分散，测试完易遗忘关闭导致断网；
2. **全局抓包噪声极大且易触发自签证书告警**：一旦开启系统代理，所有后台进程（系统更新、浏览器、后台服务）的大量流量涌入，既冲刷环形缓冲，又可能因自签 CA 证书被部分强校验应用拦截报错。

**上游参照**：mitmproxy web 提供了极其典雅的 `Local Applications (Transparently Intercept local application(s))` 功能，用户只需在前端勾选开关并下拉选择目标应用（如 `curl` 或 `wechat`），即可仅对该应用透明抓包，其余应用全无感。

**核心决策结论**：

1. **技术路线**：采用 **系统代理 + 连接端口进程溯源（GetExtendedTcpTable / netstat 增量缓存）**。纯 Node/用户态实现，无需 UAC 管理员提权，零重型内核驱动（对齐 KISS 与 Ponytail 准则）。
2. **非目标应用策略**：复用既有的 **Bypass TCP 盲转发 Tunnel**。非目标应用的 CONNECT 请求直接直连原端，不签发证书、不解密、不落库，保证其他应用正常上网且零证书报错。
3. **安全第一**：Node 进程生命周期钩子（`exit`, `SIGINT`, `SIGTERM`, `uncaughtException`）全覆盖强制还原代理，并在 Worker 启动初始化时自动自检并清理意外残留。
4. **元数据反哺**：捕获的 `CapturedExchange` 注入 `clientProcess: { pid, name, path }`，抓包列表与详情直观呈现来源进程。

---

## 2. 架构与数据流规范

### 2.1 模块架构图

```text
┌─────────────────────────────────────────────────────────────────┐
│                       Web UI / MCP Client                       │
│  [LocalAppsControl] 开关 | 目标进程 Chips | 下拉搜索进程 | 刷新   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP API / WS / MCP Tools
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                           MitmModule                            │
│  - 状态持有: LocalAppsConfig (enabled, targets, systemProxyActive)│
│  - 门面协同: SystemProxyManager, ProcessConnectionTracker        │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐ ┌───────────────────────────────┐
│     SystemProxyManager        │ │   ProcessConnectionTracker    │
│  - Windows 注册表读写与备份   │ │  - 活跃联网进程扫描 (Enum)   │
│  - WinINet 广播立即刷新生效   │ │  - 客户端 remotePort -> PID   │
│  - 退出信号兜底恢复原配置     │ │  - 短期 TTL 缓存与进程名匹配  │
└───────────────────────────────┘ └───────────────┬───────────────┘
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        MitmProxyServer                          │
│  - 拦截入口读取 clientSocket.remotePort -> Tracker 识别应用     │
│  - 智能透明分流:                                                │
│    ├── 命中目标应用 / 全选: 签证书解密 + 落库 (带 clientProcess)│
│    └── 非目标应用: TCP 盲转发 (Bypass Tunnel, 无证书告警)        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 详细交互与数据流

1. **开启拦截**：
   - 用户在 UI 勾选开关或调用 MCP 工具 `mitm_configure_local_apps({ enabled: true, targets: ['wechat.exe'] })`。
   - `MitmModule` 检查代理服务是否运行（若未运行则自动启动默认端口 8888）。
   - `SystemProxyManager.enable(port)`：
     - 读取 Windows 注册表备份当前原始代理配置；
     - 写入 `ProxyEnable = 1`, `ProxyServer = 127.0.0.1:<port>`；
     - 调用 WinINet `InternetSetOption` 广播刷新使系统及浏览器即刻生效；
     - 注册全局退出与未捕获异常监听器，确保退出时执行 `restore()`。
2. **流量进入与分流处理**：
   - 应用程序发起网络连接进入 `MitmProxyServer`，触发 `connect` 或 `request` 事件。
   - 提取 `remotePort = clientSocket.remotePort`。
   - `ProcessConnectionTracker.getProcessByPort(remotePort)` 从端口缓存或轻量查询中反查出发起方的 `{ pid, name, path }`。
   - **智能判定**：
     - 若 `targets.length === 0`（全选模式）：全量解密抓包；
     - 若 `targets.length > 0`：
       - 若 `targets` 包含该进程名称（不区分大小写，如 `wechat.exe`）：进入解密与规则改写链路，记录至 `ProxyStore`，并在 `exchange.clientProcess` 填入该应用信息；
       - 若 `targets` 不包含该进程：
         - 对于 HTTPS CONNECT 请求：立即走 `relayDirectConnect`（现有的 raw TCP pipe 盲转发），不签证书、不自解密、不落库，上游失败只销毁 socket 不报错；
         - 对于普通 HTTP 请求：直接正向透传转发，不存入 `ProxyStore`。
3. **关闭拦截**：
   - 用户关闭开关，或停止代理服务。
   - `SystemProxyManager.restore()` 将注册表还原为开启前的原始配置，并广播刷新。

---

## 3. 详细模块实现与接口规范

### 3.1 `SystemProxyManager`

文件路径：`src/modules/proxy/SystemProxyManager.ts`

```ts
export interface SystemProxyState {
  enabled: boolean;
  server: string;
  override: string;
}

export class SystemProxyManager {
  private originalState: SystemProxyState | null = null;
  private isHooked = false;
  private active = false;

  /**
   * 检查当前系统代理是否已指向目标端口（用于启动自检与清理残留）
   */
  async checkResidual(port: number): Promise<boolean>;

  /**
   * 启用系统代理
   */
  async enable(port: number): Promise<void>;

  /**
   * 还原系统代理到启用前的原始状态
   */
  async restore(): Promise<void>;

  /**
   * 是否正处于接管状态
   */
  isActive(): boolean;
}
```

**底层实现要点（Windows）**：

- 注册表路径：`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`
- 读取命令：`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable` 等
- 写入命令：
  - `reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`
  - `reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ /d "127.0.0.1:<port>" /f`
- 刷新通知（免重启）：通过内置小脚本或 PowerShell 调用 Win32 API：

  ```powershell
  $signature = @'
  [DllImport("wininet.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
  '@
  $wininet = Add-Type -MemberDefinition $signature -Name "WinInet" -Namespace "ProxyRefresh" -PassThru
  $wininet::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) # INTERNET_OPTION_SETTINGS_CHANGED
  $wininet::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) # INTERNET_OPTION_REFRESH
  ```

- **退出钩子**：
  在启用时注册：

  ```ts
  const cleanup = () => {
    try {
      this.restoreSync();
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(); });
  process.on('SIGTERM', () => { cleanup(); process.exit(); });
  process.on('uncaughtException', (err) => { cleanup(); throw err; });
  ```

### 3.2 `ProcessConnectionTracker`

文件路径：`src/modules/proxy/ProcessConnectionTracker.ts`

```ts
export interface ProcessInfo {
  pid: number;
  name: string;        // 如 "WeChat.exe"
  path?: string;       // 可执行文件完整路径
  displayName?: string;// 友好展示名称
}

export class ProcessConnectionTracker {
  private portToPidCache = new Map<number, { pid: number; timestamp: number }>();
  private pidToInfoCache = new Map<number, { info: ProcessInfo; timestamp: number }>();

  /**
   * 枚举当前具有活跃 TCP 网络连接的应用程序列表（排除代理自身 PID）
   */
  async listActiveNetworkProcesses(selfPid?: number): Promise<ProcessInfo[]>;

  /**
   * 根据客户端本地源端口反查发起请求的进程信息（带短期缓存与快速 fail-open）
   */
  async getProcessByPort(port: number): Promise<ProcessInfo | null>;

  /**
   * 刷新连接映射表缓存
   */
  async refresh(): Promise<void>;
}
```

**性能与可靠性考量**：

- 端口缓存 TTL：`1500ms`。短连接同一端口极少在 1.5s 内被不同进程复用；
- 进程名缓存 TTL：`30000ms`（30 秒）。PID 到可执行文件映射极少变动；
- 查询超时保护：调用 `netstat -ano -p tcp` 设置 `300ms` 超时；若查询超时或失败，直接返回 `null`（触发 fail-open 放行，确保绝不阻断或挂死网络连接）。

### 3.3 `MitmModule` & `MitmProxyServer` 扩展

**类型扩展 (`src/modules/proxy/types.ts`)**：

```ts
export interface ClientProcessMeta {
  pid: number;
  name: string;
  path?: string;
}

// 扩展 CapturedExchange
export interface CapturedExchange {
  // 现有字段保持不变
  // ...
  clientProcess?: ClientProcessMeta;
}

// Local Applications 配置与状态
export interface LocalAppsConfig {
  enabled: boolean;
  targets: string[];          // 空数组代表全部进程
  systemProxyActive: boolean;
}
```

**`MitmProxyServer` 分流逻辑**：

- 构造注入 `processTracker?: ProcessConnectionTracker` 与 `localAppsConfigProvider?: () => LocalAppsConfig`；
- 在 `handleConnect` 与 `handleHttpRequest` 首部：

  ```ts
  const config = this.localAppsConfigProvider?.();
  let clientProcess: ClientProcessMeta | undefined;
  if (config?.enabled) {
    const remotePort = clientSocket.remotePort;
    if (remotePort) {
      clientProcess = await this.processTracker?.getProcessByPort(remotePort) || undefined;
    }
    // 若配置了 targets，且此进程不在 targets 中，执行 bypass
    if (config.targets.length > 0) {
      const isTarget = clientProcess && config.targets.some(t =>
        t.toLowerCase() === clientProcess!.name.toLowerCase()
      );
      if (!isTarget) {
        // 非目标进程: 直接进入纯传输层盲转发 (保持原样)
        return this.relayDirectConnect(hostname, port, clientSocket, head);
      }
    }
  }
  ```

- 解密后落库时，将 `clientProcess` 注入到新构建的 `CapturedExchange` 中。

---

## 4. REST API 与 MCP 工具规范

### 4.1 REST API 契约 (`src/web/routes/proxy.ts`)

1. **`GET /api/proxy/processes`**
   - **描述**：获取当前所有正在发起或保持网络连接的本地应用列表。
   - **响应**：

     ```json
     {
       "success": true,
       "data": [
         { "pid": 14220, "name": "WeChat.exe", "displayName": "WeChat" },
         { "pid": 8940, "name": "msedge.exe", "displayName": "Microsoft Edge" }
       ]
     }
     ```

2. **`GET /api/proxy/local-apps`**
   - **描述**：获取 Local Applications 拦截配置与系统代理状态。
   - **响应**：

     ```json
     {
       "success": true,
       "data": {
         "enabled": true,
         "targets": ["WeChat.exe"],
         "systemProxyActive": true
       }
     }
     ```

3. **`POST /api/proxy/local-apps`**
   - **描述**：更新 Local Applications 拦截配置（开启/关闭系统代理、设置拦截应用目标）。
   - **请求体**：

     ```json
     {
       "enabled": true,
       "targets": ["WeChat.exe", "curl.exe"]
     }
     ```

   - **响应**：返回最新 `LocalAppsConfig`。

### 4.2 MCP 工具定义

1. **`mitm_list_local_processes`**：
   - 描述：列出当前正在联网的本地进程，辅助 AI 分析或用户选取逆向目标。
   - 参数：无
   - 返回：进程列表数组。
2. **`mitm_configure_local_apps`**：
   - 描述：配置 Local Applications 透明拦截模式，接管系统代理并限定抓包应用。
   - 参数：
     - `enabled` (boolean, 可选): 是否开启透明系统代理。
     - `targets` (string[], 可选): 拦截的目标进程名（如 `["wechat.exe"]`；留空代表拦截全部本地应用）。
   - 返回：操作结果与当前状态。

---

## 5. Web UI 界面与交互规范

### 5.1 组件结构与位置

在 `src/web-ui/src/components/proxy/` 新增 `LocalAppsControl.tsx`，嵌入在 `ProxyControlBar.tsx` 的运行状态与过滤输入框之间。

- **关闭状态**：
  - 显示复选框：`[ ] 拦截本地应用 (System Proxy)`；
  - 进程选择下拉框处于禁用灰色状态。
- **开启状态**：
  - 显示激活复选框：`[✓] 拦截本地应用`；
  - 伴随高亮状态标签：`[已接管系统代理]`；
  - 目标进程选择区域：
    - 若 `targets` 为空：显示 `[ 全部应用 v ]`；
    - 若 `targets` 包含应用：显示 `[ WeChat.exe × ]` `[ curl.exe × ]`，末尾带添加按钮；
  - 点击弹出 **ProcessPicker Popover**：
    - 顶部搜索框：支持快速模糊过滤进程名；
    - 支持手动输入任意自定义进程名并按回车直接添加；
    - 下方列表展示实时联网的应用程序，带 PID，单选/多选切换；
    - 右上角刷新图标 `[↻]`，触发重新扫描系统连接。

### 5.2 请求列表与详情的进程标签增强

1. **请求列表 (`ProxyRequestList.tsx`)**：
   - 在每个请求卡片的左侧/标题行，若包含 `exchange.clientProcess`，渲染精致的 Badge 标签：
     `[ 💬 WeChat.exe ]` 或 `[ 💻 curl.exe ]`。
2. **请求详情 (`ProxyRequestDetail.tsx`)**：
   - Overview 标签页增加 **Client Process** 卡片，展示发起端 PID、可执行文件完整路径及端口号。

---

## 6. 安全、异常与降级保护策略

1. **防断网最高优先级保障**：
   - 异常退出防护：利用 Node.js 全局事件钩子实现同步清理；
   - 启动残留自检：每次启动时，若检测到注册表代理指向 `127.0.0.1:<port>` 且上次未正常退出，主动将其恢复，彻底杜绝“关掉软件后浏览器打不开网页”的顽疾。
2. **连接性能 Fail-open 机制**：
   - 进程反查属于旁路观测，查询耗时超过 `300ms` 或异常时立刻降级返回 `null`，连接按目标或既有规则安全放行，绝对不导致 TCP 连接挂死或阻塞代理。
3. **系统权限与非 Windows 兼容**：
   - 在非 Windows 平台（macOS/Linux），如果未实现原生系统代理写入，API 优雅返回 `systemProxyUnsupported: true`，但依然支持通过手动配置代理后的“按进程名识别与过滤”功能。

---

## 7. 验证与测试计划

1. **单元测试 (`tests/unit/modules/proxy/`)**：
   - `SystemProxyManager.test.ts`：测试注册表解析、配置备份、状态还原及退出钩子注册；
   - `ProcessConnectionTracker.test.ts`：测试命令输出解析、TTL 缓存命中率及并发反查稳定性；
   - `MitmModuleLocalApps.test.ts`：测试开启/关闭 Local Applications 时的分流决策与状态同步。
2. **集成测试**：
   - 启动代理并配置 `targets: ['fake_test.exe']`；
   - 模拟本地客户端 socket 发起 CONNECT 请求：
     - 测试非目标端口：断言走 raw TCP tunnel 盲转发，无自签证书，`ProxyStore` 中无记录；
     - 测试模拟目标端口：断言正常解密，`CapturedExchange.clientProcess` 字段正确填入。
3. **Web UI 测试与格式检查**：
   - 运行 `npm run check-format`；
   - 运行 `npm run typecheck` 保证前后端 TypeScript 类型严格一致。
