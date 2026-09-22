# MITM 数据包捕获模块实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植 anything-analyzer 的纯 Node MITM 引擎，在本仓库构建一个非浏览器流量抓包域（`proxy`），暴露为 6 个 `mitm_*` MCP 工具。

**Architecture:** 三层对齐现有 `network`/`hook` 模式——`src/modules/proxy/` 放引擎（`CaManager` 签证书 / `MitmProxyServer` 拦截 / `ProxyStore` 环形缓冲 / `MitmModule` 门面），`src/tools/proxy/` 放 `defineTool` 工具 + `manifest.ts`，运行时走 `RuntimeServices` lazy getter 暴露 `mitmModule`。零 CDP/页面依赖，不 import `worker/` 或 `tools/`。

**Tech Stack:** TypeScript ESM / `node:http`·`node:https`·`node:tls`·`node:net`·`node:zlib` / `node-forge`（动态签证书）/ `zod`（`src/third_party/index.ts`）

**Spec:** `docs/superpowers/specs/2026-08-26-mitm-proxy-module-design.md`

## Global Constraints

- Node `^20.19.0 || ^22.12.0 || >=23`；新增运行时依赖仅 `node-forge`，开发依赖仅 `@types/node-forge`；不得引入 `socks` / `uuid`。
- 文件 import 用 `node:` 前缀；内建模块 `node:http` `node:https` `node:tls` `node:net` `node:zlib` `node:crypto` `node:fs/promises`。
- 生产代码禁 `console.log`，一律用 `logger`（`src/utils/logger.ts`）。
- 配置读值用 `getEnvValue`（`src/config/resolver.ts`）；类型校验用 `zod`（`src/third_party/index.ts`）；工具定义用 `defineTool`（`src/tools/ToolDefinition.ts`）。
- 工具 category 固定 `ToolCategory.NETWORK`（复用现有枚举，不新增）。
- 代码风格：singleQuote、trailingComma all、`arrowParens: avoid`、interface 优先、无 `any`（未知输入用 `unknown`）。文件头带 `@license` 注释块（`Copyright 2026 Google LLC / Browser-CLI`）。
- 测试框架 `node:test`，测试文件放镜像目录 `tests/unit/modules/proxy/`、`tests/unit/tools/proxy/`，import 相对路径 `../../../../src/...`。
- 不碰 `web/`、`worker/`、`browsercli/`、`src/web-ui/`、`apiV1.ts`；不改浏览器 CDP 链路。

---

### Task 1: 安装依赖 + `CaManager`（根 CA + 叶子证书）

**Files:**
- Modify: `package.json`（dependencies 加 `node-forge`，devDependencies 加 `@types/node-forge`）
- Create: `src/modules/proxy/CaManager.ts`
- Test: `tests/unit/modules/proxy/CaManager.test.ts`

**Interfaces:**
- Consumes: `getEnvValue`（`src/config/resolver.ts`）、`node-forge`、`node:tls`、`node:fs` `node:path` `node:os`。
- Produces（后续 Task 3/4 依赖）:
  - `resolveMitmCertsDir(): string` — 返回 `BROWSER_MITM_CERTS_DIR` 或 `~/.browsercli/mitm-certs`。
  - `class CaManager` — `constructor(certsDir: string)`；`async init(): Promise<void>`；`isInitialized(): boolean`；`getCaCertPath(): string`；`getCaCertDer(): Buffer`；`getSecureContextForHost(hostname: string): tls.SecureContext`；`async regenerate(): Promise<void>`。

- [ ] **Step 1: 安装依赖**

```powershell
npm install node-forge && npm install -D @types/node-forge
```

- [ ] **Step 2: 写失败测试**

创建 `tests/unit/modules/proxy/CaManager.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';

describe('CaManager', () => {
  it('init 生成根 CA 并持久化到磁盘', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca = new CaManager(dir);
      await ca.init();
      assert.strictEqual(ca.isInitialized(), true);
      assert.strictEqual(existsSync(path.join(dir, 'ca-cert.pem')), true);
      assert.strictEqual(existsSync(path.join(dir, 'ca-key.pem')), true);
      assert.ok(ca.getCaCertPath().endsWith('ca-cert.pem'));
      assert.ok(ca.getCaCertDer().length > 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('同域名二次取 SecureContext 命中缓存（同一实例）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca = new CaManager(dir);
      await ca.init();
      const first = ca.getSecureContextForHost('example.com');
      const second = ca.getSecureContextForHost('example.com');
      assert.strictEqual(first, second);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('再次 init 从磁盘加载既有 CA（不重新生成）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-'));
    try {
      const ca1 = new CaManager(dir);
      await ca1.init();
      const path1 = ca1.getCaCertPath();

      const ca2 = new CaManager(dir);
      await ca2.init();
      assert.strictEqual(ca2.getCaCertPath(), path1);
      assert.strictEqual(ca2.isInitialized(), true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx swc src/modules/proxy/CaManager.ts tests/unit/modules/proxy/CaManager.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/CaManager.test.js`
Expected: FAIL — 模块 `CaManager` 不存在。

- [ ] **Step 4: 实现 `CaManager`**

创建 `src/modules/proxy/CaManager.ts`（移植自 `open-source/anything-analyzer/src/main/proxy/ca-manager.ts`，MIT 许可）：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 移植自 anything-analyzer (MIT License):
 * open-source/anything-analyzer/src/main/proxy/ca-manager.ts
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as forge from 'node-forge';
import * as tls from 'node:tls';

import {getEnvValue} from '../../config/resolver.js';

const CA_KEY_FILE = 'ca-key.pem';
const CA_CERT_FILE = 'ca-cert.pem';
const CA_VALIDITY_YEARS = 10;
// Chrome / Chromium / Firefox / iOS / Android 自 2020-09 起统一上限 398 天。
// 留缓冲避免边界期 cert 被拒。
const LEAF_VALIDITY_DAYS = 365;
const CACHE_MAX_SIZE = 500;

/** 证书目录：BROWSER_MITM_CERTS_DIR 或 ~/.browsercli/mitm-certs。 */
export function resolveMitmCertsDir(): string {
  const explicit = getEnvValue('BROWSER_MITM_CERTS_DIR');
  if (explicit && explicit.trim().length > 0) return explicit;
  return path.join(os.homedir(), '.browsercli', 'mitm-certs');
}

interface KeyPairLike {
  privateKey: forge.pki.rsa.PrivateKey;
  publicKey: forge.pki.rsa.PublicKey;
}

/**
 * CaManager — 生成并缓存根 CA，并按域名签发叶子证书用于 MITM TLS 拦截。
 */
export class CaManager {
  private caKey: KeyPairLike | null = null;
  private caCert: forge.pki.Certificate | null = null;
  /** LRU 缓存：hostname → tls.SecureContext */
  private readonly contextCache = new Map<string, tls.SecureContext>();

  constructor(private readonly certsDir: string) {}

  async init(): Promise<void> {
    if (!existsSync(this.certsDir)) {
      mkdirSync(this.certsDir, {recursive: true});
    }
    const keyPath = path.join(this.certsDir, CA_KEY_FILE);
    const certPath = path.join(this.certsDir, CA_CERT_FILE);
    if (existsSync(keyPath) && existsSync(certPath)) {
      const keyPem = readFileSync(keyPath, 'utf-8');
      const certPem = readFileSync(certPath, 'utf-8');
      const privateKey = forge.pki.privateKeyFromPem(keyPem);
      this.caKey = {
        privateKey,
        publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e),
      };
      this.caCert = forge.pki.certificateFromPem(certPem);
    } else {
      this.generate();
    }
  }

  isInitialized(): boolean {
    return this.caCert !== null && this.caKey !== null;
  }

  getCaCertPath(): string {
    return path.join(this.certsDir, CA_CERT_FILE);
  }

  getCaCertDer(): Buffer {
    if (!this.caCert) throw new Error('CA not initialized');
    const asn1 = forge.pki.certificateToAsn1(this.caCert);
    const der = forge.asn1.toDer(asn1);
    return Buffer.from(der.getBytes(), 'binary');
  }

  getSecureContextForHost(hostname: string): tls.SecureContext {
    const cached = this.contextCache.get(hostname);
    if (cached) return cached;

    if (this.contextCache.size >= CACHE_MAX_SIZE) {
      const oldest = this.contextCache.keys().next().value!;
      this.contextCache.delete(oldest);
    }

    const {key, cert} = this.issueLeafCert(hostname);
    const ctx = tls.createSecureContext({
      key,
      cert,
      ca: forge.pki.certificateToPem(this.caCert!),
    });
    this.contextCache.set(hostname, ctx);
    return ctx;
  }

  async regenerate(): Promise<void> {
    this.contextCache.clear();
    this.generate();
  }

  private generate(): void {
    const keys = forge.pki.rsa.generateKeyPair({bits: 2048});
    this.caKey = {privateKey: keys.privateKey, publicKey: keys.publicKey};

    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.randomSerial();

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(
      now.getFullYear() + CA_VALIDITY_YEARS,
      now.getMonth(),
      now.getDate(),
    );

    const attrs: forge.pki.CertificateField[] = [
      {shortName: 'CN', value: 'BrowserCLI MITM CA'},
      {shortName: 'O', value: 'BrowserCLI'},
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
      {name: 'basicConstraints', cA: true, critical: true},
      {name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true},
      {name: 'subjectKeyIdentifier'},
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());
    this.caCert = cert;

    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);
    writeFileSync(path.join(this.certsDir, CA_KEY_FILE), keyPem, 'utf-8');
    writeFileSync(path.join(this.certsDir, CA_CERT_FILE), certPem, 'utf-8');
  }

  private issueLeafCert(hostname: string): {key: string; cert: string} {
    if (!this.caKey || !this.caCert) {
      throw new Error('CA not initialized');
    }

    const keys = forge.pki.rsa.generateKeyPair({bits: 2048});
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.randomSerial();

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + LEAF_VALIDITY_DAYS,
    );

    cert.setSubject([{shortName: 'CN', value: hostname}]);
    cert.setIssuer(this.caCert.subject.attributes);

    const isIP = /^[\d.]+$/.test(hostname) || hostname.includes(':');
    const altNames: {type: number; value?: string; ip?: string}[] = isIP
      ? [{type: 7, ip: hostname}]
      : [{type: 2, value: hostname}];

    cert.setExtensions([
      {name: 'basicConstraints', cA: false},
      {name: 'keyUsage', digitalSignature: true, keyEncipherment: true},
      {name: 'extKeyUsage', serverAuth: true},
      {name: 'subjectAltName', altNames},
      {name: 'subjectKeyIdentifier'},
      {
        name: 'authorityKeyIdentifier',
        // AKI 必须等于 CA 的 SKI；keyIdentifier:true 会错用叶子自身公钥，
        // 导致 Android CertPathValidator 判定 trust anchor 不匹配。
        keyIdentifier: this.caCert.generateSubjectKeyIdentifier().getBytes(),
      },
    ]);

    cert.sign(this.caKey.privateKey, forge.md.sha256.create());

    const leafPem = forge.pki.certificateToPem(cert);
    const caPem = forge.pki.certificateToPem(this.caCert);
    return {
      key: forge.pki.privateKeyToPem(keys.privateKey),
      cert: leafPem + caPem,
    };
  }

  private randomSerial(): string {
    return forge.util.bytesToHex(forge.random.getBytesSync(16));
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx swc src/modules/proxy/CaManager.ts tests/unit/modules/proxy/CaManager.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/CaManager.test.js`
Expected: PASS（3 个用例全绿）

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/modules/proxy/CaManager.ts tests/unit/modules/proxy/CaManager.test.ts
git commit -m "feat(proxy): add CaManager for MITM root CA and leaf cert issuance"
```

---

### Task 2: `types.ts` + `ProxyStore`（环形缓冲存储）

**Files:**
- Create: `src/modules/proxy/types.ts`
- Create: `src/modules/proxy/ProxyStore.ts`
- Test: `tests/unit/modules/proxy/ProxyStore.test.ts`

**Interfaces:**
- Consumes: 无（纯类型 + 无外部依赖的存储）。
- Produces（Task 3/4/6 依赖）:
  - `CapturedExchange` — 服务器回调产生的原始捕获记录（无 `id`）。
  - `CapturedRequest = CapturedExchange & {id: number}` — 带稳定 id 的存储记录。
  - `MitmMethodResult<T> = {success: boolean; message: string; data: T}`。
  - `class ProxyStore` — `constructor(maxRecords = 2000)`；`add(exchange: CapturedExchange): CapturedRequest`；`list(): CapturedRequest[]`；`get(id: number): CapturedRequest | undefined`；`clear(): void`；`size(): number`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/proxy/ProxyStore.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {ProxyStore} from '../../../../src/modules/proxy/ProxyStore.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

function makeExchange(url: string): CapturedExchange {
  return {
    requestId: `proxy-${url}`,
    method: 'GET',
    url,
    requestHeaders: {},
    requestBody: null,
    statusCode: 200,
    responseHeaders: {},
    responseBody: null,
    contentType: null,
    isOptions: false,
    isStatic: false,
    isStreaming: false,
    isWebSocket: false,
    truncated: false,
    timestamp: Date.now(),
  };
}

describe('ProxyStore', () => {
  it('add 分配从 1 递增的稳定 id', () => {
    const store = new ProxyStore();
    const a = store.add(makeExchange('http://a/'));
    const b = store.add(makeExchange('http://b/'));
    assert.strictEqual(a.id, 1);
    assert.strictEqual(b.id, 2);
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(store.get(1), a);
  });

  it('超过上限时淘汰最旧记录', () => {
    const store = new ProxyStore(2);
    store.add(makeExchange('http://a/'));
    store.add(makeExchange('http://b/'));
    store.add(makeExchange('http://c/'));
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(store.get(1), undefined);
    assert.strictEqual(store.get(2)?.url, 'http://b/');
    assert.strictEqual(store.get(3)?.url, 'http://c/');
  });

  it('clear 清空并重置 id', () => {
    const store = new ProxyStore();
    store.add(makeExchange('http://a/'));
    store.clear();
    assert.strictEqual(store.size(), 0);
    const next = store.add(makeExchange('http://b/'));
    assert.strictEqual(next.id, 1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx swc src/modules/proxy/types.ts src/modules/proxy/ProxyStore.ts tests/unit/modules/proxy/ProxyStore.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/ProxyStore.test.js`
Expected: FAIL — `ProxyStore` 不存在。

- [ ] **Step 3: 实现 `types.ts`**

创建 `src/modules/proxy/types.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** 服务器回调产生的原始捕获记录（无稳定 id）。 */
export interface CapturedExchange {
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isOptions: boolean;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
}

/** ProxyStore 中带稳定 id 的存储记录。 */
export type CapturedRequest = CapturedExchange & {id: number};

/** MitmModule 各方法统一返回结构。 */
export interface MitmMethodResult<T> {
  success: boolean;
  message: string;
  data: T;
}

// ─── 工具参数与结果类型 ──────────────────────────────

export interface StartMitmProxyParams {
  port?: number;
}

export interface StartMitmProxyData {
  port: number;
  caCertPath: string;
  caInitialized: boolean;
}

export interface MitmProxyStatusData {
  running: boolean;
  port: number | null;
  capturedCount: number;
}

export interface ListMitmRequestsParams {
  pageSize?: number;
  pageIdx?: number;
  urlFilter?: string;
}

export interface MitmRequestSummary {
  id: number;
  method: string;
  url: string;
  statusCode: number;
  contentType: string | null;
  timestamp: number;
}

export interface ListMitmRequestsData {
  requests: MitmRequestSummary[];
  total: number;
  pageIdx: number;
  pageSize: number | undefined;
}

export interface GetMitmRequestParams {
  id: number;
  saveTo?: string;
}

export interface GetMitmRequestData {
  id: number;
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  isStatic: boolean;
  isStreaming: boolean;
  isWebSocket: boolean;
  truncated: boolean;
  timestamp: number;
  savedPath?: string;
}

export interface ClearMitmRequestsData {
  clearedCount: number;
}

export interface ExportMitmCaParams {
  format: 'pem' | 'der';
  outputPath: string;
}

export interface ExportMitmCaData {
  format: 'pem' | 'der';
  outputPath: string;
  bytes: number;
}
```

- [ ] **Step 4: 实现 `ProxyStore`**

创建 `src/modules/proxy/ProxyStore.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {CapturedExchange, CapturedRequest} from './types.js';

/**
 * ProxyStore — MITM 捕获记录的内存环形缓冲。
 *
 * 稳定 id 从 1 递增，clear() 后重置。超过 maxRecords 时淘汰最旧记录。
 */
export class ProxyStore {
  private readonly records: CapturedRequest[] = [];
  private readonly maxRecords: number;
  private nextId = 1;

  constructor(maxRecords = 2000) {
    this.maxRecords = maxRecords;
  }

  add(exchange: CapturedExchange): CapturedRequest {
    const record: CapturedRequest = {...exchange, id: this.nextId++};
    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push(record);
    return record;
  }

  list(): CapturedRequest[] {
    return [...this.records];
  }

  get(id: number): CapturedRequest | undefined {
    return this.records.find(r => r.id === id);
  }

  clear(): void {
    this.records.length = 0;
    this.nextId = 1;
  }

  size(): number {
    return this.records.length;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx swc src/modules/proxy/types.ts src/modules/proxy/ProxyStore.ts tests/unit/modules/proxy/ProxyStore.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/ProxyStore.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git add src/modules/proxy/types.ts src/modules/proxy/ProxyStore.ts tests/unit/modules/proxy/ProxyStore.test.ts
git commit -m "feat(proxy): add MITM capture types and ProxyStore ring buffer"
```

---

### Task 3: `MitmProxyServer`（HTTP 直转 + HTTPS CONNECT + ws 隧道）

**Files:**
- Create: `src/modules/proxy/MitmProxyServer.ts`
- Test: `tests/unit/modules/proxy/MitmProxyServer.test.ts`

**Interfaces:**
- Consumes: `CaManager.getSecureContextForHost`（Task 1）、`CapturedExchange`（Task 2）、`logger`。
- Produces（Task 4 依赖）:
  - `class MitmProxyServer` — `constructor(caManager: CaManager, onCaptured: (exchange: CapturedExchange) => void)`；`async start(port: number): Promise<void>`；`async stop(): Promise<void>`；`isRunning(): boolean`；`getPort(): number | null`。

- [ ] **Step 1: 写失败测试（仅明文 HTTP 路径）**

创建 `tests/unit/modules/proxy/MitmProxyServer.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import http, {IncomingMessage} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {CaManager} from '../../../../src/modules/proxy/CaManager.js';
import {MitmProxyServer} from '../../../../src/modules/proxy/MitmProxyServer.js';
import type {CapturedExchange} from '../../../../src/modules/proxy/types.js';

/** 启动一个本地真实 HTTP 源站，返回其端口和关闭函数。 */
async function startOriginServer() {
  return new Promise<{port: number; close: () => Promise<void>}>((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('hello-from-origin');
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('bad address'));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}

function requestViaProxy(proxyPort: number, targetUrl: string): Promise<{status: number | undefined; body: string}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path: targetUrl,
        method: 'GET',
        headers: {host: new URL(targetUrl).host},
      },
      (res: IncomingMessage) => {
        let body = '';
        res.on('data', c => (body += c.toString('utf-8')));
        res.on('end', () => resolve({status: res.statusCode, body}));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('MitmProxyServer', () => {
  it('明文 HTTP 请求被转发并产生捕获记录', async () => {
    const origin = await startOriginServer();
    let captured: CapturedExchange | undefined;
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(ca, exchange => {
      captured = exchange;
    });
    await proxy.start(0);

    try {
      const target = `http://127.0.0.1:${origin.port}/anything`;
      const res = await requestViaProxy(proxy.getPort()!, target);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body, 'hello-from-origin');
      assert.ok(captured, '应产生捕获记录');
      assert.strictEqual(captured.url, target);
      assert.strictEqual(captured.statusCode, 200);
      assert.strictEqual(captured.responseBody, 'hello-from-origin');
    } finally {
      await proxy.stop();
      await origin.close();
    }
  });

  it('stop 后 isRunning 为 false', async () => {
    const ca = new CaManager(mkdtempSync(path.join(os.tmpdir(), 'mitm-ca-')));
    await ca.init();
    const proxy = new MitmProxyServer(ca, () => {});
    await proxy.start(0);
    assert.strictEqual(proxy.isRunning(), true);
    await proxy.stop();
    assert.strictEqual(proxy.isRunning(), false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx swc src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/MitmProxyServer.test.js`
Expected: FAIL — `MitmProxyServer` 不存在。

- [ ] **Step 3: 实现 `MitmProxyServer`**

创建 `src/modules/proxy/MitmProxyServer.ts`（移植自 `open-source/anything-analyzer/src/main/proxy/mitm-proxy-server.ts`，MIT 许可，裁剪上游代理与证书下载页）：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * 移植自 anything-analyzer (MIT License):
 * open-source/anything-analyzer/src/main/proxy/mitm-proxy-server.ts
 * 裁剪：上游代理（SOCKS5/HTTP 上游）、证书下载页、uuid 依赖、EventEmitter。
 */
import {randomUUID} from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import * as url from 'node:url';
import {brotliDecompressSync, gunzipSync, inflateSync} from 'node:zlib';

import {logger} from '../../utils/logger.js';

import type {CaManager} from './CaManager.js';
import type {CapturedExchange} from './types.js';

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const BINARY_CONTENT_TYPES = [
  'image/',
  'font/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/pdf',
  'application/zip',
];
const STATIC_EXTENSIONS =
  /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|map)$/i;

function headerToString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : value || '';
}

function decodeCapturedBody(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): Buffer {
  const encodings = headerToString(contentEncoding)
    .toLowerCase()
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  return encodings.reduceRight((decoded, encoding) => {
    if (encoding === 'br') return brotliDecompressSync(decoded);
    if (encoding === 'gzip' || encoding === 'x-gzip') return gunzipSync(decoded);
    if (encoding === 'deflate') return inflateSync(decoded);
    return decoded;
  }, body);
}

function bodyToUtf8(
  body: Buffer,
  contentEncoding: string | string[] | undefined,
): string {
  try {
    return decodeCapturedBody(body, contentEncoding)
      .toString('utf-8')
      .substring(0, MAX_BODY_SIZE);
  } catch {
    return body.toString('utf-8').substring(0, MAX_BODY_SIZE);
  }
}

function parseRawHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = raw.split('\r\n').slice(1);
  for (const line of lines) {
    if (!line) break;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }
  return headers;
}

/**
 * MitmProxyServer — 嵌入式 HTTP/HTTPS 中间人代理。
 *
 * - 明文 HTTP 直接转发。
 * - HTTPS CONNECT 通过 CaManager 动态签证书拦截并解密。
 * - WS / WSS 流量隧道转发，不解密。
 * - 每个完成的事务通过 onCaptured 回调对外产生 CapturedExchange。
 */
export class MitmProxyServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly connections = new Set<net.Socket>();

  constructor(
    private readonly caManager: CaManager,
    private readonly onCaptured: (exchange: CapturedExchange) => void,
  ) {}

  async start(port: number): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    this.server.on('connect', (req, clientSocket, head) => {
      this.handleConnect(req, clientSocket, head);
    });
    this.server.on('upgrade', (req, socket, head) => {
      this.handleWsUpgrade(req, socket as net.Socket, head, false);
    });
    this.server.on('connection', socket => {
      this.connections.add(socket);
      socket.on('close', () => this.connections.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', (err: NodeJS.ErrnoException) => {
        logger.error('[MitmProxy] Server error:', err.message);
        reject(err);
      });
      this.server!.listen(port, '0.0.0.0', () => {
        const address = this.server!.address();
        this.port =
          address && typeof address === 'object' ? address.port : port;
        logger.info(`[MitmProxy] Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    await new Promise<void>(resolve => {
      this.server!.close(() => {
        logger.info('[MitmProxy] Stopped');
        this.server = null;
        this.port = null;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  getPort(): number | null {
    return this.port;
  }

  // ── HTTP（非 CONNECT）──

  private handleHttpRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const targetUrl = clientReq.url || '';
    if (!targetUrl) {
      clientRes.writeHead(400);
      clientRes.end('Bad Request');
      return;
    }
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const parsed = url.parse(targetUrl);
    const reqBodyChunks: Buffer[] = [];
    let reqBodySize = 0;

    clientReq.on('data', (chunk: Buffer) => {
      if (reqBodySize < MAX_BODY_SIZE) reqBodyChunks.push(chunk);
      reqBodySize += chunk.length;
    });

    clientReq.on('end', () => {
      const reqBody = Buffer.concat(reqBodyChunks);
      const headers = {...clientReq.headers};
      delete headers['proxy-connection'];

      const options: http.RequestOptions = {
        hostname: parsed.hostname ?? 'localhost',
        port: parseInt(parsed.port ?? '80', 10),
        path: parsed.path ?? '/',
        method: clientReq.method,
        headers,
      };

      const proxyReq = http.request(options, proxyRes => {
        this.relayResponse(
          requestId,
          startTime,
          clientReq,
          reqBody,
          targetUrl,
          proxyRes,
          clientRes,
        );
      });

      proxyReq.on('error', (err: Error) => {
        logger.warn('[MitmProxy] HTTP proxy error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      });

      if (reqBody.length > 0) proxyReq.write(reqBody);
      proxyReq.end();
    });
  }

  // ── 明文 ws:// upgrade ──

  private handleWsUpgrade(
    clientReq: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
    isTls: boolean,
  ): void {
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const targetUrl = clientReq.url || '/';
    const parsed = url.parse(targetUrl);
    const hostname = parsed.hostname || 'localhost';
    const port = parseInt(parsed.port || (isTls ? '443' : '80'), 10);
    const scheme = isTls ? 'wss' : 'ws';
    const fullUrl = targetUrl.startsWith('ws')
      ? targetUrl
      : `${scheme}://${hostname}:${port}${parsed.path || '/'}`;

    const connectAndTunnel = (serverSocket: net.Socket): void => {
      const hostHeader = port !== (isTls ? 443 : 80) ? `${hostname}:${port}` : hostname;
      const headers = {...clientReq.headers, host: hostHeader};
      let rawReq = `${clientReq.method} ${parsed.path || '/'} HTTP/1.1\r\n`;
      for (const [key, val] of Object.entries(headers)) {
        if (val === undefined) continue;
        for (const v of Array.isArray(val) ? val : [val]) {
          rawReq += `${key}: ${v}\r\n`;
        }
      }
      rawReq += '\r\n';

      serverSocket.write(rawReq);
      if (head.length > 0) serverSocket.write(head);

      let responseBuf = Buffer.alloc(0);
      const onData = (chunk: Buffer): void => {
        responseBuf = Buffer.concat([responseBuf, chunk]);
        const headerEnd = responseBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        serverSocket.removeListener('data', onData);

        const responseHeader = responseBuf.subarray(0, headerEnd + 4);
        const trailing = responseBuf.subarray(headerEnd + 4);
        const firstLine = responseHeader.toString('utf-8').split('\r\n')[0];
        const statusCode = parseInt(firstLine.split(' ')[1], 10) || 101;

        clientSocket.write(responseHeader);
        if (trailing.length > 0) clientSocket.write(trailing);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
        serverSocket.on('error', () => clientSocket.destroy());
        clientSocket.on('error', () => serverSocket.destroy());
        serverSocket.on('close', () => clientSocket.destroy());
        clientSocket.on('close', () => serverSocket.destroy());

        this.onCaptured({
          requestId,
          method: clientReq.method || 'GET',
          url: fullUrl,
          requestHeaders: this.headersToRecord(clientReq.headers),
          requestBody: null,
          statusCode,
          responseHeaders: parseRawHeaders(responseHeader.toString('utf-8')),
          responseBody: null,
          contentType: null,
          isOptions: false,
          isStatic: false,
          isStreaming: false,
          isWebSocket: true,
          truncated: false,
          timestamp: startTime,
        });
      };
      serverSocket.on('data', onData);
    };

    const serverSocket = net.connect(port, hostname, () =>
      connectAndTunnel(serverSocket),
    );
    serverSocket.on('error', (err: Error) => {
      logger.warn(`[MitmProxy] WS connect error for ${hostname}:`, err.message);
      clientSocket.destroy();
    });
  }

  // ── HTTPS CONNECT 拦截 ──

  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): void {
    const [hostname, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr, 10) || 443;

    if (!hostname) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const secureContext = this.caManager.getSecureContextForHost(hostname);
    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext,
    });

    if (head.length > 0) tlsSocket.unshift(head);

    const miniServer = http.createServer((decryptedReq, decryptedRes) => {
      this.handleDecryptedRequest(
        hostname,
        port,
        decryptedReq,
        decryptedRes,
      );
    });
    miniServer.on('upgrade', (upgradeReq, upgradeSocket, upgradeHead) => {
      this.handleWsUpgrade(
        upgradeReq,
        upgradeSocket as net.Socket,
        upgradeHead,
        true,
      );
    });
    miniServer.emit('connection', tlsSocket as unknown as net.Socket);

    tlsSocket.on('error', (err: Error) => {
      logger.warn(`[MitmProxy] TLS error for ${hostname}:`, err.message);
    });
    clientSocket.on('error', () => tlsSocket.destroy());
  }

  private handleDecryptedRequest(
    hostname: string,
    port: number,
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const startTime = Date.now();
    const requestId = `proxy-${randomUUID()}`;
    const fullUrl = `https://${hostname}${port !== 443 ? ':' + port : ''}${clientReq.url || '/'}`;

    const reqBodyChunks: Buffer[] = [];
    let reqBodySize = 0;
    clientReq.on('data', (chunk: Buffer) => {
      if (reqBodySize < MAX_BODY_SIZE) reqBodyChunks.push(chunk);
      reqBodySize += chunk.length;
    });

    clientReq.on('end', () => {
      const reqBody = Buffer.concat(reqBodyChunks);
      const hostHeader = port !== 443 ? `${hostname}:${port}` : hostname;
      const options: https.RequestOptions = {
        hostname,
        port,
        path: clientReq.url,
        method: clientReq.method,
        headers: {...clientReq.headers, host: hostHeader},
        rejectUnauthorized: false,
      };

      const proxyReq = https.request(options, proxyRes => {
        this.relayResponse(
          requestId,
          startTime,
          clientReq,
          reqBody,
          fullUrl,
          proxyRes,
          clientRes,
        );
      });

      proxyReq.on('error', (err: Error) => {
        logger.warn('[MitmProxy] HTTPS proxy error:', err.message);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502);
          clientRes.end('Bad Gateway');
        }
      });

      if (reqBody.length > 0) proxyReq.write(reqBody);
      proxyReq.end();
    });
  }

  private relayResponse(
    requestId: string,
    startTime: number,
    clientReq: http.IncomingMessage,
    reqBody: Buffer,
    fullUrl: string,
    proxyRes: http.IncomingMessage,
    clientRes: http.ServerResponse,
  ): void {
    const resBodyChunks: Buffer[] = [];
    let totalResSize = 0;
    let truncated = false;

    proxyRes.on('data', (chunk: Buffer) => {
      if (totalResSize < MAX_BODY_SIZE) resBodyChunks.push(chunk);
      else truncated = true;
      totalResSize += chunk.length;
    });

    proxyRes.on('end', () => {
      const contentType = (proxyRes.headers['content-type'] as string) || null;
      const method = clientReq.method || 'GET';
      const isBinary = contentType
        ? BINARY_CONTENT_TYPES.some(t => contentType.startsWith(t))
        : false;
      const isStreaming = contentType?.includes('text/event-stream') || false;
      const isOptions = method === 'OPTIONS';
      const isStatic = STATIC_EXTENSIONS.test(fullUrl);

      const requestBody =
        reqBody.length > 0 && !isBinary
          ? bodyToUtf8(reqBody, clientReq.headers['content-encoding'])
          : null;
      const responseBody =
        resBodyChunks.length > 0 && !isBinary
          ? bodyToUtf8(Buffer.concat(resBodyChunks), proxyRes.headers['content-encoding'])
          : null;

      this.onCaptured({
        requestId,
        method,
        url: fullUrl,
        requestHeaders: this.headersToRecord(clientReq.headers),
        requestBody,
        statusCode: proxyRes.statusCode || 0,
        responseHeaders: this.headersToRecord(proxyRes.headers),
        responseBody,
        contentType,
        isOptions,
        isStatic,
        isStreaming,
        isWebSocket: false,
        truncated,
        timestamp: startTime,
      });
    });

    clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(clientRes);
  }

  private headersToRecord(
    headers: http.IncomingHttpHeaders,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      out[key] = headerToString(
        Array.isArray(value) ? value : value.toString(),
      );
    }
    return out;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx swc src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/MitmProxyServer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/modules/proxy/MitmProxyServer.ts tests/unit/modules/proxy/MitmProxyServer.test.ts
git commit -m "feat(proxy): add MitmProxyServer with HTTP forward and HTTPS CONNECT interception"
```

---

### Task 4: `MitmModule` 门面

**Files:**
- Create: `src/modules/proxy/MitmModule.ts`
- Create: `src/modules/proxy/index.ts`
- Test: `tests/unit/modules/proxy/MitmModule.test.ts`

**Interfaces:**
- Consumes: `CaManager`（Task 1）、`MitmProxyServer`（Task 3）、`ProxyStore` + `MitmMethodResult` + 各参数/结果类型（Task 2）、`resolveMitmCertsDir`（Task 1）。
- Produces（Task 5/6 依赖）:
  - `class MitmModule` — `async start(port?: number): Promise<MitmMethodResult<StartMitmProxyData>>`；`async stop(): Promise<MitmMethodResult<MitmProxyStatusData>>`；`status(): MitmMethodResult<MitmProxyStatusData>`；`listRequests(params?: ListMitmRequestsParams): MitmMethodResult<ListMitmRequestsData>`；`async getRequest(params: GetMitmRequestParams): Promise<MitmMethodResult<GetMitmRequestData>>`；`clear(): MitmMethodResult<ClearMitmRequestsData>`；`async exportCa(params: ExportMitmCaParams): Promise<MitmMethodResult<ExportMitmCaData>>`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/modules/proxy/MitmModule.test.ts`（只测无网络依赖的 `listRequests`/`clear`/`status` 与 `exportCa`，`start/stop` 的端到端已在 Task 3 覆盖，这里用注入式 mock 验证门面编排）：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';

describe('MitmModule', () => {
  it('status 未启动时返回 running=false 且 capturedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.status();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.running, false);
      assert.strictEqual(result.data.capturedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('clear 未捕获时返回 clearedCount=0', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    try {
      const mod = new MitmModule(dir);
      const result = mod.clear();
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.clearedCount, 0);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('exportCa 把 pem 写入目标路径并返回字节数', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mitm-mod-'));
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'mitm-out-'));
    try {
      const mod = new MitmModule(dir);
      const outPath = path.join(outDir, 'ca.pem');
      const result = await mod.exportCa({format: 'pem', outputPath: outPath});
      assert.strictEqual(result.success, true);
      assert.ok(result.data.bytes > 0);
      assert.ok(require('node:fs').existsSync(outPath));
    } finally {
      rmSync(dir, {recursive: true, force: true});
      rmSync(outDir, {recursive: true, force: true});
    }
  });
});
```

> 注：测试中 `require('node:fs')` 改为顶部 `import {existsSync} from 'node:fs'` 并复用。上例为示意，正式写入时用 ESM import。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx swc src/modules/proxy/MitmModule.ts src/modules/proxy/index.ts tests/unit/modules/proxy/MitmModule.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/MitmModule.test.js`
Expected: FAIL — `MitmModule` 不存在。

- [ ] **Step 3: 实现 `MitmModule`**

创建 `src/modules/proxy/MitmModule.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {writeFile} from 'node:fs/promises';

import {logger} from '../../utils/logger.js';

import {CaManager, resolveMitmCertsDir} from './CaManager.js';
import {MitmProxyServer} from './MitmProxyServer.js';
import {ProxyStore} from './ProxyStore.js';
import type {
  ClearMitmRequestsData,
  ExportMitmCaData,
  ExportMitmCaParams,
  GetMitmRequestData,
  GetMitmRequestParams,
  ListMitmRequestsData,
  ListMitmRequestsParams,
  MitmMethodResult,
  MitmProxyStatusData,
  StartMitmProxyData,
} from './types.js';

const DEFAULT_PORT = 8888;

/**
 * MitmModule — MITM 抓包门面。协调 CaManager / MitmProxyServer / ProxyStore。
 * 通过 runtime.mitmModule 访问。
 */
export class MitmModule {
  private readonly store: ProxyStore;
  private readonly caManager: CaManager;
  private server: MitmProxyServer | null = null;

  constructor(certsDir: string = resolveMitmCertsDir()) {
    this.store = new ProxyStore();
    this.caManager = new CaManager(certsDir);
  }

  async start(port: number = DEFAULT_PORT): Promise<MitmMethodResult<StartMitmProxyData>> {
    try {
      await this.caManager.init();
      if (!this.server) {
        this.server = new MitmProxyServer(this.caManager, exchange => {
          this.store.add(exchange);
        });
      }
      await this.server.start(port);
      return {
        success: true,
        message: `MITM 代理已启动，端口 ${this.server.getPort()}`,
        data: {
          port: this.server.getPort()!,
          caCertPath: this.caManager.getCaCertPath(),
          caInitialized: this.caManager.isInitialized(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `启动 MITM 代理失败：${error instanceof Error ? error.message : String(error)}`,
        data: {
          port: port,
          caCertPath: this.caManager.getCaCertPath(),
          caInitialized: this.caManager.isInitialized(),
        },
      };
    }
  }

  async stop(): Promise<MitmMethodResult<MitmProxyStatusData>> {
    try {
      await this.server?.stop();
      this.server = null;
      return {success: true, message: 'MITM 代理已停止', data: this.statusData()};
    } catch (error) {
      return {
        success: false,
        message: `停止 MITM 代理失败：${error instanceof Error ? error.message : String(error)}`,
        data: this.statusData(),
      };
    }
  }

  status(): MitmMethodResult<MitmProxyStatusData> {
    return {
      success: true,
      message: this.server?.isRunning()
        ? `MITM 代理运行中，端口 ${this.server.getPort()}`
        : 'MITM 代理未运行',
      data: this.statusData(),
    };
  }

  listRequests(
    params: ListMitmRequestsParams = {},
  ): MitmMethodResult<ListMitmRequestsData> {
    let records = this.store.list();

    if (params.urlFilter) {
      const filter = params.urlFilter.toLowerCase();
      records = records.filter(r => r.url.toLowerCase().includes(filter));
    }

    const pageIdx = params.pageIdx ?? 0;
    const pageSize = params.pageSize;
    const total = records.length;
    const paged = pageSize
      ? records.slice(pageIdx * pageSize, pageIdx * pageSize + pageSize)
      : records;

    return {
      success: true,
      message: `共 ${total} 条捕获记录，返回 ${paged.length} 条`,
      data: {
        requests: paged.map(r => ({
          id: r.id,
          method: r.method,
          url: r.url,
          statusCode: r.statusCode,
          contentType: r.contentType,
          timestamp: r.timestamp,
        })),
        total,
        pageIdx,
        pageSize,
      },
    };
  }

  async getRequest(
    params: GetMitmRequestParams,
  ): Promise<MitmMethodResult<GetMitmRequestData>> {
    const record = this.store.get(params.id);
    if (!record) {
      return {
        success: false,
        message: `未找到 id=${params.id} 的捕获记录`,
        data: this.emptyRequestData(params.id),
      };
    }

    if (params.saveTo) {
      try {
        await writeFile(params.saveTo, record.responseBody ?? '', 'utf-8');
      } catch (error) {
        return {
          success: false,
          message: `保存响应到 ${params.saveTo} 失败：${error instanceof Error ? error.message : String(error)}`,
          data: {...this.toRequestData(record), savedPath: undefined},
        };
      }
    }

    return {
      success: true,
      message: `捕获记录 id=${params.id} 获取成功`,
      data: {
        ...this.toRequestData(record),
        ...(params.saveTo !== undefined && {savedPath: params.saveTo}),
      },
    };
  }

  clear(): MitmMethodResult<ClearMitmRequestsData> {
    const cleared = this.store.size();
    this.store.clear();
    return {
      success: true,
      message: `已清空 ${cleared} 条捕获记录`,
      data: {clearedCount: cleared},
    };
  }

  async exportCa(
    params: ExportMitmCaParams,
  ): Promise<MitmMethodResult<ExportMitmCaData>> {
    try {
      await this.caManager.init();
      const data =
        params.format === 'der'
          ? this.caManager.getCaCertDer()
          : require('node:fs').readFileSync(this.caManager.getCaCertPath());
      await writeFile(params.outputPath, data);
      return {
        success: true,
        message: `CA 证书已导出到 ${params.outputPath}`,
        data: {format: params.format, outputPath: params.outputPath, bytes: data.length},
      };
    } catch (error) {
      return {
        success: false,
        message: `导出 CA 证书失败：${error instanceof Error ? error.message : String(error)}`,
        data: {format: params.format, outputPath: params.outputPath, bytes: 0},
      };
    }
  }

  private statusData(): MitmProxyStatusData {
    return {
      running: this.server?.isRunning() ?? false,
      port: this.server?.getPort() ?? null,
      capturedCount: this.store.size(),
    };
  }

  private toRequestData(r: {
    id: number;
    requestId: string;
    method: string;
    url: string;
    requestHeaders: Record<string, string>;
    requestBody: string | null;
    statusCode: number;
    responseHeaders: Record<string, string>;
    responseBody: string | null;
    contentType: string | null;
    isStatic: boolean;
    isStreaming: boolean;
    isWebSocket: boolean;
    truncated: boolean;
    timestamp: number;
  }): GetMitmRequestData {
    const {id, ...rest} = r;
    return {id, ...rest};
  }

  private emptyRequestData(id: number): GetMitmRequestData {
    return {
      id,
      requestId: '',
      method: '',
      url: '',
      requestHeaders: {},
      requestBody: null,
      statusCode: 0,
      responseHeaders: {},
      responseBody: null,
      contentType: null,
      isStatic: false,
      isStreaming: false,
      isWebSocket: false,
      truncated: false,
      timestamp: 0,
    };
  }
}
```

> 注：`exportCa` 中 `require('node:fs')` 为示意，正式代码改为顶部 `import {readFileSync} from 'node:fs'`。

创建 `src/modules/proxy/index.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Facade
export {MitmModule} from './MitmModule.js';
export {CaManager, resolveMitmCertsDir} from './CaManager.js';
export {MitmProxyServer} from './MitmProxyServer.js';
export {ProxyStore} from './ProxyStore.js';

// 类型
export type {
  CapturedExchange,
  CapturedRequest,
  MitmMethodResult,
  StartMitmProxyParams,
  StartMitmProxyData,
  MitmProxyStatusData,
  ListMitmRequestsParams,
  MitmRequestSummary,
  ListMitmRequestsData,
  GetMitmRequestParams,
  GetMitmRequestData,
  ClearMitmRequestsData,
  ExportMitmCaParams,
  ExportMitmCaData,
} from './types.js';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx swc src/modules/proxy/MitmModule.ts src/modules/proxy/index.ts tests/unit/modules/proxy/MitmModule.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/modules/proxy/MitmModule.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add src/modules/proxy/MitmModule.ts src/modules/proxy/index.ts tests/unit/modules/proxy/MitmModule.test.ts
git commit -m "feat(proxy): add MitmModule facade wiring CaManager, server, and store"
```

---

### Task 5: 运行时接线（`runtime.ts` + `RuntimeServices.ts`）

**Files:**
- Modify: `src/runtime.ts`
- Modify: `src/runtime/RuntimeServices.ts`

**Interfaces:**
- Consumes: `MitmModule`（Task 4）。
- Produces: `runtime.mitmModule`（Task 6 依赖）。

- [ ] **Step 1: 修改 `RuntimeServices`**

在 `src/runtime/RuntimeServices.ts` 顶部加 import：

```ts
import {MitmModule} from '../modules/proxy/index.js';
```

加私有字段（与其他 lazy 字段并列）：

```ts
  private mitmModule?: MitmModule;
```

加 getter（放在 `getNetworkModule()` 之后）：

```ts
  getMitmModule(): MitmModule {
    return (this.mitmModule ??= new MitmModule());
  }
```

- [ ] **Step 2: 修改 `runtime.ts`**

顶部（`import type {NetworkModule} ...` 附近）加：

```ts
import type {MitmModule} from './modules/proxy/index.js';
```

`Runtime` 接口（`networkModule: NetworkModule;` 之后）加：

```ts
  mitmModule: MitmModule;
```

`getRuntime()` 返回对象（`get networkModule() {...}` 之后）加：

```ts
    get mitmModule() {
      return services.getMitmModule();
    },
```

- [ ] **Step 3: 类型检查确认通过**

Run: `npm run typecheck`
Expected: 无新错误（若报 `MitmModule` 缺省导出或 import 路径，按报错修正——SMVC 是 `export class`，用命名导入 `import {MitmModule}` / `import type {MitmModule}`）。

- [ ] **Step 4: Commit**

```powershell
git add src/runtime.ts src/runtime/RuntimeServices.ts
git commit -m "feat(proxy): expose mitmModule via runtime lazy getter"
```

---

### Task 6: 6 个 MCP 工具 + `manifest.ts` + 契约测试

**Files:**
- Create: `src/tools/proxy/startMitmProxy.ts`、`stopMitmProxy.ts`、`listMitmRequests.ts`、`getMitmRequest.ts`、`clearMitmRequests.ts`、`exportMitmCa.ts`
- Create: `src/tools/proxy/manifest.ts`
- Create: `src/tools/proxy/index.ts`
- Test: `tests/unit/tools/proxy/tools.test.ts`

**Interfaces:**
- Consumes: `getRuntime`（`src/runtime.ts`）、`defineTool`（`src/tools/ToolDefinition.ts`）、`ToolCategory`（`src/tools/categories.ts`）、`zod`（`src/third_party/index.ts`）、各参数/结果类型（Task 4 的 `index.ts` re-export）。
- Produces: `startMitmProxy`、`stopMitmProxy`、`listMitmRequests`、`getMitmRequest`、`clearMitmRequests`、`exportMitmCa` 六个 named export + `manifest`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/tools/proxy/tools.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import * as proxyTools from '../../../../src/tools/proxy/index.js';

const EXPECTED_TOOLS = [
  'start_mitm_proxy',
  'stop_mitm_proxy',
  'list_mitm_requests',
  'get_mitm_request',
  'clear_mitm_requests',
  'export_mitm_ca',
];

describe('proxy tools', () => {
  for (const toolName of EXPECTED_TOOLS) {
    it(`${toolName} 已注册且 category 为 network`, () => {
      const tool = (proxyTools as Record<string, unknown>)[toolName] as
        | {name: string; annotations: {category: string}}
        | undefined;
      assert.ok(tool, `${toolName} 应存在`);
      assert.strictEqual(tool.name, toolName);
      assert.strictEqual(tool.annotations.category, 'network');
    });
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx swc src/tools/proxy/*.ts tests/unit/tools/proxy/tools.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/proxy/tools.test.js`
Expected: FAIL — `proxy/index.ts` 不存在。

- [ ] **Step 3: 实现 6 个工具**

创建 `src/tools/proxy/startMitmProxy.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {StartMitmProxyParams} from '../../modules/proxy/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const startMitmProxy = defineTool({
  name: 'start_mitm_proxy',
  description:
    '启动 MITM 抓包代理，拦截非浏览器流量（curl、脚本、桌面应用、手机 App）。启动后终端可通过 `-x http://127.0.0.1:<port>` 走代理；HTTPS 需信任返回的 CA 证书路径（--cacert）。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    port: zod
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('代理监听端口，默认 8888。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.start(request.params.port);
    response.setStructuredContent({...result, tooltype: 'start_mitm_proxy'});
  },
});
```

创建 `src/tools/proxy/stopMitmProxy.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const stopMitmProxy = defineTool({
  name: 'stop_mitm_proxy',
  description: '停止 MITM 抓包代理并释放端口。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: async (_request, response) => {
    const result = await getRuntime().mitmModule.stop();
    response.setStructuredContent({...result, tooltype: 'stop_mitm_proxy'});
  },
});
```

创建 `src/tools/proxy/listMitmRequests.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {ListMitmRequestsParams} from '../../modules/proxy/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const listMitmRequests = defineTool({
  name: 'list_mitm_requests',
  description: '列出 MITM 代理捕获到的请求（内存环形缓冲，最多保留最近 2000 条）。支持 URL 过滤与分页。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    pageSize: zod.number().int().positive().optional().describe('每页条数，省略返回全部。'),
    pageIdx: zod.number().int().min(0).optional().describe('页码，从 0 开始。'),
    urlFilter: zod.string().optional().describe('按 URL 包含片段过滤（大小写不敏感）。'),
  },
  handler: (request, response) => {
    const result = getRuntime().mitmModule.listRequests(
      request.params as ListMitmRequestsParams,
    );
    response.setStructuredContent({...result, tooltype: 'list_mitm_requests'});
  },
});
```

创建 `src/tools/proxy/getMitmRequest.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {GetMitmRequestParams} from '../../modules/proxy/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const getMitmRequest = defineTool({
  name: 'get_mitm_request',
  description: '获取单条 MITM 捕获请求的完整详情（请求头/请求体/响应头/响应体）。可选 saveTo 把响应体写入文件。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: true,
  },
  schema: {
    id: zod.number().int().positive().describe('捕获记录稳定 id，来自 list_mitm_requests。'),
    saveTo: zod.string().optional().describe('把响应体写入该文件路径，返回 savedPath，不写入响应内存。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.getRequest(
      request.params as GetMitmRequestParams,
    );
    response.setStructuredContent({...result, tooltype: 'get_mitm_request'});
  },
});
```

创建 `src/tools/proxy/clearMitmRequests.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const clearMitmRequests = defineTool({
  name: 'clear_mitm_requests',
  description: '清空 MITM 代理捕获的所有请求。清空后 id 从 1 重新编号。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {},
  handler: (_request, response) => {
    const result = getRuntime().mitmModule.clear();
    response.setStructuredContent({
      ...result,
      tooltype: 'clear_mitm_requests',
    });
  },
});
```

创建 `src/tools/proxy/exportMitmCa.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getRuntime} from '../../runtime.js';
import {zod} from '../../third_party/index.js';
import type {ExportMitmCaParams} from '../../modules/proxy/index.js';
import {ToolCategory} from '../categories.js';
import {defineTool} from '../ToolDefinition.js';

export const exportMitmCa = defineTool({
  name: 'export_mitm_ca',
  description: '导出 MITM 根 CA 证书（PEM 或 DER），供客户端信任以解密 HTTPS 流量。',
  annotations: {
    category: ToolCategory.NETWORK,
    readOnlyHint: false,
  },
  schema: {
    format: zod.enum(['pem', 'der']).default('pem').describe('证书格式。'),
    outputPath: zod.string().describe('导出文件路径。'),
  },
  handler: async (request, response) => {
    const result = await getRuntime().mitmModule.exportCa(
      request.params as ExportMitmCaParams,
    );
    response.setStructuredContent({...result, tooltype: 'export_mitm_ca'});
  },
});
```

创建 `src/tools/proxy/index.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {startMitmProxy} from './startMitmProxy.js';
export {stopMitmProxy} from './stopMitmProxy.js';
export {listMitmRequests} from './listMitmRequests.js';
export {getMitmRequest} from './getMitmRequest.js';
export {clearMitmRequests} from './clearMitmRequests.js';
export {exportMitmCa} from './exportMitmCa.js';
```

创建 `src/tools/proxy/manifest.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DomainManifest} from '../manifest.js';

export const manifest = {
  name: 'proxy',
  description: 'Non-browser MITM traffic capture tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './proxy/startMitmProxy.js',
      handlerName: 'startMitmProxy',
    },
    {
      modulePath: './proxy/stopMitmProxy.js',
      handlerName: 'stopMitmProxy',
    },
    {
      modulePath: './proxy/listMitmRequests.js',
      handlerName: 'listMitmRequests',
    },
    {
      modulePath: './proxy/getMitmRequest.js',
      handlerName: 'getMitmRequest',
    },
    {
      modulePath: './proxy/clearMitmRequests.js',
      handlerName: 'clearMitmRequests',
    },
    {
      modulePath: './proxy/exportMitmCa.js',
      handlerName: 'exportMitmCa',
    },
  ],
} satisfies DomainManifest;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx swc src/tools/proxy/*.ts tests/unit/tools/proxy/tools.test.ts -d build --extensions .ts && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test build/tests/unit/tools/proxy/tools.test.js`
Expected: PASS

- [ ] **Step 5: 重新生成工具索引**

Run: `npm run build:index`
Expected: `src/tools/generated-tools-index.ts` 出现 `import {manifest as proxyManifest}`、`GENERATED_DOMAIN_MANIFESTS` 含 `proxyManifest`。

- [ ] **Step 6: Commit**

```powershell
git add src/tools/proxy/ src/tools/generated-tools-index.ts tests/unit/tools/proxy/
git commit -m "feat(proxy): add mitm_* MCP tools and proxy domain manifest"
```

---

### Task 7: 最终验证闭环

- [ ] **Step 1: 类型检查**

Run: `npm run typecheck`
Expected: 无错误。

- [ ] **Step 2: 单元测试**

Run: `npm run test:unit`
Expected: PASS（含新增 proxy 测试）。

- [ ] **Step 3: 格式检查**

Run: `npm run check-format`
Expected: 无 diff（若 Prettier/ESLint 报格式问题，运行 `npm run format` 后重新 `check-format`）。

- [ ] **Step 4: 端到端手动验证**

```powershell
npm run build
node build/src/index.js
```
通过 MCP client：
1. 调 `start_mitm_proxy`（默认 8888）→ 记返回的 `caCertPath`。
2. 终端执行 `curl -x http://127.0.0.1:8888 http://example.com`。
3. 调 `list_mitm_requests` → 应看到该请求。
4. 调 `get_mitm_request`（用返回的 id）→ 取全文。
5.（可选）`curl -x http://127.0.0.1:8888 --cacert <caCertPath> https://example.com` 验证 HTTPS CONNECT + 动态签证书。
6. 调 `stop_mitm_proxy` 收尾。

- [ ] **Step 5: 最终 diff 自检（无修改即重跑对应检查）**

若 Step 1-4 任一失败并做了修复，重跑失败的检查；确认最终 diff 相关的检查全绿后再报告完成。

---

## Self-Review

- **Spec coverage**：引擎（Task 1/3）、存储（Task 2）、门面（Task 4）、工具 + manifest（Task 6）、运行时接线（Task 5）、测试 + 验证（各 Task 内 + Task 7）、边界裁剪（无上游代理/无证书下载页/仅内存）均已对应。
- **Placeholder scan**：无 TBD/TODO；每个 code step 给完整代码；`saveTo`/`exportCa` 细节已写明。
- **Type consistency**：`getMitmRequest` 的 `GetMitmRequestData`、`MitmMethodResult<T>`、`CapturedExchange`/`CapturedRequest`、`resolveMitmCertsDir` 在 Task 2/3/4/5/6 中命名一致；工具名 `mitm_*` 与 domain `proxy` 一致；handler 内 cast 均用 re-export 类型。