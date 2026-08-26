# MITM Proxy Web UI 模块架构设计规范 (Design Spec)

## 1. 目标与背景

Reverser-CLI 已经具备底层的 MITM 代理抓包能力（`src/modules/proxy` 中的 `CaManager`、`MitmProxyServer`、`ProxyStore`、`MitmModule`）以及相关的 MCP 工具。但在 Web 控制台（`src/web-ui`）中尚缺少可视化的抓包监控与分析界面。

本规范旨在打通后端 Web 服务（REST 路由 + WebSocket 实时流）与前端 React 控制台，构建一个参考 `open-source/anything-analyzer` 交互体验的高性能、现代化、全功能流量抓包与逆向分析面板。

---

## 2. 总体系统架构与数据流

### 2.1 架构分层

```
+-----------------------------------------------------------------------------------+
| 前端: src/web-ui (React 19 + Tailwind CSS + Lucide Icons + Zustand)              |
| - 路由: /proxy (ProxyPage)                                                        |
| - 组件: ProxyControlBar, ProxyRequestList, ProxyRequestDetail, CaCertModal        |
| - 状态: proxyStore (Zustand) + wsClient 订阅 ('proxy.request', 'proxy.status')     |
+------------------------------------------^----------------------------------------+
                                           | HTTP REST (懒加载报文) / WebSocket (实时流)
+------------------------------------------v----------------------------------------+
| Web 服务层: src/web                                                                |
| - REST 路由: src/web/routes/proxy.ts (状态/启停/列表/详情/证书下载/局域网IP)         |
| - WebSocket Hub: src/web/ws/WsHub.ts (分发 proxy.request 摘要, proxy.status)       |
| - 控制台服务: src/web/ConsoleServer.ts (挂载路由并桥接 ProxyStore 捕获事件)         |
+------------------------------------------^----------------------------------------+
                                           | 调用与事件驱动
+------------------------------------------v----------------------------------------+
| 核心模块层: src/modules/proxy                                                      |
| - MitmModule (门面): 统一协调代理启停、状态汇总、证书导出                          |
| - ProxyStore: 环形内存缓冲 (新增 EventEmitter，支持捕获事件推送)                   |
| - CaManager / MitmProxyServer: 证书动态签发与 HTTPS 拦截                          |
+-----------------------------------------------------------------------------------+
```

### 2.2 核心数据流方案（方案 A：增量流 + 详情懒加载）

1. **实时广播**：当 `MitmProxyServer` 拦截到请求/响应后存入 `ProxyStore`，`ProxyStore` 触发 `capture` 事件。
2. **轻量推送**：`ConsoleServer` 监听到事件后，通过 `WsHub` 在 `proxy.request` 频道仅广播轻量摘要（`id`, `method`, `url`, `statusCode`, `contentType`, `timestamp`, `contentLength`），避免大响应体占用 WS 带宽与序列化开销。
3. **详情懒加载**：用户在前端列表点击选中某条记录时，前端发起 `GET /api/proxy/requests/:id` 请求，按需拉取完整的 Request/Response Headers、Body。
4. **状态同步**：代理启停或端口变更时，通过 `proxy.status` 广播最新状态。

---

## 3. 后端服务与 API 设计

### 3.1 协议与类型扩展 (`src/web/types.ts` & `src/web-ui/src/lib/protocol.ts`)

新增 Channel 及 Payload 类型：
- `Channel`: 增加 `'proxy.request'` (StreamChannel) 与 `'proxy.status'` (StateChannel)。
- `STATE_CHANNELS`: 加入 `'proxy.status'`。
- `ProxyStatusPayload`: 包含 `running: boolean`, `port: number | null`, `capturedCount: number`, `caInitialized: boolean`, `caCertPath: string`。
- `ProxyRequestSummaryEvent`: 包含 `id`, `method`, `url`, `statusCode`, `contentType`, `timestamp`, `contentLength`。

### 3.2 REST 路由设计 (`src/web/routes/proxy.ts`)

| 接口定义 | 方法 | 说明 |
|---|---|---|
| `/api/proxy/status` | GET | 获取代理运行状态、端口及 CA 信息 |
| `/api/proxy/start` | POST | 启动代理（支持自定义 port，默认 8888） |
| `/api/proxy/stop` | POST | 停止代理 |
| `/api/proxy/requests` | GET | 获取请求列表（支持 `urlFilter`, `method`, `pageIdx`, `pageSize` 分页查询） |
| `/api/proxy/requests/:id` | GET | 获取单条请求完整详情（含完整 Headers 和 Body） |
| `/api/proxy/requests` | DELETE | 清空当前捕获列表 |
| `/api/proxy/ca/download` | GET | 下载 CA 根证书（支持 `?format=pem` 或 `?format=der`） |
| `/api/proxy/ips` | GET | 获取本机局域网 IP 列表（用于移动端连接指引） |

---

## 4. 前端 UI 与交互架构设计 (`src/web-ui`)

### 4.1 页面路由与导航 (`src/web-ui/src/App.tsx`)
- 侧边栏新增 **`流量抓包 (Proxy)`** 导航项，图标为 `Network`（lucide-react）。
- 路由挂载 `/proxy` ➔ `<ProxyPage />`。

### 4.2 状态管理与数据缓存 (`src/web-ui/src/stores/proxy.ts`)
- 使用 Zustand 维护：
  - `requests: ProxyRequestSummary[]`: 实时追加与维护的前端列表（上限 2000 条）。
  - `selectedId: number | null`: 当前选中的请求 ID。
  - `selectedDetail: ProxyRequestDetail | null`: 当前选中请求的完整数据缓存。
  - `status: ProxyStatus`: 代理运行状态。
  - `isAutoScroll: boolean`: 是否自动滚动到底部。
  - `filter: { search: string; method: string; statusCode: string }`: 本地搜索过滤条件。

### 4.3 核心组件拆分与交互

1. **`ProxyControlBar` (顶部控制栏)**
   - 代理开关（启动/停止按钮，带有 Loading 态与状态指示灯）。
   - 端口设置与显示（默认 8888）。
   - CA 证书管理入口按钮（点击弹出 `CaCertModal`）。
   - 自动滚动切换（锁定/解除底部）、清空列表按钮。
   - 快速过滤器：搜索框（URL/Path 匹配）、Method 筛选（ALL / GET / POST / JSON 等）。

2. **`ProxyRequestList` (左侧请求列表面板)**
   - 紧凑型列表视图：
     - Method Badge：`GET`（绿）、`POST`（蓝/青）、`PUT`（黄）、`DELETE`（红）、`OPTIONS`（灰）。
     - Status Code：2xx（绿）、3xx（黄）、4xx/5xx（红）。
     - Path & Query：主文本显示路径，悬停展示完整 URL。
     - Content-Type 标签（`json`, `html`, `js`, `image`, `ws`）。
     - 耗时与请求时间戳。
   - 支持键盘 ↑ / ↓ 键快速导航选中项。

3. **`ProxyRequestDetail` (右侧深度详情面板)**
   - **Tab 1: General**
     - URL、请求方法、状态码、协议、时间戳、耗时、远程地址。
   - **Tab 2: Headers**
     - Request Headers 与 Response Headers 键值对网格展示。
     - **敏感/逆向关注字段高亮**：对 `Authorization`, `Cookie`, `Set-Cookie`, `x-*-token`, `sign`, `signature` 等赋予醒目背景与颜色。
     - 提供一键复制全部 Headers 格式。
   - **Tab 3: Request Body**
     - 格式化 JSON / Raw 文本切换。
     - 一键 Copy Raw / Copy JSON。
   - **Tab 4: Response Body**
     - 智能语法格式化（JSON 自动美化，支持折叠）。
     - 搜索高亮。
     - 一键下载或复制响应体。
   - **Tab 5: 逆向分析与导出 (Actions)**
     - 一键生成 **cURL 命令行**。
     - 一键生成 **Python requests 代码片段**。
     - 一键提取 Query/Body 中的签名加密字段。

4. **`CaCertModal` (CA 证书与设备配置弹窗)**
   - 本机局域网 IP 提示（例：`http://192.168.1.100:8888`）。
   - PC 端一键下载 `cert.pem` / `cert.crt` 并提示系统导入流程。
   - 手机/平板设备配置指引：配置 Wi-Fi 代理并访问 `http://cert.anything.test` 或一键下载链接。

---

## 5. 错误处理与防御机制

1. **大报文防御**：
   - 对于超过 2MB 的 Body，后端默认记录 `truncated: true`，前端展示截断提示与警告，避免页面内存溢出。
2. **WebSocket 流量削峰**：
   - 高频抓包时（如并发 > 50 req/s），前端通过 `requestAnimationFrame` 或 100ms 防抖批处理将新记录合并入 React 状态树，防止渲染卡顿。
3. **断线重连**：
   - 页面断开重连后，自动拉取最新 `status` 与最近 100 条历史请求，保证状态连续性。

---

## 6. 测试与验证方案

1. **单元测试 (`tests/unit/web/`)**：
   - 测试 `createProxyRoutes` 路由处理：`/api/proxy/status`, `/api/proxy/start`, `/api/proxy/requests` 等。
   - 测试 `ProxyStore` 的事件分发机制。
2. **前端组件测试 / 编译检查**：
   - 执行 `npm run web:typecheck` 验证 React 组件类型安全。
   - 执行 `npm run web:build` 验证 Vite 打包产物正常生成。
3. **集成与端到端手动验证**：
   - 启动 ConsoleServer，在浏览器打开控制台访问 `/proxy`。
   - 启动 MITM 代理并发送 HTTP/HTTPS 测试流量，验证列表实时刷新、点击查看详情、复制 cURL、下载 CA 等功能。
