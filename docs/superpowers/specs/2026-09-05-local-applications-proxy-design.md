# Local Applications 进程级透明代理设计 Spec

- **日期**：2026-09-05
- **状态**：已实施（plan: docs/superpowers/plans/2026-09-05-local-applications-proxy.md）。经 4 轮需求对齐与 3 节架构/接口/UI 分段设计，2026-09-05 评审修订并全量交付。
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

1. **技术路线**：采用 **系统代理 + 连接端口进程溯源（后台周期刷新连接表 + netstat/GetExtendedTcpTable）**。纯 Node/用户态实现，无需 UAC 管理员提权，零重型内核驱动（对齐 KISS 与 Ponytail 准则）。**连接表获取方式**：实现层优先尝试 PowerShell 调 `GetExtendedTcpTable`，失败或不可用时降级 `netstat -ano -p tcp`（两者输出统一解析为连接表）；spec 层面只约定「后台周期刷新 + 内存查询」契约，不锁定具体枚举命令。
2. **非目标应用策略**：复用既有的 **Bypass TCP 盲转发 Tunnel**。非目标应用的 CONNECT 请求直接走既有 bypass 链路（含上游 SOCKS5 分支）：有上游代理时经 SOCKS5 隧道转发，无上游时直连原端；不签发证书、不解密、不落库，保证其他应用正常上网且零证书报错。
3. **安全第一**：Node 进程 `'exit'` / `'uncaughtException'` 生命周期钩子强制同步还原代理（`spawnSync`），并在 Worker 启动初始化时自动自检并清理意外残留。信号处理交给 worker 既有关停流程，代理还原经由其 `process.exit()` 触发的 `'exit'` 事件兜底（详见 §3.1，避免与 `daemonMain.ts` 已注册的 SIGINT/SIGTERM 处理器冲突）。
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
   - `ProcessConnectionTracker.getProcessByPortSync(remotePort)` 从后台周期维护的连接表中同步反查出发起方的 `{ pid, name, path }`。
   - **智能判定**：
     - 若 `targets.length === 0`（全选模式）：全量解密抓包；
     - 若 `targets.length > 0`：
       - 若 `targets` 包含该进程名称（不区分大小写，如 `wechat.exe`）：进入解密与规则改写链路，记录至 `ProxyStore`，并在 `exchange.clientProcess` 填入该应用信息；
       - 若 `targets` 不包含该进程：
         - 对于 HTTPS CONNECT 请求：立即走 `relayDirectConnect`（从现有 bypass 分支提取的 raw TCP pipe 盲转发，含上游 SOCKS5 分支），不签证书、不自解密、不落库，上游失败只销毁 socket 不报错；
         - 对于普通 HTTP 请求：直接正向透传转发，不存入 `ProxyStore`。
3. **关闭拦截**：
   - 用户关闭开关，或停止代理服务。
   - `SystemProxyManager.restore()` 将注册表还原为开启前的原始配置，并广播刷新。

---

## 3. 详细模块实现与接口规范

### 3.1 `SystemProxyManager`

文件路径：`src/modules/proxy/SystemProxyManager.ts`

> **与 2026-08-26 spec 的关系**：`docs/superpowers/specs/2026-08-26-anything-analyzer-migration-design.md` §7.1 曾规划同一文件的 `setSystemProxy()` / `restoreSystemProxy()` / `registerCleanupGuards()` 接口（至今未交付，代码库无任何实现痕迹）。本 spec 的接口**替代**该规划；那边的 `proxy_set_system` 工具若后续交付，必须复用本模块而非另建。老 spec §7.1 的跨平台还原矩阵（Windows 三项 / macOS 按网卡 / GNOME mode）作为本模块的兼容性参考保留，但本版仅交付 Windows 实现，其余平台走 §6.3 的降级路径。

```ts
export interface SystemProxyState {
  enabled: boolean; // ProxyEnable
  server: string; // ProxyServer（备份原值，可能为空）
  override: string; // ProxyOverride（备份原值，可能为空）
  autoConfigUrl: string; // AutoConfigURL（PAC，备份原值，可能为空）
}

export class SystemProxyManager {
  private originalState: SystemProxyState | null = null;
  private isHooked = false;
  private active = false;

  /**
   * 启动自检：判定当前注册表代理是否为本工具残留并清理（marker 规则见 §6）。
   * 判定条件仅为「marker 键存在」——marker 值中存有原始状态快照，
   * 与端口是否匹配无关（避免上次用非默认端口崩溃后无法清理）。
   * 无 marker 视为用户/其他工具配置，不触碰。
   */
  async checkResidual(): Promise<boolean>;

  /**
   * 启用系统代理：备份四项原始值（含 ProxyOverride 与 AutoConfigURL）后写入。
   */
  async enable(port: number): Promise<void>;

  /**
   * 还原系统代理到启用前的原始状态（异步，UI/REST 主动关闭路径使用）。
   * 原子还原四项：ProxyEnable / ProxyServer / ProxyOverride / AutoConfigURL，
   * 任一遗漏都会导致「代理半关」（PAC 残留或 loopback 回环）。
   */
  async restore(): Promise<void>;

  /**
   * 同步还原系统代理（spawnSync reg.exe）。专用于退出钩子：
   * process.on('exit') 时事件循环已停，async restore 的 reg 子进程会被截断，
   * 必须用 spawnSync 立即完成注册表写入与广播刷新。
   */
  restoreSync(): void;

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
  - `reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.0.0.1;<-loopback>" /f`（`<-loopback>` 为系统支持的 loopback 通配写法，防止本机 localhost 流量回环进代理自身；原 override 值已备份，还原时回写）
  - `AutoConfigURL` 若原值非空则置空（备份后还原时回写，避免 PAC 与手动代理叠加生效）
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
  **只注册 `'exit'` 与 `'uncaughtException'`，不注册 SIGINT/SIGTERM。**
  `daemonMain.ts:228-235` 已注册信号处理器（`stop()` → `gracefulShutdown` → `process.exit()`）；
  后注册的同名信号监听器会与先注册者叠加执行，若在本模块钩子里直接 `process.exit()`，
  会绕过 worker 的正常关停流程。而 `process.exit()` 会触发 `'exit'` 事件，
  `restoreSync()` 依然兜底执行——链路完整且零冲突。

  在启用时注册：

  ```ts
  const cleanup = () => {
    try {
      this.restoreSync();
    } catch {}
  };
  process.on('exit', cleanup);
  process.on('uncaughtException', err => {
    cleanup();
    throw err;
  });
  ```

### 3.2 `ProcessConnectionTracker`

文件路径：`src/modules/proxy/ProcessConnectionTracker.ts`

```ts
export interface ProcessInfo {
  pid: number;
  name: string; // 如 "WeChat.exe"
  path?: string; // 可执行文件完整路径
  displayName?: string; // 友好展示名称
}

export class ProcessConnectionTracker {
  private portToPidCache = new Map<number, {pid: number; timestamp: number}>();
  private pidToInfoCache = new Map<
    number,
    {info: ProcessInfo; timestamp: number}
  >();

  /**
   * 枚举当前具有活跃 TCP 网络连接的应用程序列表（排除代理自身 PID）
   */
  async listActiveNetworkProcesses(selfPid?: number): Promise<ProcessInfo[]>;

  /**
   * 根据客户端本地源端口反查发起请求的进程信息（同步内存查询，见下方性能模型）
   */
  getProcessByPortSync(port: number): ProcessInfo | null;

  /**
   * 拉取全量连接表并重建映射缓存（由 MitmModule 的后台定时器周期调用，
   * 也可由 UI 刷新按钮触发）
   */
  async refresh(): Promise<void>;

  /**
   * 启动/停止后台周期刷新（Local Apps 开启时 start，关闭时 stop）
   */
  startBackgroundRefresh(intervalMs?: number): void;
  stopBackgroundRefresh(): void;
}
```

**性能与可靠性考量**：

- **核心设计：后台周期刷新，连接时仅查内存**。每个新 TCP 连接的源端口都是新的，
  若在分流路径上按需调用 netstat（同步子进程，单次可达数百 ms），高连接数机器上会大面积超时。
  因此 `MitmModule` 在 Local Apps 开启时启动后台定时器，每 **500ms** 调用一次 `refresh()`，
  将全量连接表拉取进 `portToPidCache`；`getProcessByPortSync()` 只做内存 Map 查询（微秒级），
  **绝不 fork 子进程**。Local Apps 关闭时停止定时器。
- 连接表获取命令：优先 PowerShell 调 `GetExtendedTcpTable`（结构化、无本地化差异），
  不可用时降级 `netstat -ano -p tcp`（注意解析需容忍本地化输出）。
- 端口表时效性：条目附带 `timestamp`，查询时若条目年龄超过 **1500ms**（即连续 2 次刷新都未见到该连接）
  视为过期返回 `null`，避免已关闭连接的误匹配。
- 进程名缓存 TTL：`30000ms`（30 秒）。PID 到可执行文件映射极少变动。
- **查询失败/未命中统一返回 `null`**，由调用方按 §3.3 规则处理（配置了 targets 时按非目标盲转发，未配置时放行解密），确保绝不阻断或挂死网络连接。

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
  targets: string[]; // 空数组代表全部进程
  systemProxyActive: boolean;
}
```

**列表透传契约（P1，必须一并交付）**：UI 请求列表要渲染进程 Badge，但列表 API 返回的
`MitmRequestSummary`（`types.ts:209`）目前不含 `clientProcess`。需同步扩展整条透传链：
`CapturedExchange.clientProcess` → `ProxyStore` 摘要 → `MitmRequestSummary.clientProcess?: {pid, name}`
（仅 name/pid，不含 path，减小列表负载）→ REST `/api/proxy/requests` 响应 → UI。
`getMitmRequest` 详情接口返回完整 `clientProcess`（含 path）。

**`MitmProxyServer` 分流逻辑**：

- 构造注入 `processTracker?: ProcessConnectionTracker` 与 `localAppsConfigProvider?: () => LocalAppsConfig`；
- **前置重构**：将现有 `handleConnect` 中的 bypass 分支（`MitmProxyServer.ts:455-490`，含 SOCKS5 上游子分支）
  提取为私有方法 `private relayDirectConnect(hostname: string, port: number, clientSocket: net.Socket, head: Buffer): void`，
  既有 hostname bypass 与本节进程分流**复用同一方法**。当前代码库中不存在此方法，spec 中的调用均指提取后的新方法。
- 在 `handleConnect` 与 `handleHttpRequest` 首部插入分流判定。
  注意：`handleHttpRequest` 的签名是 `(req, res)`，源端口取 `req.socket.remotePort`（不是 `clientSocket.remotePort`）；
  `handleConnect` 取 `clientSocket.remotePort`。

  ```ts
  const config = this.localAppsConfigProvider?.();
  let clientProcess: ClientProcessMeta | undefined;
  if (config?.enabled) {
    const remotePort = /* handleConnect: clientSocket.remotePort; handleHttpRequest: req.socket.remotePort */;
    if (remotePort) {
      // 纯内存查询（§3.2 后台刷新模型），无子进程开销
      clientProcess =
        (this.processTracker?.getProcessByPortSync(remotePort)) || undefined;
    }
    // 若配置了 targets，且此进程不在 targets 中，执行 bypass
    if (config.targets.length > 0) {
      const isTarget =
        clientProcess != null &&
        config.targets.some(t => matchesProcessName(t, clientProcess!.name));
      if (!isTarget) {
        // 非目标进程（含反查失败）：进入纯传输层盲转发。
        // 必须走 relayDirectConnect（含上游 SOCKS5 分支），不得直接 net.connect 直连——
        // 配置了上游代理的场景下直连会绕过上游，导致境外流量全部中断。
        return this.relayDirectConnect(hostname, port, clientSocket, head);
      }
    }
  }
  ```

- **反查失败的分流语义（fail-open 的确切含义）**：`getProcessByPortSync` 返回 `null` 时——
  - 配置了 `targets`：按**非目标进程**处理（盲转发，不签证书）。权衡：误签证书对强校验应用
    造成可见报错且影响面大；漏抓仅影响目标应用自身，可重试或调整 targets。
  - 未配置 `targets`（全选模式）：放行进入正常解密链路。
- **进程名匹配语义**：`matchesProcessName(target, name)` 为**不区分大小写的可执行文件 basename
  精确匹配**；输入无扩展名时自动补 `.exe`（即 `wechat` 命中 `WeChat.exe`），带路径的输入取 basename 后匹配。
- **时序约定（避免各写各的）**：分流判定必须在写入 `200 Connection Established` **之前**完成
  （现有 bypass 分支同此模式，见 `MitmProxyServer.ts:455` 后的写法）；由于查询为纯内存同步操作，
  判定本身不引入可感知延迟，无需 pause socket。
- 解密后落库时，将 `clientProcess` 注入到新构建的 `CapturedExchange` 中。

---

## 4. REST API 与 MCP 工具规范

### 4.1 REST API 契约 (`src/web/routes/proxy.ts`)

1. **`GET /api/proxy/processes`**
   - **描述**：获取当前所有正在发起或保持网络连接的本地应用列表。
   - **安全前提**：该接口暴露进程名/PID/可执行路径，仅限 web console 默认回环绑定
     （`ConsoleServer.ts` 默认 `127.0.0.1`）下使用；若用户自行改绑 0.0.0.0，需自行承担信息暴露风险（与本接口无特别鉴权的设计一致，维持现状不新增鉴权）。
   - **响应**：

     ```json
     {
       "success": true,
       "data": [
         {"pid": 14220, "name": "WeChat.exe", "displayName": "WeChat"},
         {"pid": 8940, "name": "msedge.exe", "displayName": "Microsoft Edge"}
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
   - 异常退出防护：利用 Node.js 全局事件钩子实现**同步**清理 —— 钩子内一律调用 `restoreSync()`（`spawnSync reg.exe`），禁用异步 `restore()`（见 §3.1）。只注册 `'exit'`/`'uncaughtException'`，信号交给 worker 既有处理器（见 §3.1 冲突说明）。
   - 启动残留自检（marker 机制）：`enable` 时在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 下写 marker 键 `ReverserProxyOwner`，值为 JSON 序列化的 `{version, originalState}` 快照（含全部四项原始值）。`restore`/`restoreSync` 优先用内存中的 `originalState`，退出钩子路径下内存丢失时（如崩溃重启后）从 marker 值恢复快照再还原，成功后删除该键。`checkResidual` 仅在「marker 键存在」时判定为上次未清理的残留并按 marker 快照还原（**不比较端口**，避免上次用非默认端口崩溃后无法清理）；marker 不存在则视为用户/其他工具配置，**绝不触碰** —— 避免误删用户手动配置的代理。
   - **单实例假设**：同一时刻仅允许一个 worker 实例接管系统代理（本工具 daemon 本身是单例 socketPath 设计，天然满足）；多实例并发 `enable` 会互相覆盖 `originalState` 导致还原链断裂，不做支持，若检测到 marker 已存在且代理活跃则拒绝二次 `enable` 并返回明确错误。
2. **连接性能 Fail-open 机制**：
   - 进程反查属于旁路观测，查询为纯内存同步操作（§3.2 后台刷新模型），不存在连接路径上的阻塞风险。后台 `refresh()` 自身失败（命令不可用/超时）仅记录 debug 日志并保留上一次快照，不影响在途连接；连续失败超过 10 次时在状态接口标记 `trackerDegraded: true`，UI 提示进程识别不可靠（此时新连接反查返回 null，按 §3.3 规则处理）。
3. **系统权限与非 Windows 兼容**：
   - 在非 Windows 平台（macOS/Linux），如果未实现原生系统代理写入，API 优雅返回 `systemProxyUnsupported: true`，但依然支持通过手动配置代理后的“按进程名识别与过滤”功能（`ProcessConnectionTracker` 在非 Windows 上用 `lsof`/`ss` 等价实现，作为 P2 延后项，首版可返回空列表并标注降级）。

---

## 7. 验证与测试计划

1. **单元测试 (`tests/unit/modules/proxy/`，均通过注入 mock 的命令执行器隔离，不真改注册表）**：
   - `SystemProxyManager.test.ts`：注册表输出解析、四项备份与原子还原（含 PAC/Override 非空场景）、退出钩子只挂 `'exit'`/`'uncaughtException'`；
   - `SystemProxyManager.marker.test.ts`（P0 安全机制，必须覆盖）：marker 快照写入与删除、`checkResidual` 仅凭 marker 判定（不比较端口）、无 marker 时绝不触碰、崩溃重启后从 marker 值恢复还原、二次 `enable` 被拒；
   - `ProcessConnectionTracker.test.ts`：netstat/GetExtendedTcpTable 输出解析、后台刷新模型（`getProcessByPortSync` 纯内存查询、1500ms 过期）、进程名缓存 TTL、`matchesProcessName` 语义（大小写/无扩展名补 `.exe`/basename）；
   - `MitmModuleLocalApps.test.ts`：开启/关闭时的状态同步、反查失败时配置 targets → 盲转发、全选模式 → 放行。
2. **集成测试**（注入 mock tracker 使进程反查可控，平台无关）：
   - 启动代理并配置 `targets: ['fake_test.exe']`；
   - 模拟本地客户端 socket 发起 CONNECT 请求：
     - 非目标进程：断言走 raw TCP tunnel 盲转发，无自签证书，`ProxyStore` 中无记录；
     - 目标进程：断言正常解密，`CapturedExchange.clientProcess` 字段正确填入；
     - **配置上游 SOCKS5 代理时**：非目标进程的盲转发必须经 SOCKS5 隧道而非直连（P0-1 回归防护）；
     - 明文 HTTP 非目标请求：断言不落库。`SystemProxyManager` 相关用例仅 Windows 实机验证（手动验收清单），CI 上全部走 mock。
3. **Web UI 测试与格式检查**：
   - 运行 `npm run check-format`；
   - 运行 `npm run typecheck` 保证前后端 TypeScript 类型严格一致。
