# MITM 数据包捕获模块设计 Spec

**Date**: 2026-08-26
**Branch**: refactor
**Approach**: 方案 A — 移植 anything-analyzer 纯 Node MITM 引擎，融入本仓库网络工具域
**Phasing**: 单阶段（引擎 + 存储 + 门面 + 6 个 mitm_* 工具）

## Background

本仓库已有基于 CDP 的**浏览器**网络抓包（`list_network_requests` / `get_network_request` / `replay_network_request` 等，归属 `src/tools/network/` + `src/modules/network/`），但只能抓浏览器页面内流量。逆向 App 协议、调试终端 `curl`/脚本/桌面应用时，需要一条**非浏览器流量**的抓包链路。

`open-source/anything-analyzer` 提供了一套自研的**纯 Node MITM 代理**（`node-forge` 动态签 CA + 叶子证书 + `net/tls/http` CONNECT 隧道），且它采用「统一 Session 汇聚多来源流量」的设计——这正是本仓库缺失的一块。本设计把它的 MITM 引擎移植进本仓库，作为 `proxy` 抓包域暴露为 MCP 工具，供 MCP client 直接调用。

**已确认决策**（用户拍板）：
- 引擎：移植纯 Node MITM（不用 Python mitmproxy）
- 形态：MCP 工具（`defineTool` + `manifest.ts`）
- 范围：非浏览器流量（浏览器继续走现有 CDP 链路）
- 持久化：仅内存环形缓冲 + `saveTo` 按需导出（不接 ReverseTaskStore、不落盘）
- HTTPS：含 CONNECT 拦截 + 动态签证书（新增 `node-forge` 依赖）
- 命名：`mitm_*` 前缀，domain 目录 `proxy`

## 目标

- 终端/脚本/桌面应用能通过本地代理端口（默认 `8888`）把 HTTP/HTTPS 流量汇入，由 MCP 工具列表/查看/导出。
- 零外部进程、零跨语言运行时，仅新增 `node-forge` 一个运行时依赖。
- 不改动浏览器 CDP 链路、`web/`/`worker/`/`browsercli/`。

## 架构

```
src/modules/proxy/          引擎（零 CDP/页面依赖，不 import worker/tools）
  CaManager.ts              根 CA + 按域名叶子证书 + SecureContext LRU 缓存
  MitmProxyServer.ts        HTTP 直转 / HTTPS CONNECT 拦截 / ws 隧道
  ProxyStore.ts             环形缓冲（max 2000，稳定 id）
  MitmModule.ts             facade：start/stop/status/list/get/clear/exportCa
  types.ts                  领域类型
  index.ts                  公共导出（对齐 modules/network/index.ts）

src/tools/proxy/            6 个 mitm_* 工具 + manifest.ts

src/runtime.ts              新增 mitmModule lazy getter
src/runtime/RuntimeServices.ts  新增 getMitmModule()
```

## 组件设计

### 1. CaManager（移植 `anything-analyzer/src/main/proxy/ca-manager.ts`）

职责：根 CA 生成/持久化、按域名签发叶子证书、`tls.SecureContext` 缓存。

- node-forge RSA 2048 根 CA 自签，10 年有效期；叶子证书 **365 天**（Android Chrome 398 天上限）；保留原版 AKI 修复（`authorityKeyIdentifier` 手动取 CA 的 SKI，避免 Android CertPathValidator trust anchor 不匹配）。
- 证书目录默认 `~/.browsercli/mitm-certs/`，可用 env `BROWSER_MITM_CERTS_DIR` 覆盖；读值用现有的 `getEnvValue`（`src/config/resolver.ts`）。
- LRU 缓存上限 500（越界淘汰最旧）。
- 方法：`init()`、`isInitialized()`、`getCaCertPath()`、`getCaCertDer()`、`getSecureContextForHost(host)`、`regenerate()`。

### 2. MitmProxyServer（移植 `mitm-proxy-server.ts`）

职责：HTTP 直转、HTTPS `CONNECT` + 动态签证书拦截、WebSocket 隧道转发，产生 `response-captured` 记录。

保留（来自原版）：
- HTTP 直接转发；HTTPS `CONNECT` → `clientSocket.write("200 Connection Established")` → `tls.TLSSocket(isServer)` + 该域名 `SecureContext` → `http.createServer` mini server 在解密流上处理请求。
- `ws://` upgrade 与 `wss://`（TLS 隧道内 upgrade）双向 pipe 隧道转发，**不解密**（与原版一致），发出 `isWebSocket: true` 记录。
- `decodeCapturedBody`（br/gzip/deflate 逆序解码）、`bodyToUtf8`（解码失败回退 utf-8）、单 body 上限 1MB、`BINARY_CONTENT_TYPES` 列表跳过二进制、`STATIC_EXTENSIONS` 标记静态资源。

裁剪（首版不做）：
- 删除上游代理支持（`upstreamProxy` / `connectViaSocks5` / `connectViaHttpProxy`，及 `socks` 依赖）。
- 删除证书下载页（`serveCertPage` / `cert-download-page` 依赖）；命中本机自身地址时直接不转发。

风格对齐：
- `node:` 前缀；生产代码禁 `console.log`，用 `logger`（`src/utils/logger.ts`）。
- `crypto.randomUUID()` 替代 `uuid` 依赖。
- 捕获事件从 `EventEmitter` 改为构造注入 `onCaptured(record: CapturedRequest): void` 回调。
- 公开：`start(port)`、`stop()`、`isRunning()`、`getPort()`；构造函数注入 `CaManager` + `onCaptured`。

### 3. ProxyStore（对齐 `src/modules/hook/HookStore.ts` 模式）

职责：内存环形缓冲，稳定 id 自增。

- `add(record)`：push 时 id 自增（从 1 起）；`size >= maxRecords`（默认 2000）时 `shift()` 淘汰最旧。
- `list()`、`get(id)`、`clear()`（清空并重置 id）、`size()`。

### 4. MitmModule（对齐 `src/modules/network/NetworkModule.ts` 门面风格）

职责：协调 CaManager / MitmProxyServer / ProxyStore，为工具层提供无 CDP 依赖的方法。

- `async start(port)`：`ca.init()` → `server.start(port)`；返回 { port, caCertPath, caInitialized }。
- `async stop()`：停止服务器。
- `status()`：{ running, port, capturedCount }。
- `async listRequests(params)`：urlFilter / 分页。
- `async getRequest(params)`：全文 + `saveTo` 写文件（`node:fs/promises.writeFile`，沿用 `NetworkModule.getRequest` 的 saveTo 语义）。
- `clear()`：清空缓冲区。
- `async exportCa(params)`：把 CA 的 PEM 或 DER 写到目标路径，返回路径。

### 5. 工具层（`src/tools/proxy/`）

全部 `defineTool` + `ToolCategory.NETWORK`（复用现有分类，不动 `categories.ts`）。handler 模式对齐 `src/tools/network/listNetworkRequests.ts`：

```ts
handler: async (request, response) => {
  const result = getRuntime().mitmModule.<method>(request.params);
  response.setStructuredContent({...result, tooltype: '<tool_name>'});
}
```

| 文件 | 工具名 | readOnlyHint | 关键 schema |
|------|--------|-------------|-------------|
| startMitmProxy.ts | `start_mitm_proxy` | false | `port`（默认 8888） |
| stopMitmProxy.ts | `stop_mitm_proxy` | false | — |
| listMitmRequests.ts | `list_mitm_requests` | true | `urlFilter`、`pageSize`、`pageIdx` |
| getMitmRequest.ts | `get_mitm_request` | true | `id`、`saveTo?` |
| clearMitmRequests.ts | `clear_mitm_requests` | false | — |
| exportMitmCa.ts | `export_mitm_ca` | false | `format`('pem'\|'der')、`outputPath` |
| manifest.ts | domain `name: 'proxy'` | — | 6 个 tool entry，`satisfies DomainManifest` |

注册链（已核实）：`scripts/generate-tools-index.ts::readDomainManifests()` 遍历 `src/tools/*/manifest.ts`；新增 `proxy/manifest.ts` 后 `npm run build:index` 自动纳入 `GENERATED_TOOL_REGISTRY`；`ToolRegistry` 按 profile 过滤暴露。无需新增枚举。

## 运行时接线

1. `src/runtime.ts`：
   - `Runtime` 接口加 `mitmModule: MitmModule;`；顶部 `import type {MitmModule} from './modules/proxy/index.js';`
   - `getRuntime()` 对象加 `get mitmModule() { return services.getMitmModule(); }`（对齐 `networkModule` lazy getter）。
2. `src/runtime/RuntimeServices.ts`：加 `private mitmModule?: MitmModule;` 与 `getMitmModule()`（`??= new MitmModule()`），加 import。

> `Runtime` 标 `@stable` 约束针对**修改既有字段**；新增服务走 `RuntimeServices` lazy getter 是 CLAUDE.md 明确要求的标准做法。

## 数据流

```
客户端(curl/脚本/App) ──→ 代理端口 8888
   ├─ 明文 HTTP：直接转发，边转发边 buffer body
   └─ HTTPS：CONNECT → 按域名签发叶子证书 → tls 解密 → 转发
            → 上游真实服务器 → 响应回传 → 解码(gzip/br/deflate, 1MB 截断, 跳二进制)
            → onCaptured(record) → ProxyStore
MCP: start / list / get / clear / stop / export_ca
            → MitmModule → ProxyStore
```

## 错误处理

- 上游连接失败 → 回 502 并 `logger.warn`；TLS 握手失败 → 记日志 + 销毁 socket。
- body 解码失败 → 回退 `toString('utf-8')`（沿用原版 `bodyToUtf8` try/catch）。
- 端口占用 → `start` reject，错误上抛到工具层。
- 未启动时 `list/get/clear` → 返回空结果（`success:true`，不抛错）。

## 测试（`node:test`，镜像目录）

- `tests/unit/modules/proxy/CaManager.test.ts`：临时目录 init → 根 CA 生成 → 同域名二次取 SecureContext 命中缓存 → regenerate 清缓存。
- `tests/unit/modules/proxy/MitmProxyServer.test.ts`：起临时端口；用 `node:http` 发明文 GET（mock Host），断言 `onCaptured` 收到记录；`stop` 后 `isRunning()===false`。
- `tests/unit/modules/proxy/ProxyStore.test.ts`：溢出 `shift()`、id 自增、clear 重置。
- `tests/unit/tools/proxy/*.test.ts`：6 工具轻量契约（name/schema/category 合法）。

## 边界（首版刻意不做）

- 无上游代理（SOCKS5/HTTP 上游）。
- 无「设为系统代理」「证书安装到系统」——用户手动 `--cacert` / 手动配代理。
- WebSocket 只隧道转发不解密（与原版一致）。
- 抓包数据仅内存留存，不落盘、不关联任务、不接 ReverseTaskStore（用 `get_mitm_request` 的 `saveTo` 按需导出）。
- 新增依赖：`node-forge`（dependencies）+ `@types/node-forge`（devDependencies）。

## 验证方式

1. `npm install node-forge && npm install -D @types/node-forge`
2. `npm run build:index` → 确认 `src/tools/generated-tools-index.ts` 出现 `proxyManifest`
3. `npm run typecheck`
4. `npm run test:unit`
5. `npm run check-format`
6. 端到端手动验证：
   - `npm run build && node build/src/index.js`
   - 调 `start_mitm_proxy`（8888）→ 读返回 CA 路径
   - `curl -x http://127.0.0.1:8888 http://example.com` → `list_mitm_requests` 可见 → `get_mitm_request` 取全文
   - （可选）`curl -x http://127.0.0.1:8888 --cacert <CA路径> https://example.com` 验证 CONNECT + 动态签证书
   - `stop_mitm_proxy` 收尾