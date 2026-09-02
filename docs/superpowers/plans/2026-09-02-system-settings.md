# 系统设置模块重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Web 控制台「连接设置」页从 632 行单文件扁平双区块改造成「左侧导航 + 右侧分区」结构，补齐 `GlobalConfigSchema` 中已有但 UI 不可达的反检测/指纹/采集限制字段，并新增环境信息、日志查看、配置导出·导入·重置三项后端能力。

**Architecture:** 后端新增 `src/web/routes/system.ts`（环境信息 + 日志读取/下载），`src/config/runtimeConfigPersistence.ts` 导出 `PERSISTED_KEYS` 白名单并新增 `deleteRuntimeConfig()`，`src/web/routes/config.ts` 追加 export/import/reset 三条路由（`import` 是**合并**语义，复用现有 `update()` 浅合并，不加 `replace()`）。前端 `settings.tsx` 瘦身为 shell（导航 + `patchBrowser`/`patchRoot` 两个回调），五个分区拆成独立组件，共享 `Field.tsx` 的两个 className 常量。不新增 schema 字段、不改任何默认值。

**Tech Stack:** TypeScript ESM（Node `^20.19.0 || ^22.12.0 || >=23`）、`node:test`（经 `npm run build` 后跑 `build/tests/**`）、zod（`src/third_party/index.ts`）、React 19 + Tailwind CSS 4 + lucide-react、Prettier + ESLint（平铺配置）。

**Spec:** `docs/superpowers/specs/2026-09-02-system-settings-design.md`

---

## Global Constraints

- **Node 版本**：`^20.19.0 || ^22.12.0 || >=23`（`package.json` engines）。**本轮不新增任何依赖**。
- **Prettier**：`singleQuote: true`、`trailingComma: 'all'`、`arrowParens: 'avoid'`、`bracketSpacing: false`、`endOfLine: 'lf'`、`singleAttributePerLine: true`（`.prettierrc.cjs`）。`singleAttributePerLine` 意味着 **JSX 每个属性各占一行** —— 本计划里所有 JSX 代码块都已按此格式书写，直接照抄即可通过。
- **ESLint**：导入按字母序分组（`node:` 内置 → 裸包 → 上级 `../../`、`../` → 同级 `./`），组间空一行；类型导入显式 `import type`（`@typescript-eslint/consistent-type-imports`）；接口优先于 type alias（`@typescript-eslint/consistent-type-definitions`）；数组类型 `array-simple`（简单类型 `T[]`，复杂类型 `Array<T>`）；禁 `import/no-cycle`。报 `import/order` 时跑 `npx eslint --fix <file>` 后重跑，**不要手工猜顺序**。
- **License 头（已逐文件核实现状）**：
  - `src/utils/logger.ts`、`src/config/RuntimeConfigStore.ts`、`src/config/runtimeConfigPersistence.ts`、`src/config/schema.ts`、`src/web/types.ts`、`src/web/ConsoleServer.ts`、`src/index.ts` 均为 `Copyright 2026 Browser-CLI` —— 这些都是 Modify，**保持原头不改**。
  - `src/web/routes/config.ts`、`src/web/routes/proxy.ts`、`tests/unit/web/routes/config.test.ts`、所有 `src/web-ui/**` 文件为 `Copyright 2026 Google LLC` 或 `Copyright 2026 JSReverser-MCP` —— Modify 同样保持原头不改。
  - 新建的 `src/web/routes/system.ts` 与 `tests/unit/web/routes/system.test.ts` 同目录邻居 `config.ts`/`config.test.ts` 用 **`Copyright 2026 Browser-CLI`**；新建的 `src/web-ui/src/components/settings/*.tsx` 同目录邻居 `src/web-ui/src/components/proxy/*.tsx` 用 **`Copyright 2026 Google LLC`**。
- **生产代码禁 `console.log`**，一律用 `logger`（`src/utils/logger.ts`）。唯一例外是 `runtimeConfigPersistence.ts` 现有的 `console.error` 静默风格，新增的 `deleteRuntimeConfig()` 与之保持一致。
- **根 `tsconfig.json` 是松配置**（`strict:false`、`noUnusedLocals:false`、`noImplicitAny:false`），而 **`src/web-ui/tsconfig.json` 是严配置**（`strict:true`、`noUnusedLocals:true`、`noUnusedParameters:true`）。**这两个 tsconfig 的 include 不重叠**（根配置 `exclude: ["src/web-ui/**"]`）。漏掉的可选链在后端只能靠测试暴露 —— 红灯必须真跑、必须真红；前端则会被 `noUnusedLocals` 直接拦下（多引进来的 lucide 图标、未使用的 props 都会报错）。
- 提交信息 Conventional Commits（`feat(settings): ...` / `refactor(web-ui): ...`）。
- **工作区卫生**：每个 Task 的 `git add` 只列本 Task 显式文件，禁止 `git add -A`；提交前 `git status --porcelain` 核对。**本轮会新建/重写 `src/web/routes/system.ts` 等文件，`git add` 时切勿误带上 `build/`**。
- **单测运行模板**（改完 `src/` 或 `tests/` 后必须 `npm run build` 才能生效 —— swc 把 `src`/`tests` 编译到 `build/`，测试跑的是 `build/tests/**`）：

  ```bash
  npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/<path>.test.js
  ```

  只跑编译步可加速：`npm run build:compile`（约 0.5s，而 `npm run build` 会额外跑 `web:build` + `build:cli`）。

- **⚠️ 不要用 `npm run check-format` 当门禁**（已实测）：`eslint --cache .` 会把 `open-source/` 一起扫，**运行约 4 分钟后 FATAL ERROR: JavaScript heap out of memory**。文件级门禁用 `npx prettier --check <file>` + `npx eslint <file>`。收尾时同样**不要**直接跑 `npm run check-format`，改为对本轮改动的每个文件单独跑这两条。
- **四道验证命令**（收尾必跑，spec §7）：

  ```bash
  npm run typecheck && npm run web:typecheck && npm run test:unit && npm run check-format
  ```

  其中 `npm run check-format` 会因上述 OOM 失败 —— 实测基线如此，**执行时用文件级 prettier + eslint 替代它**，并在完成时如实说明（见「验证说明」一节）。

- **反检测红线（CLAUDE.md 硬约束）**：本轮 UI 只暴露 `cloak` / `jsStealth` / `fullStealthArgs` / `minimalStealth` / `useStealthScripts` 五个开关，**不改任何默认值、不新增 schema 字段、不碰 `src/modules/browser/`**。四个 opt-in 项（`cloak`/`jsStealth`/`fullStealthArgs`/`useStealthScripts`）默认 `false`，`minimalStealth` 默认 `true`，保留不变。

---

## 文件结构

| 文件                                                       | 责任                                                                    | 状态   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `src/utils/logger.ts`                                      | 新增导出 `getLogDir()`；`createDefaultLogFileName()` 改用它             | Modify |
| `src/config/runtimeConfigPersistence.ts`                   | 导出 `PERSISTED_KEYS`；新增 `deleteRuntimeConfig()`                     | Modify |
| `src/web/routes/system.ts`                                 | `createSystemRoutes()` —— `/api/system/info`、`/logs`、`/logs/download` | Create |
| `src/web/routes/config.ts`                                 | 追加 `/api/config/export`、`/import`、`/reset`                          | Modify |
| `src/web/ConsoleServer.ts`                                 | `ConsoleServerOptions.configSeed`；mount system 路由并透传              | Modify |
| `src/index.ts`                                             | 构造 `ConsoleServer` 时传 `configSeed: cliConfig`                       | Modify |
| `src/web/types.ts`                                         | `SystemInfo` / `LogFileInfo` / `LogContent` / `ExportedConfig`          | Modify |
| `src/web-ui/src/lib/api.ts`                                | 5 个新方法（下载不走 `api.ts`）                                         | Modify |
| `src/web-ui/src/lib/protocol.ts`                           | `BrowserConfig` 补 11 个新字段；`RuntimeConfig` 不动                    | Modify |
| `src/web-ui/src/components/settings/Field.tsx`             | `Field` + `inputClass` / `labelClass`                                   | Create |
| `src/web-ui/src/components/settings/BrowserSection.tsx`    | 浏览器连接分区                                                          | Create |
| `src/web-ui/src/components/settings/AntiDetectSection.tsx` | 反检测 + 指纹分区                                                       | Create |
| `src/web-ui/src/components/settings/LlmSection.tsx`        | LLM Provider 分区                                                       | Create |
| `src/web-ui/src/components/settings/CollectionSection.tsx` | 采集与限制分区                                                          | Create |
| `src/web-ui/src/components/settings/GeneralSection.tsx`    | 环境/日志/导出·导入·重置                                                | Create |
| `src/web-ui/src/routes/settings.tsx`                       | 瘦身为 shell：左侧导航 + 右侧懒挂载                                     | Modify |
| `tests/unit/web/routes/system.test.ts`                     | info / 路径穿越 / 读取 / 404                                            | Create |
| `tests/unit/web/routes/config.test.ts`                     | export / import / reset 用例                                            | Modify |
| `tests/unit/config/runtimeConfigPersistence.test.ts`       | `deleteRuntimeConfig()` 两条                                            | Modify |

---

## 关键接口速查（跨 Task 契约）

后面每个 Task 的「Interfaces」只引用本节签名，不重复定义。**这些名字必须逐字一致**。

```ts
// src/utils/logger.ts（新增导出）
export function getLogDir(): string; // path.join(os.homedir(), '.browsercli', 'log')

// src/config/runtimeConfigPersistence.ts
export const PERSISTED_KEYS: ReadonlySet<keyof GlobalConfig>; // {'llmProvider','openai','browser'}
export function deleteRuntimeConfig(): boolean; // true=删除成功或本就不存在；false=其他错误（EPERM/EBUSY 等，console.error 后返回）

// src/web/routes/config.ts（ConfigRoutesConfig 新增两个可选字段）
configSeed?: Partial<GlobalConfig>; // reset 时的 CLI 种子值
deleteConfig?: () => boolean; // 默认 deleteRuntimeConfig；false 表示删除失败

// src/web/ConsoleServer.ts（ConsoleServerOptions 新增）
configSeed?: Partial<GlobalConfig>;
```

前端回调（`settings.tsx` 传入各分区，**这是消除几十行 `setConfig(prev => ({...prev, browser: {...}}))` 样板的关键**）：

```ts
patchBrowser: (patch: Partial<BrowserConfig>) => void;
patchRoot: (patch: Partial<RuntimeConfig>) => void;
```

---

### Task 1: `getLogDir()` + `deleteRuntimeConfig()` + `PERSISTED_KEYS` 导出

**Files:**

- Modify: `src/utils/logger.ts:70-83`（`createDefaultLogFileName`）
- Modify: `src/config/runtimeConfigPersistence.ts:33-37`（`PERSISTED_KEYS`）、追加 `deleteRuntimeConfig()`
- Test: `tests/unit/config/runtimeConfigPersistence.test.ts`

**Interfaces:**

- Consumes: 无（本 Task 是地基）
- Produces: `getLogDir()`、`PERSISTED_KEYS`、`deleteRuntimeConfig()` —— Task 2/3/7 消费

**为什么要先做地基**：`system.ts` 的默认 `logDir` 与 `config.ts` 的导入白名单都依赖这两个导出。跳过这步会让 Task 2/3 各自复制一份目录字面量和白名单常量 —— 那正是 spec §3.3 明令要消除的漂移。

- [ ] **Step 1: 写 `deleteRuntimeConfig()` 的两条失败测试**

在 `tests/unit/config/runtimeConfigPersistence.test.ts` 末尾（`shouldAutoConnectOnStartup` describe 之后、文件末尾的 `});` 之前）追加：

```ts
describe('deleteRuntimeConfig', () => {
  it('removes an existing cache file', () => {
    seedFile({llmProvider: 'openai'});
    assert.ok(existsSync(RUNTIME_CONFIG_PATH));
    deleteRuntimeConfig();
    assert.strictEqual(existsSync(RUNTIME_CONFIG_PATH), false);
  });

  it('does not throw when the cache file is absent', () => {
    if (existsSync(RUNTIME_CONFIG_PATH)) rmSync(RUNTIME_CONFIG_PATH);
    assert.doesNotThrow(() => deleteRuntimeConfig());
  });
});
```

并把顶部导入改成：

```ts
import {
  deleteRuntimeConfig,
  loadCachedRuntimeConfig,
  persistRuntimeConfig,
  RUNTIME_CONFIG_PATH,
  shouldAutoConnectOnStartup,
} from '../../../src/config/runtimeConfigPersistence.js';
```

（注意 `deleteRuntimeConfig` 在字母序上排在 `loadCachedRuntimeConfig` 之前。）

- [ ] **Step 2: 跑测试确认红灯**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/config/runtimeConfigPersistence.test.js`

Expected: FAIL —— `SyntaxError: The requested module does not provide an export named 'deleteRuntimeConfig'`

- [ ] **Step 3: 实现 `getLogDir()` 并让 `createDefaultLogFileName()` 用它**

在 `src/utils/logger.ts` 的 `createDefaultLogFileName` 之前插入：

```ts
/**
 * 默认日志目录：~/.browsercli/log。
 *
 * 纯函数 —— 不参与 `defaultLogHome` 状态判断。导出供 Web 控制台展示
 * （`GET /api/system/info`）与写入共用同一份定义，避免两处目录字面量各自漂移。
 */
export function getLogDir(): string {
  return path.join(os.homedir(), '.browsercli', 'log');
}
```

然后把 `createDefaultLogFileName` 的赋值改成用它：

```ts
state.defaultLogFileName = path.join(getLogDir(), `${datetime}.log`);
```

- [ ] **Step 4: 导出 `PERSISTED_KEYS` 并新增 `deleteRuntimeConfig()`**

在 `src/config/runtimeConfigPersistence.ts` 把：

```ts
const PERSISTED_KEYS = new Set<keyof GlobalConfig>([
```

改成：

```ts
export const PERSISTED_KEYS: ReadonlySet<keyof GlobalConfig> = new Set<
  keyof GlobalConfig
>([
```

然后在文件末尾追加：

```ts
/**
 * 删除缓存文件（供「重置配置」使用）。
 * ENOENT 视为成功（本来就没有缓存），其余错误仅记录到 console 后继续 ——
 * 与 persistRuntimeConfig 的静默风格一致。
 */
export function deleteRuntimeConfig(): void {
  try {
    unlinkSync(RUNTIME_CONFIG_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error('[runtime-config] 删除缓存失败:', err);
  }
}
```

并把顶部导入加上 `unlinkSync`：

```ts
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
```

- [ ] **Step 5: 跑测试确认转绿**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/config/runtimeConfigPersistence.test.js`

Expected: PASS（含原有 9 条 + 新增 2 条）。

- [ ] **Step 6: 提交**

```bash
git add src/utils/logger.ts src/config/runtimeConfigPersistence.ts tests/unit/config/runtimeConfigPersistence.test.ts
git commit -m "feat(config): export PERSISTED_KEYS, add deleteRuntimeConfig and getLogDir"
```

---

### Task 2: 后端 `src/web/routes/system.ts`（环境信息 + 日志）

**Files:**

- Create: `src/web/routes/system.ts`
- Test: `tests/unit/web/routes/system.test.ts`

**Interfaces:**

- Consumes: `getLogDir()`（Task 1）、`sendJson` / `sendError`（`src/web/middleware/error.js`）
- Produces: `createSystemRoutes(cfg: SystemRoutesConfig): Map<string, RouteHandler>`；`SystemInfo` / `LogFileInfo` / `LogContent`（Task 4 会把它们搬到 `src/web/types.ts`，本 Task 先在 `system.ts` 内定义并导出）

**路径穿越防御（两个接口共用）**：`path.basename(file)` → `join(logDir, base)` → `path.relative(logDir, resolved)`，凡以 `..` 开头或为绝对路径一律 400 `LOG_PATH_FORBIDDEN`。与 `ConsoleServer` 静态资源分派（`:242-247`）同一套手法。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/web/routes/system.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {createSystemRoutes} from '../../../../src/web/routes/system.js';

function mockReqRes(method: string, url: string) {
  const req = {
    method,
    url,
    on(_event: string, _cb: (chunk?: Buffer) => void) {
      // system 路由不读 body
    },
  } as never;
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
    end(body?: string | Buffer) {
      this.responseBody = body ?? '';
    },
    responseBody: '' as string | Buffer,
    get headersSent() {
      return false;
    },
  } as never;
  return {
    req,
    res,
    getBody: () =>
      String((res as {responseBody: string | Buffer}).responseBody),
    status: () => (res as {statusCode: number}).statusCode,
    headers: () => (res as {headers: Record<string, string>}).headers,
  };
}

describe('system routes', () => {
  let logDir: string;

  before(() => {
    logDir = mkdtempSync(path.join(os.tmpdir(), 'system-route-test-'));
  });

  after(() => {
    if (existsSync(logDir)) rmSync(logDir, {recursive: true, force: true});
  });

  function routes() {
    return createSystemRoutes({
      version: '9.9.9',
      startedAt: Date.now() - 5000,
      logDir,
      configPath: '/tmp/does-not-exist-runtime-config.json',
    });
  }

  describe('GET /api/system/info', () => {
    it('returns environment fields and log files sorted by mtime desc', () => {
      writeFileSync(path.join(logDir, 'old.log'), 'old', 'utf8');
      writeFileSync(path.join(logDir, 'new.log'), 'new', 'utf8');
      // 保证 mtime 严格递增：直接改写 mtime，避免同毫秒内的平局。
      // 用顶部 import 的 utimesSync —— swc 编译产物是 ESM，
      // 文件内 require('node:fs') 会抛 "require is not defined"（已实测）。
      const past = Date.now() - 60_000;
      utimesSync(path.join(logDir, 'old.log'), new Date(past), new Date(past));

      const handler = routes().get('GET /api/system/info')!;
      const {req, res, getBody} = mockReqRes('GET', '/api/system/info');
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.version, '9.9.9');
      assert.strictEqual(parsed.data.node, process.version);
      assert.strictEqual(parsed.data.platform, process.platform);
      assert.strictEqual(parsed.data.arch, process.arch);
      assert.strictEqual(parsed.data.pid, process.pid);
      assert.ok(parsed.data.uptimeMs >= 5000);
      assert.strictEqual(parsed.data.logDir, logDir);
      assert.strictEqual(
        parsed.data.configPath,
        '/tmp/does-not-exist-runtime-config.json',
      );
      assert.strictEqual(parsed.data.configExists, false);
      assert.deepStrictEqual(
        parsed.data.logFiles.map((f: {name: string}) => f.name).sort(),
        ['new.log', 'old.log'],
      );
      // mtime 倒序：new.log 在前
      assert.strictEqual(parsed.data.logFiles[0].name, 'new.log');
    });

    it('returns empty logFiles when the log directory is absent', () => {
      const missing = path.join(logDir, 'no-such-subdir');
      const handler = createSystemRoutes({
        version: '1.0.0',
        startedAt: Date.now(),
        logDir: missing,
      }).get('GET /api/system/info')!;
      const {req, res, getBody} = mockReqRes('GET', '/api/system/info');
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.data.logFiles, []);
    });
  });

  describe('log path traversal defense', () => {
    it('rejects ../ traversal', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=../runtime-config.json',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_PATH_FORBIDDEN',
      );
    });

    it('rejects absolute paths', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=/etc/passwd',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_PATH_FORBIDDEN',
      );
    });
  });

  describe('GET /api/system/logs', () => {
    it('returns file content', () => {
      writeFileSync(path.join(logDir, 'read.log'), 'hello log', 'utf8');
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody} = mockReqRes(
        'GET',
        '/api/system/logs?file=read.log',
      );
      handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.fileName, 'read.log');
      assert.strictEqual(parsed.data.content, 'hello log');
      assert.strictEqual(parsed.data.truncated, false);
    });

    it('returns 404 when the file does not exist', () => {
      const handler = routes().get('GET /api/system/logs')!;
      const {req, res, getBody, status} = mockReqRes(
        'GET',
        '/api/system/logs?file=nope.log',
      );
      handler(req, res);

      assert.strictEqual(status(), 404);
      assert.strictEqual(
        JSON.parse(getBody()).error.code,
        'LOG_FILE_NOT_FOUND',
      );
    });
  });

  describe('GET /api/system/logs/download', () => {
    it('sets attachment headers and returns plain text', () => {
      writeFileSync(path.join(logDir, 'dl.log'), 'download me', 'utf8');
      const handler = routes().get('GET /api/system/logs/download')!;
      const {req, res, getBody, headers} = mockReqRes(
        'GET',
        '/api/system/logs/download?file=dl.log',
      );
      handler(req, res);

      assert.strictEqual(
        headers()['content-type'],
        'text/plain; charset=utf-8',
      );
      assert.strictEqual(
        headers()['content-disposition'],
        'attachment; filename="dl.log"',
      );
      assert.strictEqual(getBody(), 'download me');
    });

    it('returns 400 on traversal attempts', () => {
      const handler = routes().get('GET /api/system/logs/download')!;
      const {req, res, status} = mockReqRes(
        'GET',
        '/api/system/logs/download?file=../secret.log',
      );
      handler(req, res);

      assert.strictEqual(status(), 400);
    });
  });
});
```

> **已实测的坑（别踩）**：swc 把 `tests/**` 编译成 ESM，文件内写 `require('node:fs')` 会抛 `ReferenceError: require is not defined in ES module scope`。所以上面用**顶部 import** 的 `utimesSync`，不要用 `require`。

- [ ] **Step 2: 跑测试确认红灯**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/routes/system.test.js`

Expected: FAIL —— `Cannot find module '../../../../src/web/routes/system.js'`

- [ ] **Step 3: 实现 `src/web/routes/system.ts`**

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 系统信息 + 日志 REST 路由
 *
 *  GET /api/system/info            — 版本 / 运行环境 / 日志目录与文件列表 / 配置文件路径
 *  GET /api/system/logs            — ?file=<name>，省略取最新。JSON 信封 LogContent
 *  GET /api/system/logs/download   — ?file=<name>。text/plain + attachment，走浏览器原生下载
 */

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {basename, isAbsolute, join, resolve} from 'node:path';

import {RUNTIME_CONFIG_PATH} from '../../config/runtimeConfigPersistence.js';
import {getLogDir} from '../../utils/logger.js';
import {sendError, sendJson} from '../middleware/error.js';

/** 单次日志读取上限（尾部截断） */
const MAX_LOG_READ_BYTES = 1 * 1024 * 1024;

/** info 接口返回的日志文件条目上限 */
const MAX_LOG_FILES = 20;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface SystemRoutesConfig {
  /** package.json 版本号；ConsoleServer 读出后注入 */
  version: string;
  /** 进程启动时间戳（ms） */
  startedAt: number;
  /** 运行时配置文件路径，默认 RUNTIME_CONFIG_PATH */
  configPath?: string;
  /** 日志目录，默认 getLogDir()。测试注入 tmpdir。 */
  logDir?: string;
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeMs: number;
  logDir: string;
  logFiles: LogFileInfo[];
  configPath: string;
  configExists: boolean;
}

export interface LogContent {
  fileName: string;
  content: string;
  truncated: boolean;
}

/**
 * 把用户提供的文件名解析为日志目录内的绝对路径。
 * 返回 undefined 表示路径穿越（调用方返回 400）。
 *
 * 注意顺序：**先校验形状，再 basename**。
 * 早先的写法是 `join(logDir, basename(file))` —— 但 `basename('../x.json')`
 * 已经是 `'x.json'` 了，结果永远落在 logDir 内，下面的 relative 检查
 * 永远不触发，`LOG_PATH_FORBIDDEN` 成了不可达代码（三条测试会红）。
 * 虽然穿越本身仍被 basename 挡住（不会真的读出去），但返回的是 404 而不是
 * spec §6 要求的 400，且给人一种“检查生效了”的错觉。
 */
function resolveLogFile(logDir: string, file: string): string | undefined {
  if (!file || isAbsolute(file) || file !== basename(file)) return undefined;
  return resolve(join(logDir, file));
}

/** 读取日志文件尾部内容，超出 MAX_LOG_READ_BYTES 则截断 */
function readLogTail(filePath: string): LogContent {
  const stat = statSync(filePath);
  const start = Math.max(0, stat.size - MAX_LOG_READ_BYTES);
  const size = stat.size - start;
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size);
    readSync(fd, buf, 0, size, start);
    return {
      fileName: basename(filePath),
      content: buf.toString('utf8'),
      truncated: start > 0,
    };
  } finally {
    closeSync(fd);
  }
}

/** 列出日志文件（mtime 倒序，最多 MAX_LOG_FILES 条）。目录不存在返回 []。 */
function listLogFiles(logDir: string): LogFileInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(logDir);
  } catch (err) {
    // 目录不存在 = 还没产生过日志，是正常状态；
    // 其它错误（EACCES / EIO）必须抛出 → RestRouter 转成 500 LOG_DIR_READ_FAILED。
    // 早先这里是 `catch { return [] }`，把“目录不可读”伪装成“暂无日志文件”，
    // 用户在通用页看到空列表，而日志其实存在且读不出来。
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const files = entries
    .filter(name => name.endsWith('.log'))
    .map(name => {
      const full = join(logDir, name);
      // 逐个 stat 也要兜住：readdir 与 stat 之间文件可能被轮转删除
      try {
        const stat = statSync(full);
        if (!stat.isFile()) return null;
        return {name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs};
      } catch {
        return null;
      }
    })
    .filter((f): f is LogFileInfo => f !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files.slice(0, MAX_LOG_FILES);
}

export function createSystemRoutes(
  cfg: SystemRoutesConfig,
): Map<string, RouteHandler> {
  const logDir = cfg.logDir ?? getLogDir();
  const configPath = cfg.configPath ?? RUNTIME_CONFIG_PATH;

  return new Map<string, RouteHandler>([
    [
      'GET /api/system/info',
      (_req, res) => {
        sendJson(res, {
          version: cfg.version,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptimeMs: Date.now() - cfg.startedAt,
          logDir,
          logFiles: listLogFiles(logDir),
          configPath,
          configExists: existsSync(configPath),
        } satisfies SystemInfo);
      },
    ],

    [
      'GET /api/system/logs',
      (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const rawFile = url.searchParams.get('file');

        let target: string;
        if (rawFile) {
          const resolvedPath = resolveLogFile(logDir, rawFile);
          if (!resolvedPath) {
            sendError(res, 'LOG_PATH_FORBIDDEN', '非法的日志文件名', 400);
            return;
          }
          if (!existsSync(resolvedPath)) {
            sendError(res, 'LOG_FILE_NOT_FOUND', '日志文件不存在', 404);
            return;
          }
          target = resolvedPath;
        } else {
          const latest = listLogFiles(logDir)[0];
          if (!latest) {
            sendError(res, 'LOG_FILE_NOT_FOUND', '暂无日志文件', 404);
            return;
          }
          target = join(logDir, latest.name);
        }

        try {
          sendJson(res, readLogTail(target));
        } catch (err) {
          sendError(
            res,
            'LOG_FILE_READ_FAILED',
            err instanceof Error ? err.message : String(err),
            500,
          );
        }
      },
    ],

    [
      'GET /api/system/logs/download',
      (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const rawFile = url.searchParams.get('file') ?? '';
        const target = resolveLogFile(logDir, rawFile);
        if (!target) {
          sendError(res, 'LOG_PATH_FORBIDDEN', '非法的日志文件名', 400);
          return;
        }
        if (!existsSync(target)) {
          sendError(res, 'LOG_FILE_NOT_FOUND', '日志文件不存在', 404);
          return;
        }

        try {
          const {content} = readLogTail(target);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${basename(target)}"`,
          );
          res.end(content);
        } catch (err) {
          sendError(
            res,
            'LOG_FILE_READ_FAILED',
            err instanceof Error ? err.message : String(err),
            500,
          );
        }
      },
    ],
  ]);
}
```

把顶部导入补上同步文件 API：

```ts
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
```

> 上面这份 import 列表已经是最终的：`readLogTail` 用 `openSync`/`readSync`/`closeSync`，
> 列表里没有 `readFileSync`（早先版本曾误列它，会被 `@typescript-eslint/no-unused-vars` 报错）。
> 同理，`resolveLogFile` 不再用 `relative`，所以 `node:path` 的导入里没有它。
>
> 实现顺序提示：**先按上面的 import 写文件，再跑测试**。不要在“跑测试”之后再去补 import ——
> 那样会先撞 `ReferenceError: openSync is not defined`，白白多一轮。

- [ ] **Step 4: 跑测试确认转绿**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/routes/system.test.js`

Expected: PASS（7 条）。

- [ ] **Step 5: 文件级门禁**

```bash
npx prettier --check src/web/routes/system.ts tests/unit/web/routes/system.test.ts && npx eslint src/web/routes/system.ts tests/unit/web/routes/system.test.ts
```

有报错跑 `npx eslint --fix <file>` 后重跑。

- [ ] **Step 6: 提交**

```bash
git add src/web/routes/system.ts tests/unit/web/routes/system.test.ts
git commit -m "feat(web): add system info and log routes"
```

---

### Task 3: `config.ts` 追加 export / import / reset 三条路由

**Files:**

- Modify: `src/web/routes/config.ts`
- Test: `tests/unit/web/routes/config.test.ts`

**Interfaces:**

- Consumes: `PERSISTED_KEYS`、`deleteRuntimeConfig()`（Task 1）、`resetRuntimeConfigStore`、`isMaskPlaceholder`、`maskSensitiveFields`（本文件已有）
- Produces: `GET /api/config/export`、`POST /api/config/import`、`POST /api/config/reset` —— Task 7 前端消费

**`import` 是合并语义，不是替换**（spec §3.5 已拍板）：直接复用现有 `update()` 的 `DEEP_MERGE_KEYS` 浅合并，不给 `RuntimeConfigStore` 加 `replace()`。

- [ ] **Step 1: 写 export 的失败测试**

在 `tests/unit/web/routes/config.test.ts` 末尾（`POST /api/llm/models` describe 之后、文件末尾 `});` 之前）追加：

```ts
describe('GET /api/config/export', () => {
  it('contains only PERSISTED_KEYS with a masked apiKey', () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-export1234', model: 'gpt-4o'},
      llmProvider: 'openai',
      browser: {headless: true},
      rpcHost: 'ws://fixed:5612',
    });

    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
    } as never);

    const handler = routes.get('GET /api/config/export')!;
    const {req, res, getBody} = mockReqRes('GET');
    handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.ok(parsed.success);
    // 只含白名单三项
    assert.deepStrictEqual(Object.keys(parsed.data).sort(), [
      'browser',
      'llmProvider',
      'openai',
    ]);
    // apiKey 恒掩码
    assert.strictEqual(parsed.data.openai.apiKey, 'sk-***1234');
    // 启动期固定值不导出
    assert.strictEqual(parsed.data.rpcHost, undefined);
  });
});
```

- [ ] **Step 2: 跑测试确认红灯**

Run: `npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/routes/config.test.js`

Expected: FAIL —— `handler is not a function`（`routes.get(...)` 返回 `undefined`）

- [ ] **Step 3: 实现 export 路由**

在 `src/web/routes/config.ts` 的 `createConfigRoutes` 返回的 Map 里，`'GET /api/config'` 之后插入：

```ts
    [
      'GET /api/config/export',
      (_req, res) => {
        const current = getRuntimeConfigStore().get() as Record<string, unknown>;
        const exported: Record<string, unknown> = {};
        for (const key of PERSISTED_KEYS) {
          if (current[key] !== undefined) exported[key] = current[key];
        }
        sendJson(res, maskSensitiveFields(exported as GlobalConfig));
      },
    ],
```

并把顶部导入更新：

```ts
import {
  deleteRuntimeConfig,
  persistRuntimeConfig,
  PERSISTED_KEYS,
} from '../../config/runtimeConfigPersistence.js';
import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../config/RuntimeConfigStore.js';
```

- [ ] **Step 4: 跑测试确认转绿**

Run: 同 Step 2 命令。Expected: PASS（含新增 1 条）。

- [ ] **Step 5: 写 import 的失败测试**

继续追加：

```ts
describe('POST /api/config/import', () => {
  it('merges with current values instead of replacing', async () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-current1234', model: 'gpt-4o'},
      llmProvider: 'openai',
      browser: {headless: true, channel: 'stable'},
    });

    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
    } as never);

    const handler = routes.get('POST /api/config/import')!;
    const {req, res, getBody} = mockReqRes('POST', {
      llmProvider: 'openai',
      openai: {model: 'gpt-4o-mini'},
    });
    await handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.ok(parsed.success);
    // 传入的 model 覆盖
    assert.strictEqual(
      getRuntimeConfigStore().get().openai?.model,
      'gpt-4o-mini',
    );
    // 未传入的 browser 保留当前值（合并语义，非替换）
    assert.deepStrictEqual(getRuntimeConfigStore().get().browser, {
      headless: true,
      channel: 'stable',
    });
  });

  it('keeps the stored apiKey when the payload carries a mask placeholder', async () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-real1234', model: 'gpt-4o'},
      llmProvider: 'openai',
    });

    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
    } as never);

    const handler = routes.get('POST /api/config/import')!;
    const {req, res, getBody} = mockReqRes('POST', {
      llmProvider: 'openai',
      openai: {apiKey: 'sk-***1234', model: 'gpt-4o-mini'},
    });
    await handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.ok(parsed.success);
    // 掩码占位符不覆盖真实密钥
    assert.strictEqual(
      getRuntimeConfigStore().get().openai?.apiKey,
      'sk-real1234',
    );
    assert.strictEqual(
      getRuntimeConfigStore().get().openai?.model,
      'gpt-4o-mini',
    );
  });

  it('rejects a payload that fails schema validation with 400', async () => {
    resetRuntimeConfigStore({llmProvider: 'openai'});

    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
    } as never);

    const handler = routes.get('POST /api/config/import')!;
    const {req, res, getBody} = mockReqRes('POST', {
      llmProvider: 'not-a-provider',
    });
    await handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'VALIDATION');
  });

  it('calls the injected persist callback after importing', async () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-persist1234', model: 'gpt-4o'},
      llmProvider: 'openai',
    });

    let persistCalls = 0;
    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: () => {
        persistCalls += 1;
      },
    } as never);

    const handler = routes.get('POST /api/config/import')!;
    const {req, res} = mockReqRes('POST', {
      llmProvider: 'openai',
      openai: {model: 'gpt-4o-mini'},
    });
    await handler(req, res);

    assert.strictEqual(persistCalls, 1);
  });
});
```

- [ ] **Step 6: 跑测试确认红灯**

Run: 同 Step 2 命令。Expected: FAIL —— `handler is not a function`

- [ ] **Step 7: 实现 import 路由**

插入：

```ts
    [
      'POST /api/config/import',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(
            res,
            code,
            code === 'PAYLOAD_TOO_LARGE'
              ? '请求体超过 1MB 上限'
              : '请求体不是合法 JSON',
            code === 'PAYLOAD_TOO_LARGE' ? 413 : 400,
          );
          return;
        }

        const parseResult = GlobalConfigSchema.safeParse(body);
        if (!parseResult.success) {
          sendError(
            res,
            'VALIDATION',
            formatConfigValidationError(parseResult.error),
            400,
          );
          return;
        }

        const validated = parseResult.data as Record<string, unknown>;
        const current = getRuntimeConfigStore().get() as Record<string, unknown>;
        const update: Record<string, unknown> = {};

        for (const key of PERSISTED_KEYS) {
          if (validated[key] === undefined) continue;
          const incoming = validated[key] as Record<string, unknown>;
          if (key === 'openai') {
            // 掩码占位符不覆盖真实密钥（与 PUT /api/config/llm 一致）
            update.openai = mergeLlmProvider(
              incoming,
              current.openai as Record<string, unknown> | undefined,
            );
          } else {
            update[key] = incoming;
          }
        }

        const updated = getRuntimeConfigStore().update(update as Partial<GlobalConfig>);
        (cfg.persist ?? persistRuntimeConfig)(updated);
        sendJson(res, maskSensitiveFields(updated));
      },
    ],
```

顶部导入补上 `GlobalConfigSchema`：

```ts
import {
  BrowserConfigSchema,
  formatConfigValidationError,
  GlobalConfigSchema,
} from '../../config/schema.js';
```

- [ ] **Step 8: 跑测试确认转绿**

Run: 同 Step 2 命令。Expected: PASS（含新增 5 条）。

- [ ] **Step 9: 写 reset 的失败测试**

继续追加：

```ts
describe('POST /api/config/reset', () => {
  it('deletes the cache file and reseeds from env plus the CLI seed', () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-dirty1234', model: 'dirty-model'},
      browser: {headless: false},
    });

    let deleteCalls = 0;
    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
      deleteConfig: () => {
        deleteCalls += 1;
        return true;
      },
      configSeed: {headless: true},
    } as never);

    const handler = routes.get('POST /api/config/reset')!;
    const {req, res, getBody} = mockReqRes('POST', {});
    handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.ok(parsed.success);
    assert.strictEqual(deleteCalls, 1);

    // 重置后回到 configFromEnv() + configSeed 的合并结果，旧值被丢弃。
    // 注意：configFromEnv() 会读开发者机器上真实的 OPENAI_* / BROWSER_* 环境变量，
    // 所以断言必须拿 configFromEnv() 的返回值当基准，不能写死 undefined ——
    // 否则任何设置了 OPENAI_MODEL 的机器都会让这条测试红。
    const stored = getRuntimeConfigStore().get();
    const envSeed = configFromEnv();
    assert.strictEqual(stored.openai?.model, envSeed.openai?.model);
    // configSeed 覆盖 env / 旧值
    assert.strictEqual(stored.headless, true);
    // 旧值已被丢弃（'dirty-model' 不是 env 值时才有意义，故用不等断言兜底）
    assert.notStrictEqual(stored.openai?.apiKey, 'sk-dirty1234');
  });

  it('returns 500 and skips the reset when the cache delete fails', () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-keepme1234', model: 'keep-model'},
      browser: {headless: false},
    });

    const routes = createConfigRoutes({
      contextProvider: null,
      wsHub: null,
      persist: noopPersist,
      // 模拟 EPERM/EBUSY：文件删不掉
      deleteConfig: () => false,
      configSeed: {headless: true},
    } as never);

    const handler = routes.get('POST /api/config/reset')!;
    const {req, res, getBody} = mockReqRes('POST', {});
    handler(req, res);

    const parsed = JSON.parse(getBody());
    assert.strictEqual(parsed.success, false);
    assert.strictEqual(parsed.error.code, 'CONFIG_DELETE_FAILED');
    // 关键：删除失败时 store 必须原封不动（不能“半重置”）
    const stored = getRuntimeConfigStore().get();
    assert.strictEqual(stored.openai?.apiKey, 'sk-keepme1234');
    assert.strictEqual(stored.headless, false);
  });
});
```

> 两条 reset 用例的 `deleteConfig` 注入都必须返回 `boolean`（`true` / `false`）。
> 签名是 `() => boolean` 而不是 `() => void` —— 这个返回值就是上面那条 500 分支的唯一依据，
> 写成 `void` 会让“删除失败”永远无法被感知，静默把旧配置（含 apiKey）留到下次启动。

> 测试顶部需补 `configFromEnv` 的导入：
>
> ```ts
> import {configFromEnv} from '../../../../src/config/resolver.js';
> ```

- [ ] **Step 10: 跑测试确认红灯**

Run: 同 Step 2 命令。Expected: FAIL —— `handler is not a function`

- [ ] **Step 11: 实现 reset 路由 + `ConfigRoutesConfig` 新字段**

在 `ConfigRoutesConfig` 的 `persist` 之后追加：

```ts
  /**
   * 重置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果。
   * 未注入时 reset 只回到 configFromEnv()。
   */
  configSeed?: Partial<GlobalConfig>;
  /** 删除缓存文件，默认 deleteRuntimeConfig。测试注入 no-op。 */
  /**
   * 删除缓存文件，默认 deleteRuntimeConfig。测试注入 no-op。
   * 返回 false 表示删除失败（EPERM/EBUSY 等）—— reset 路由必须据此报错，
   * 不能仍返回 200，否则“重置”是假的：文件还在，下次启动会重新播种旧配置
   * （含 apiKey）。
   */
  deleteConfig?: () => boolean;
```

插入路由：

```ts
    [
      'POST /api/config/reset',
      (_req, res) => {
        // 删除失败必须中断：否则返回 200 而文件仍在，下次启动重新播种旧配置
        if (!(cfg.deleteConfig ?? deleteRuntimeConfig)()) {
          sendError(
            res,
            'CONFIG_DELETE_FAILED',
            '配置缓存文件删除失败，未执行重置',
            500,
          );
          return;
        }
        resetRuntimeConfigStore({
          ...configFromEnv(),
          ...cfg.configSeed,
        });
        sendJson(res, maskSensitiveFields(getRuntimeConfigStore().get()));
      },
    ],
```

顶部导入补上 `configFromEnv`：

```ts
import {configFromEnv} from '../../config/resolver.js';
```

- [ ] **Step 12: 跑测试确认转绿**

Run: 同 Step 2 命令。Expected: PASS（含新增 6 条）。

- [ ] **Step 13: 文件级门禁**

```bash
npx prettier --check src/web/routes/config.ts tests/unit/web/routes/config.test.ts && npx eslint src/web/routes/config.ts tests/unit/web/routes/config.test.ts
```

- [ ] **Step 14: 提交**

```bash
git add src/web/routes/config.ts tests/unit/web/routes/config.test.ts
git commit -m "feat(web): add config export, import and reset routes"
```

---

### Task 4: 协议类型 —— `src/web/types.ts` 与前端 `api.ts` / `protocol.ts`

**Files:**

- Modify: `src/web/types.ts`
- Modify: `src/web-ui/src/lib/protocol.ts`
- Modify: `src/web-ui/src/lib/api.ts`

**Interfaces:**

- Consumes: `SystemInfo` / `LogFileInfo` / `LogContent`（Task 2 已在 `system.ts` 内定义）
- Produces: 前端可见的类型 + `api.getSystemInfo()` / `getSystemLog(file?)` / `exportConfig()` / `importConfig(cfg)` / `resetConfig()` —— Task 7/8 消费

**已在实测中验证**：`src/web/types.ts` 可以 `import type` 自 `src/config/schema.ts`，`npm run web:typecheck` 仍通过（前端 tsconfig 会跟随 include 一起编译 `src/web/types.ts`）。因此本 Task 让 `web/types.ts` 直接复用 schema 导出的 `BrowserConfig` / `GlobalConfig`，避免 `RuntimeConfig` 与 schema 各写一份。

- [ ] **Step 1: 在 `src/web/types.ts` 追加系统类型并复用 schema 类型**

在文件末尾追加：

```ts
// ==================== System Info & Logs ====================

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface SystemInfo {
  version: string;
  node: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeMs: number;
  logDir: string;
  logFiles: LogFileInfo[];
  configPath: string;
  configExists: boolean;
}

export interface LogContent {
  fileName: string;
  content: string;
  truncated: boolean;
}

/**
 * `GET /api/config/export` 的响应体 —— 只含 PERSISTED_KEYS 三项，apiKey 恒掩码。
 * import 直接把这个结构 POST 回去（合并语义）。
 */
export interface ExportedConfig {
  llmProvider?: GlobalConfig['llmProvider'];
  openai?: GlobalConfig['openai'];
  browser?: BrowserConfig;
}
```

同时，在 `src/web/types.ts` 顶部（`ApiResponse` 之前）插入：

```ts
import type {BrowserConfig, GlobalConfig} from '../config/schema.js';
```

> **为什么用 schema 的类型而不是 `RuntimeConfig`**：`RuntimeConfig` 定义在前端 `src/web-ui/src/lib/protocol.ts`，后端 `src/web/types.ts` 看不到它 —— 写成 `RuntimeConfig['openai']` 会直接编译失败。
>
> **已实测（本计划编写时跑过探针）**：这条 `import type` 不会破坏 `npm run web:typecheck`。前端 tsconfig 会跟随 include 一并编译 `src/web/types.ts`，而 schema 是纯类型文件，无副作用。
>
> 另注：`config/schema.ts` **没有**导出 `OpenAIConfig`（只有 `AIConfig`），所以 openai 字段用 `GlobalConfig['openai']`，不要写 `OpenAIConfig`。
>
> 退路（仅在上面这条 import 真的导致 web:typecheck 失败时用）：在 `types.ts` 内联写死这三项的字面类型，代价是与 schema 漂移。若走到退路，请在报告里说明。

- [ ] **Step 2: 跑前端类型检查确认没坏**

Run: `npm run web:typecheck && npm run typecheck`

Expected: 两条均 PASS（本步只加类型，无实现，应无新增报错）。

- [ ] **Step 3: 前端 `protocol.ts` 的 `BrowserConfig` 补 11 个新字段**

把 `src/web-ui/src/lib/protocol.ts` 里的 `BrowserConfig` 接口替换为：

```ts
export interface BrowserConfig {
  headless?: boolean;
  isolated?: boolean;
  executablePath?: string;
  channel?: string;
  useStealthScripts?: boolean;
  jsStealth?: boolean;
  cloak?: boolean;
  fullStealthArgs?: boolean;
  minimalStealth?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  userDataDir?: string;
  args?: string[];
  devtools?: boolean;
  autoLaunch?: boolean;
  userAgent?: string;
  // ↓ 本次新增：补齐 schema 已有但 UI 不可达的字段
  viewport?: {width: number; height: number};
  waitForBrowserTimeoutMs?: number;
  timeout?: number;
  maxCollectedUrls?: number;
  maxFilesPerCollect?: number;
  maxTotalContentSize?: number;
  maxSingleFileSize?: number;
}
```

`RuntimeConfig`、`OpenAIConfig`、`ConnectResult`、`LlmTestResult` 一律不动。

- [ ] **Step 4: `runtimeConfig` 前端类型不需要改**

`RuntimeConfig` 已有 `browser?: BrowserConfig`，Step 3 的改动自动生效。跳过。

- [ ] **Step 5: 前端 `api.ts` 追加 5 个方法**

在 `src/web-ui/src/lib/api.ts` 的 `updateLlmConfig` 之后插入：

```ts
  getSystemInfo(): Promise<SystemInfo> {
    return request<SystemInfo>('GET', '/api/system/info');
  },

  getSystemLog(file?: string): Promise<LogContent> {
    const query = file ? `?file=${encodeURIComponent(file)}` : '';
    return request<LogContent>('GET', `/api/system/logs${query}`);
  },

  exportConfig(): Promise<ExportedConfig> {
    return request<ExportedConfig>('GET', '/api/config/export');
  },

  importConfig(config: ExportedConfig): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('POST', '/api/config/import', config);
  },

  resetConfig(): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('POST', '/api/config/reset', {});
  },
```

并把顶部 type import 补上四个新类型：

```ts
import type {
  ApiResponse,
  ExportedConfig,
  LogContent,
  RuntimeConfig,
  SystemInfo,
  WorkerFullStatus,
  InvocationRecord,
  BrowserConfig,
  ConnectResult,
  LlmTestResult,
  ProxyStatusPayload,
  ListMitmRequestsData,
  GetMitmRequestData,
  SessionRequestSummaryEvent,
  SessionRequestDetail,
  SessionAnalysisPayload,
} from './protocol';
```

> **下载不走 `api.ts`**：日志下载直接用 `<a href="/api/system/logs/download?file=...">` 触发浏览器原生下载，与 `CaCertModal.tsx:73-82` 的证书下载一致。

- [ ] **Step 6: 跑前端类型检查确认转绿**

Run: `npm run web:typecheck`

Expected: PASS。若报 unused import，删掉未使用的那个。

- [ ] **Step 7: 提交**

```bash
git add src/web/types.ts src/web-ui/src/lib/protocol.ts src/web-ui/src/lib/api.ts
git commit -m "feat(web): add system/export protocol types and api methods"
```

---

### Task 5: `Field.tsx` 共享原语 + 三个配置分区组件

**Files:**

- Create: `src/web-ui/src/components/settings/Field.tsx`
- Create: `src/web-ui/src/components/settings/BrowserSection.tsx`
- Create: `src/web-ui/src/components/settings/AntiDetectSection.tsx`
- Create: `src/web-ui/src/components/settings/CollectionSection.tsx`

**Interfaces:**

- Consumes: `BrowserConfig` / `RuntimeConfig`（Task 4）
- Produces: `Field`、`inputClass`、`labelClass`、`BrowserSection`、`AntiDetectSection`、`CollectionSection` —— Task 6/8 消费

**`Field.tsx` 只导出 `Field` 与两个 className 常量**，输入控件仍是原生 `<input>` / `<select>` —— 不造 Input/Select/Switch 四个包装组件，不引入表单库（spec §4.2）。

- [ ] **Step 1: 创建 `Field.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {ReactNode} from 'react';

/** 输入框共享 className（尺寸 + 配色 + 边框） */
export const inputClass =
  'bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]';

/** 字段标签共享 className */
export const labelClass = 'text-xs text-[var(--color-text-secondary)]';

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

/**
 * 字段包装器：标签 + 可选说明 + 控件。
 * 只管布局，不含任何输入控件 —— 控件用原生 input/select，避免引入表单库。
 */
export function Field({label, hint, children}: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && (
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}
```

- [ ] **Step 2: 创建 `BrowserSection.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Globe, Plug, PlugZap, Save} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';
import {Field, inputClass} from './Field';

interface BrowserSectionProps {
  browser: BrowserConfig | undefined;
  connected: boolean;
  saving: boolean;
  busy: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function BrowserSection({
  browser,
  connected,
  saving,
  busy,
  patchBrowser,
  onSave,
  onConnect,
  onDisconnect,
}: BrowserSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe
            className={
              connected
                ? 'text-[var(--color-status-green)]'
                : 'text-[var(--color-text-muted)]'
            }
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            浏览器连接
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            connected
              ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
              : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-text-muted)]'}`}
          />
          {connected ? '已连接' : '未连接'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Headless">
          <select
            value={browser?.headless ? 'true' : 'false'}
            onChange={e => patchBrowser({headless: e.target.value === 'true'})}
            className={inputClass}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </Field>

        <Field label="Channel">
          <select
            value={browser?.channel ?? ''}
            onChange={e => {
              // 空选项 = 不提交该字段（保留服务端现值），不做清空。
              // 不要写 {channel: undefined} —— 详见 viewport 处的说明。
              if (!e.target.value) return;
              patchBrowser({channel: e.target.value});
            }}
            className={inputClass}
          >
            <option value="">默认（内置浏览器）</option>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
            <option value="dev">dev</option>
            <option value="canary">canary</option>
            <option value="chromium">chromium</option>
            <option value="bidi-chromium">bidi-chromium</option>
            <option value="bidi-chrome">bidi-chrome</option>
            <option value="bidi-chrome-beta">bidi-chrome-beta</option>
            <option value="bidi-chrome-dev">bidi-chrome-dev</option>
            <option value="bidi-chrome-canary">bidi-chrome-canary</option>
            <option value="firefox">firefox</option>
            <option value="moz-firefox">moz-firefox</option>
          </select>
        </Field>

        <Field
          label="Browser URL"
          hint="已运行的浏览器 CDP 地址，保存后下次启动会自动连接"
        >
          <input
            type="text"
            value={browser?.browserURL ?? ''}
            onChange={e => patchBrowser({browserURL: e.target.value})}
            placeholder="http://127.0.0.1:9222"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="WS Endpoint">
          <input
            type="text"
            value={browser?.wsEndpoint ?? ''}
            onChange={e => patchBrowser({wsEndpoint: e.target.value})}
            placeholder="ws://127.0.0.1:9222/devtools/browser/..."
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="Executable Path">
          <input
            type="text"
            value={browser?.executablePath ?? ''}
            onChange={e => patchBrowser({executablePath: e.target.value})}
            placeholder="/path/to/chrome"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={browser?.isolated ?? true}
            onChange={e => patchBrowser({isolated: e.target.checked})}
            className="accent-[var(--color-accent)]"
          />
          <span className="text-xs text-[var(--color-text-secondary)]">
            Isolated Context
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={12} />
          {saving ? '保存中...' : '保存本区配置'}
        </button>
        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <PlugZap size={12} />
            {busy ? '断开中...' : '断开连接'}
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plug size={12} />
            {busy ? '连接中...' : '连接浏览器'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `AntiDetectSection.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Shield} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';
import {Field, inputClass} from './Field';

interface AntiDetectSectionProps {
  browser: BrowserConfig | undefined;
  saving: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
}

interface ToggleSpec {
  key:
    | 'cloak'
    | 'jsStealth'
    | 'fullStealthArgs'
    | 'minimalStealth'
    | 'useStealthScripts';
  label: string;
  /** 该项的检测面代价说明，tooltip 展示 */
  cost: string;
}

const TOGGLES: ToggleSpec[] = [
  {
    key: 'cloak',
    label: 'Cloak 二进制',
    cost: '启用 CloakBrowser 二进制 + 49 个 C++ 源码层指纹 patch，profile 目录切到 cloak-profile。默认关闭。',
  },
  {
    key: 'jsStealth',
    label: 'JS 反检测脚本',
    cost: '注入 StealthScripts2025，覆盖 navigator / canvas / WebGL / audio。Object.defineProperty 本身即是检测信号，默认关闭。',
  },
  {
    key: 'fullStealthArgs',
    label: '完整启动参数集',
    cost: '使用历史 60+ 启动参数集，其中多个 flag 本身已是反爬检测信号（--window-size、--disable-blink-features 等）。默认关闭。',
  },
  {
    key: 'minimalStealth',
    label: '最小启动参数集',
    cost: '仅 --test-type + --hide-crash-restore-bubble。默认开启。',
  },
  {
    key: 'useStealthScripts',
    label: 'Stealth 脚本（旧名）',
    cost: 'jsStealth 的旧别名，两者任一为 true 即注入。默认关闭。',
  },
];

export function AntiDetectSection({
  browser,
  saving,
  patchBrowser,
  onSave,
}: AntiDetectSectionProps) {
  const viewport = browser?.viewport;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          反检测
        </h2>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        以下开关全部保持各自默认值，本页只暴露不修改默认语义。开启任一项都会扩大
        检测面，请确认目标站点需要后再启用。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOGGLES.map(spec => (
          <label
            key={spec.key}
            title={spec.cost}
            className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] cursor-pointer"
          >
            <input
              type="checkbox"
              checked={browser?.[spec.key] ?? false}
              onChange={e => patchBrowser({[spec.key]: e.target.checked})}
              className="accent-[var(--color-accent)] mt-0.5"
            />
            <span className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-secondary)]">
                {spec.label}
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                {spec.cost}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t border-[var(--color-border-muted)] pt-4 space-y-4">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          浏览器指纹
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="User Agent">
            <input
              type="text"
              value={browser?.userAgent ?? ''}
              onChange={e => patchBrowser({userAgent: e.target.value})}
              placeholder="留空使用浏览器默认 UA"
              className={`${inputClass} font-mono`}
            />
          </Field>

          <Field
            label="Viewport（宽 × 高）"
            hint="两个都填才会提交；留空表示不修改（本页不支持清空已存值）"
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={viewport?.width ?? ''}
                onChange={e => {
                  const width = Number(e.target.value);
                  const height = viewport?.height;
                  // 两个数字框任一为空 → 不提交（见下方「清空字段」说明）
                  if (!e.target.value || !height) return;
                  patchBrowser({viewport: {width, height}});
                }}
                placeholder="宽"
                className={`${inputClass} font-mono flex-1`}
              />
              <span className="text-xs text-[var(--color-text-muted)]">×</span>
              <input
                type="number"
                min={1}
                value={viewport?.height ?? ''}
                onChange={e => {
                  const height = Number(e.target.value);
                  const width = viewport?.width;
                  if (!e.target.value || !width) return;
                  patchBrowser({viewport: {width, height}});
                }}
                placeholder="高"
                className={`${inputClass} font-mono flex-1`}
              />
            </div>
          </Field>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存本区配置'}
        </button>
      </div>
    </div>
  );
}
```

> **「清空字段」在本页不支持 —— 这是刻意的，不要试图用 `undefined` 实现它。**
>
> 早先的写法是在数字框为空时 `patchBrowser({viewport: undefined})`，理由是
> “`undefined` 会被 `update()` 跳过，于是不写入该键”。**这个推理是错的**，已实测：
>
> ```
> seeded   : {"channel":"stable","viewport":{"width":1280,"height":720}}
> over wire: {}          ← JSON.stringify 直接把 viewport 键丢掉了
> after    : {"channel":"stable","viewport":{"width":1280,"height":720}}
> CLEARED? : false
> ```
>
> 原因：`JSON.stringify` 会丢弃 `undefined` 值的键，于是 wire 上是一个空 patch，
> `update()` 的浅合并 `{...old, ...new}` 原样保留旧 `viewport`。结果是**界面显示空、
> 实际配置仍有值**——比不做更糟，因为它骗人。
>
> 结论（本计划的取舍）：
>
> - 空输入 = **不提交该字段**（保留服务端现值），这是本页的语义；
> - 不提供“清空”入口。清空需要后端支持显式删除语义（例如 `update()` 识别
>   `null` 并 `delete merged[key]`），那是 spec 之外的改动，本轮不做；
> - 同理，`channel` 的空选项与采集限制的空输入也一律按“不提交”处理，
>   **不要**写 `{key: undefined}`。

- [ ] **Step 4: 创建 `CollectionSection.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Gauge} from 'lucide-react';

import type {BrowserConfig} from '../../lib/protocol';
import {Field, inputClass} from './Field';

interface CollectionSectionProps {
  browser: BrowserConfig | undefined;
  saving: boolean;
  patchBrowser: (patch: Partial<BrowserConfig>) => void;
  onSave: () => void;
}

interface NumberSpec {
  key:
    | 'maxCollectedUrls'
    | 'maxFilesPerCollect'
    | 'maxTotalContentSize'
    | 'maxSingleFileSize'
    | 'timeout'
    | 'waitForBrowserTimeoutMs';
  label: string;
  hint: string;
}

const NUMBERS: NumberSpec[] = [
  {
    key: 'maxCollectedUrls',
    label: '最大采集 URL 数',
    hint: '单次采集最多收集的 URL 数量',
  },
  {
    key: 'maxFilesPerCollect',
    label: '单次最大文件数',
    hint: '单次采集最多落盘的文件数量',
  },
  {
    key: 'maxTotalContentSize',
    label: '总内容大小上限（字节）',
    hint: '单次采集的内容总量上限',
  },
  {
    key: 'maxSingleFileSize',
    label: '单文件大小上限（字节）',
    hint: '超过此大小的单个文件不落盘',
  },
  {
    key: 'timeout',
    label: '超时时间（ms）',
    hint: '浏览器操作默认超时',
  },
  {
    key: 'waitForBrowserTimeoutMs',
    label: '等待浏览器超时（ms）',
    hint: '启动后等待浏览器就绪的超时时间',
  },
];

export function CollectionSection({
  browser,
  saving,
  patchBrowser,
  onSave,
}: CollectionSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Gauge
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          采集与限制
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {NUMBERS.map(spec => (
          <Field
            key={spec.key}
            label={spec.label}
            hint={spec.hint}
          >
            <input
              type="number"
              min={spec.key === 'waitForBrowserTimeoutMs' ? 0 : 1}
              value={browser?.[spec.key] ?? ''}
              onChange={e => {
                // 空字符串 = 不提交该字段（保留服务端现值），不做清空。
                // 不要写成 {[spec.key]: undefined} —— JSON.stringify 会丢键，
                // 浅合并后旧值原样保留，界面显示空而实际上仍有值（见 viewport 说明）。
                if (!e.target.value) return;
                patchBrowser({[spec.key]: Number(e.target.value)});
              }}
              placeholder="留空则不修改"
              className={`${inputClass} font-mono`}
            />
          </Field>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存本区配置'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 跑前端类型检查**

Run: `npm run web:typecheck`

Expected: PASS。这三个组件尚未被任何地方引用，`web:typecheck` 的 `include: ["src"]` 仍会编译它们 —— **严配置的 `noUnusedLocals` 会拦下未使用的 import**（例如某个 lucide 图标引进来没用）。报错就删掉那个 import。

- [ ] **Step 6: 文件级门禁**

```bash
npx prettier --check src/web-ui/src/components/settings/*.tsx && npx eslint src/web-ui/src/components/settings/*.tsx
```

- [ ] **Step 7: 提交**

```bash
git add src/web-ui/src/components/settings/Field.tsx src/web-ui/src/components/settings/BrowserSection.tsx src/web-ui/src/components/settings/AntiDetectSection.tsx src/web-ui/src/components/settings/CollectionSection.tsx
git commit -m "feat(web-ui): add Field primitive and browser/anti-detect/collection sections"
```

---

### Task 6: `LlmSection.tsx` —— 把现有 LLM 区块搬成组件

**Files:**

- Create: `src/web-ui/src/components/settings/LlmSection.tsx`

**Interfaces:**

- Consumes: `RuntimeConfig` / `BrowserConfig`（Task 4）、`patchRoot`
- Produces: `LlmSection` —— Task 8 消费

**这是纯搬迁**：把 `settings.tsx` 里现有的 LLM Provider 区块（含 provider / apiKey / baseURL / model + 获取模型列表 + 测试连接）原样搬过来，只把 `setConfig(prev => ...)` 样板换成 `patchRoot` 回调。

- [ ] **Step 1: 创建 `LlmSection.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {Activity, Key, RefreshCw} from 'lucide-react';
import {useState} from 'react';

import {api} from '../../lib/api';
import type {RuntimeConfig} from '../../lib/protocol';
import {Field, inputClass} from './Field';

interface LlmSectionProps {
  config: RuntimeConfig | null;
  saving: boolean;
  /** 通知父级进入/退出保存中状态；Task 8 传 (v) => setSaving(v ? 'llm' : null)。
   *  缺了它 saving 恒为 false，「保存中...」是死代码。 */
  setSaving: (saving: boolean) => void;
  patchRoot: (patch: Partial<RuntimeConfig>) => void;
  onSaved: (config: RuntimeConfig) => void;
  onError: (message: string) => void;
}

export function LlmSection({
  config,
  saving,
  setSaving,
  patchRoot,
  onSaved,
  onError,
}: LlmSectionProps) {
  const [llmTest, setLlmTest] = useState<{ok: boolean; message: string} | null>(
    null,
  );
  const [models, setModels] = useState<
    Array<{id: string; object?: string; owned_by?: string}>
  >([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const currentOpenai = config?.openai;

  const openaiPatch = (patch: Record<string, unknown>) => {
    patchRoot({openai: {...currentOpenai, ...patch}});
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updated = await api.updateLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存 LLM 配置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config) return;
    setLlmTest(null);
    setSaving(true);
    try {
      const result = await api.testLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setLlmTest({
        ok: result.ok,
        message: result.ok
          ? `连接成功（${result.provider}，${result.latencyMs}ms）`
          : '连接失败',
      });
    } catch (err) {
      setLlmTest({
        ok: false,
        message: err instanceof Error ? err.message : '连接测试失败',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFetchModels = async () => {
    if (!config) return;
    setLoadingModels(true);
    try {
      const result = await api.listLlmModels({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
      });
      setModels(result.models);
    } catch (err) {
      onError(err instanceof Error ? err.message : '获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Key
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          LLM Provider
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Provider">
          <select
            value={config?.llmProvider ?? 'openai'}
            onChange={e =>
              patchRoot({
                llmProvider: e.target.value as RuntimeConfig['llmProvider'],
              })
            }
            className={inputClass}
          >
            <option value="openai">OpenAI</option>
          </select>
        </Field>

        <Field
          label="OpenAI API Key"
          hint="留空则不修改"
        >
          <input
            type="password"
            value={currentOpenai?.apiKey ?? ''}
            onChange={e => openaiPatch({apiKey: e.target.value})}
            placeholder="留空则不修改"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <Field label="OpenAI Base URL">
          <input
            type="text"
            value={currentOpenai?.baseURL ?? ''}
            onChange={e => openaiPatch({baseURL: e.target.value})}
            placeholder="https://api.openai.com/v1"
            className={`${inputClass} font-mono`}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI Model
            </span>
            <button
              type="button"
              onClick={handleFetchModels}
              disabled={loadingModels}
              className="text-xs text-[var(--color-accent)] hover:opacity-80 disabled:opacity-50 flex items-center gap-1 transition-opacity"
            >
              <RefreshCw
                size={12}
                className={loadingModels ? 'animate-spin' : ''}
              />
              {loadingModels ? '获取中...' : '获取模型列表'}
            </button>
          </div>
          <select
            value={currentOpenai?.model ?? ''}
            onChange={e => openaiPatch({model: e.target.value})}
            className={`${inputClass} font-mono`}
          >
            <option value="">请选择模型</option>
            {models.map(m => (
              <option
                key={m.id}
                value={m.id}
              >
                {m.id}
              </option>
            ))}
            {currentOpenai?.model &&
              !models.some(m => m.id === currentOpenai.model) && (
                <option value={currentOpenai.model}>
                  {currentOpenai.model}
                </option>
              )}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存本区配置'}
        </button>
        <button
          onClick={handleTest}
          disabled={saving}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Activity size={12} />
          测试连接
        </button>
        {llmTest && (
          <span
            className={`text-xs ${
              llmTest.ok
                ? 'text-[var(--color-status-green)]'
                : 'text-[var(--color-status-red)]'
            }`}
          >
            {llmTest.message}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 跑前端类型检查**

Run: `npm run web:typecheck`

Expected: PASS。

- [ ] **Step 3: 文件级门禁 + 提交**

```bash
npx prettier --check src/web-ui/src/components/settings/LlmSection.tsx && npx eslint src/web-ui/src/components/settings/LlmSection.tsx
git add src/web-ui/src/components/settings/LlmSection.tsx
git commit -m "refactor(web-ui): extract LlmSection component"
```

---

### Task 7: `GeneralSection.tsx` —— 环境信息 / 日志 / 导出·导入·重置

**Files:**

- Create: `src/web-ui/src/components/settings/GeneralSection.tsx`

**Interfaces:**

- Consumes: `SystemInfo` / `LogContent` / `ExportedConfig`（Task 4）、`api.getSystemInfo()` / `getSystemLog()` / `exportConfig()` / `importConfig()` / `resetConfig()`（Task 4）
- Produces: `GeneralSection` —— Task 8 消费

**下载不走 `api.ts`**：日志下载直接用 `<a href="/api/system/logs/download?file=...">`，与 `CaCertModal.tsx:73-82` 一致。

- [ ] **Step 1: 创建 `GeneralSection.tsx`**

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Check,
  Copy,
  Download,
  FileDown,
  FileUp,
  Info,
  RotateCcw,
} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';

import {api} from '../../lib/api';
import type {LogContent, SystemInfo} from '../../lib/protocol';

interface GeneralSectionProps {
  onReloadConfig: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const d = days > 0 ? `${days}d ` : '';
  const h = (hours % 24).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${d}${h}:${m}:${s}`;
}

export function GeneralSection({
  onReloadConfig,
  onError,
  onNotice,
}: GeneralSectionProps) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [log, setLog] = useState<LogContent | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInfo = async () => {
    try {
      setInfo(await api.getSystemInfo());
    } catch (err) {
      onError(err instanceof Error ? err.message : '获取系统信息失败');
    }
  };

  useEffect(() => {
    void loadInfo();
    // 组件按导航懒挂载，挂载即拉取；刷新靠父级的「刷新配置」按钮重新挂载本区
  }, []);

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      onError(err instanceof Error ? err.message : '复制失败');
    }
  };

  const handleViewLog = async (name: string) => {
    setBusy(true);
    try {
      setLog(await api.getSystemLog(name));
    } catch (err) {
      onError(err instanceof Error ? err.message : '读取日志失败');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const data = await api.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `browsercli-config-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onNotice('配置已导出（API Key 为掩码占位符，迁移后需手动填写）');
    } catch (err) {
      onError(err instanceof Error ? err.message : '导出配置失败');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      await api.importConfig(parsed);
      onNotice('配置已导入并合并（合并语义：文件中缺失的字段保留当前值）');
      onReloadConfig();
      void loadInfo();
    } catch (err) {
      onError(err instanceof Error ? err.message : '导入配置失败');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReset = async () => {
    // 前端无 confirm 用法先例（全项目 window.confirm 零命中），
    // 用两段式确认：首次点击把按钮切成「确认重置？」，再次点击才执行。
    if (
      !window.confirm('确定重置为启动时的默认配置？这将删除本地缓存的配置。')
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.resetConfig();
      onNotice('配置已重置为启动默认值');
      onReloadConfig();
      void loadInfo();
    } catch (err) {
      onError(err instanceof Error ? err.message : '重置配置失败');
    } finally {
      setBusy(false);
    }
  };

  const envRows: Array<{label: string; value: string}> = info
    ? [
        {label: '版本', value: info.version},
        {label: 'Node', value: info.node},
        {label: '平台', value: info.platform},
        {label: '架构', value: info.arch},
        {label: 'PID', value: String(info.pid)},
        {label: '运行时间', value: formatUptime(info.uptimeMs)},
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Info
          className="text-[var(--color-accent)]"
          size={20}
        />
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          通用
        </h2>
      </div>

      {/* 环境信息 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {envRows.map(row => (
          <div
            key={row.label}
            className="p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]"
          >
            <div className="text-[11px] text-[var(--color-text-muted)]">
              {row.label}
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] mt-1">
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {/* 配置文件与日志目录 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--color-text-muted)]">
              配置文件
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
              {info?.configPath ?? '—'}
            </div>
          </div>
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ml-3 ${
              info?.configExists
                ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
            }`}
          >
            {info?.configExists ? '已存在' : '未创建'}
          </span>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]">
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--color-text-muted)]">
              日志目录
            </div>
            <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
              {info?.logDir ?? '—'}
            </div>
          </div>
          <button
            onClick={() => info && void copyText(info.logDir, 'logDir')}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0 ml-3"
            title="复制日志目录路径"
          >
            {copied === 'logDir' ? (
              <Check
                size={14}
                className="text-emerald-400"
              />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>

      {/* 日志文件列表 */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          日志文件
        </h3>
        {!info || info.logFiles.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)]">暂无日志文件</p>
        ) : (
          <div className="space-y-1">
            {info.logFiles.map(f => (
              <div
                key={f.name}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)]"
              >
                <div className="min-w-0">
                  <div className="text-xs font-mono text-[var(--color-text-primary)] truncate">
                    {f.name}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">
                    {formatBytes(f.sizeBytes)} ·{' '}
                    {new Date(f.mtimeMs).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => void handleViewLog(f.name)}
                    disabled={busy}
                    className="px-2 py-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                  >
                    查看
                  </button>
                  {/* 下载走浏览器原生下载，不经 api.ts —— 与 CaCertModal 的证书下载一致 */}
                  <a
                    href={`/api/system/logs/download?file=${encodeURIComponent(f.name)}`}
                    className="px-2 py-1 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] inline-flex items-center gap-1"
                  >
                    <Download size={11} />
                    下载
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        {log && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                {log.fileName}
              </span>
              {log.truncated && (
                <span className="text-[11px] text-[var(--color-status-yellow)]">
                  已截断至最后 1 MiB
                </span>
              )}
            </div>
            <pre className="p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] font-mono text-[11px] text-[var(--color-text-primary)] overflow-auto max-h-64 whitespace-pre-wrap">
              {log.content}
            </pre>
          </div>
        )}
      </div>

      {/* 配置导出 / 导入 / 重置 */}
      <div className="space-y-2 border-t border-[var(--color-border-muted)] pt-4">
        <h3 className="text-xs font-semibold text-[var(--color-text-secondary)]">
          配置管理
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExport}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <FileDown size={12} />
            导出配置
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <FileUp size={12} />
            导入配置
          </button>
          <button
            onClick={handleReset}
            disabled={busy}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RotateCcw size={12} />
            重置配置
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          导出文件里的 API Key 恒为掩码占位符，导入时不会覆盖已保存的真实密钥。
          重置会删除本地缓存文件并回到启动时的配置（环境变量 + CLI 参数）。
        </p>
      </div>
    </div>
  );
}
```

> **关于 `window.confirm`**：全项目 `window.confirm` 零命中（已核实）。spec 未指定重置的确认交互。上面用的是原生 `window.confirm` —— 这是最简单且安全的做法（重置是破坏性操作）。若实现时发现它在 Vite dev 下表现异常，退路是两段式本地 state 确认，但**不要**直接无确认执行重置。

- [ ] **Step 2: 跑前端类型检查**

Run: `npm run web:typecheck`

Expected: PASS。

- [ ] **Step 3: 文件级门禁 + 提交**

```bash
npx prettier --check src/web-ui/src/components/settings/GeneralSection.tsx && npx eslint src/web-ui/src/components/settings/GeneralSection.tsx
git add src/web-ui/src/components/settings/GeneralSection.tsx
git commit -m "feat(web-ui): add GeneralSection with env info, logs and config management"
```

---

### Task 8: `settings.tsx` 瘦身为 shell + 挂载全部路由

**Files:**

- Modify: `src/web-ui/src/routes/settings.tsx`（整文件重写）

**Interfaces:**

- Consumes: Task 5/6/7 的全部五个分区组件、`patchBrowser` / `patchRoot` 回调约定
- Produces: 无（终点）

**App.tsx 的 `import SettingsPage from './routes/settings'` 无需改动**（本文件仍 default export）。

- [ ] **Step 1: 重写 `settings.tsx`**

整文件替换为：

```tsx
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Activity,
  Gauge,
  Globe,
  Key,
  RefreshCw,
  Settings,
  Shield,
} from 'lucide-react';
import {useEffect, useState} from 'react';

import {AntiDetectSection} from '../components/settings/AntiDetectSection';
import {BrowserSection} from '../components/settings/BrowserSection';
import {CollectionSection} from '../components/settings/CollectionSection';
import {GeneralSection} from '../components/settings/GeneralSection';
import {LlmSection} from '../components/settings/LlmSection';
import {api} from '../lib/api';
import type {
  BrowserConfig,
  RuntimeConfig,
  WorkerFullStatus,
} from '../lib/protocol';
import {wsClient} from '../lib/ws';

type SectionKey = 'general' | 'browser' | 'anti-detect' | 'llm' | 'collection';

const NAV_ITEMS: Array<{
  key: SectionKey;
  label: string;
  icon: typeof Settings;
}> = [
  {key: 'general', label: '通用', icon: Settings},
  {key: 'browser', label: '浏览器连接', icon: Globe},
  {key: 'anti-detect', label: '反检测', icon: Shield},
  {key: 'llm', label: 'LLM Provider', icon: Key},
  {key: 'collection', label: '采集与限制', icon: Gauge},
];

export default function SettingsPage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey>('general');

  const fetchConfig = async () => {
    try {
      setConfig(await api.getConfig());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const data = await api.getWorkerStatus();
      setBrowserConnected(data.browser?.connected ?? false);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void fetchConfig();
    void fetchStatus();

    const unsub = wsClient.subscribe('worker.status', msg => {
      if (msg.type === 'snapshot' || msg.type === 'event') {
        const payload = msg.payload as WorkerFullStatus;
        if (payload?.browser) {
          setBrowserConnected(payload.browser.connected);
        }
      }
    });

    return () => unsub();
  }, []);

  // 消除样板的关键：现状每个字段都手写一遍
  // setConfig(prev => ({...prev, browser: {...prev.browser, x: v}}))，
  // 5 个分区会让这段复制几十遍。
  const patchBrowser = (patch: Partial<BrowserConfig>) => {
    setConfig(prev =>
      prev ? {...prev, browser: {...(prev.browser ?? {}), ...patch}} : prev,
    );
  };

  const patchRoot = (patch: Partial<RuntimeConfig>) => {
    setConfig(prev => (prev ? {...prev, ...patch} : prev));
  };

  // 三个 browser 分区（浏览器连接 / 反检测 / 采集限制）共用一个保存动作，
  // 但每个分区有自己的「保存中...」指示器 —— 用 key 区分，
  // 否则 saveBrowser 恒为 'browser'，反检测与采集分区的按钮永远不进 loading 态。
  const saveBrowser = async (key: string) => {
    if (!config?.browser) return;
    setSaving(key);
    try {
      setConfig(await api.updateBrowserConfig(config.browser));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleConnectBrowser = async () => {
    setSaving('connect-browser');
    try {
      await api.connectBrowser();
      await fetchStatus();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接浏览器失败');
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnectBrowser = async () => {
    setSaving('disconnect-browser');
    try {
      await api.disconnectBrowser();
      setBrowserConnected(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '断开失败');
    } finally {
      setSaving(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      await Promise.all([fetchConfig(), fetchStatus()]);
    } finally {
      setRefreshing(false);
    }
  };

  const showNotice = (message: string) => {
    setError(null);
    setNotice(message);
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 lg:p-8 space-y-6 animate-pulse">
        <div className="h-10 w-48 bg-[var(--color-border-muted)] rounded-lg mb-8" />
        <div className="h-64 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-hidden select-none">
      <div className="border-b border-[var(--color-border-muted)] pb-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              系统设置
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
              配置浏览器连接、反检测、LLM Provider
              与采集限制。保存后自动缓存到本地，下次启动服务时自动加载并连接。
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 shrink-0"
          >
            <RefreshCw
              size={12}
              className={refreshing ? 'animate-spin' : ''}
            />
            {refreshing ? '刷新中...' : '刷新配置'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-[var(--color-status-red)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-xs text-[var(--color-status-green)]">
          {notice}
        </div>
      )}

      <div className="flex gap-6 min-h-0 flex-1">
        {/* 左侧导航 */}
        <nav className="w-44 shrink-0 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = activeSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveSection(item.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left ${
                  isActive
                    ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-accent)] border border-[var(--color-border-default)]'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] border border-transparent'
                }`}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 右侧分区：导航切换时才渲染对应分区（懒挂载） */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
          {activeSection === 'general' && (
            <GeneralSection
              onReloadConfig={fetchConfig}
              onError={setError}
              onNotice={showNotice}
            />
          )}

          {activeSection === 'browser' && (
            <BrowserSection
              browser={config?.browser}
              connected={browserConnected}
              saving={saving === 'browser'}
              busy={
                saving === 'connect-browser' || saving === 'disconnect-browser'
              }
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('browser')}
              onConnect={handleConnectBrowser}
              onDisconnect={handleDisconnectBrowser}
            />
          )}

          {activeSection === 'anti-detect' && (
            <AntiDetectSection
              browser={config?.browser}
              saving={saving === 'anti-detect'}
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('anti-detect')}
            />
          )}

          {activeSection === 'llm' && (
            <LlmSection
              config={config}
              saving={saving === 'llm'}
              setSaving={v => setSaving(v ? 'llm' : null)}
              patchRoot={patchRoot}
              onSaved={setConfig}
              onError={setError}
            />
          )}

          {activeSection === 'collection' && (
            <CollectionSection
              browser={config?.browser}
              saving={saving === 'collection'}
              patchBrowser={patchBrowser}
              onSave={() => saveBrowser('collection')}
            />
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
        <Activity size={11} />
        <span>分区独立保存：每区只提交本区字段，互不覆盖。</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 跑前端类型检查**

Run: `npm run web:typecheck`

Expected: PASS。**严配置会在这里拦下一切契约失配**：分区 props 名字拼错、`BrowserConfig` 缺字段、`saving` 类型不对都会报错。这正是本计划的验证边界（spec §2：前端只跑 `web:typecheck`）。

- [ ] **Step 3: 文件级门禁**

```bash
npx prettier --check src/web-ui/src/routes/settings.tsx && npx eslint src/web-ui/src/routes/settings.tsx
```

- [ ] **Step 4: 提交**

```bash
git add src/web-ui/src/routes/settings.tsx
git commit -m "refactor(web-ui): turn settings page into a nav shell with lazy sections"
```

---

### Task 9: 后端挂载 —— `ConsoleServer` + `src/index.ts`

**Files:**

- Modify: `src/web/ConsoleServer.ts`
- Modify: `src/index.ts`
- Modify: `tests/unit/web/routes/system.test.ts`（仅 Step 5b 追加一条用例，Task 2 遗留）

**Interfaces:**

- Consumes: `createSystemRoutes`（Task 2）、`configSeed` 字段（Task 3）
- Produces: 三条 `/api/system/*` 路由在线上生效

- [ ] **Step 1: `ConsoleServerOptions` 加 `configSeed`**

在 `src/web/ConsoleServer.ts` 的 `ConsoleServerOptions` 接口里，`apiToken?: string;` 之后追加：

```ts
  /**
   * 重置配置时的 CLI 种子值；src/index.ts 传入 parseWorkerArgs() 结果。
   * 与启动时 update(cliConfig) 的语义对齐：只有 WorkerArgs 认识的 flag 会保留。
   */
  configSeed?: Partial<GlobalConfig>;
```

并在顶部导入补上：

```ts
import type {GlobalConfig} from '../config/schema.js';
```

- [ ] **Step 2: `setupRoutes()` 里 mount system 路由并透传 configSeed**

把：

```ts
this.router.mount(
  createConfigRoutes({
    contextProvider: this.options.runtime.contextProvider!,
    wsHub: this.wsHub,
  }),
);
```

改成：

```ts
this.router.mount(
  createConfigRoutes({
    contextProvider: this.options.runtime.contextProvider!,
    wsHub: this.wsHub,
    configSeed: this.options.configSeed,
  }),
);
this.router.mount(
  createSystemRoutes({
    version,
    startedAt: this.startedAt,
  }),
);
```

（`version` 与 `this.startedAt` 都在 `setupRoutes()` 作用域内已可用 —— `version` 在方法开头读出，`startedAt` 是实例字段。）

顶部导入补上：

```ts
import {createSystemRoutes} from './routes/system.js';
```

- [ ] **Step 3: `src/index.ts` 传 `configSeed: cliConfig`**

在构造 `ConsoleServer` 的参数块里，`apiToken: process.env.WORKER_API_TOKEN,` 之后追加一行：

```ts
        configSeed: cliConfig,
```

`cliConfig` 是 `parseWorkerArgs(process.argv.slice(2))` 的返回值，在 `main()` 作用域内已可用（`:51`）。

- [ ] **Step 4: 跑后端类型检查与既有的 ConsoleServer 测试**

Run: `npm run typecheck && npm run build && node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test build/tests/unit/web/ConsoleServer.test.js`

Expected: 均 PASS。`ConsoleServer.test.ts` 不传 `configSeed`，走 `undefined` 分支（可选字段），不应影响现有四条用例。

- [ ] **Step 5: 冒烟 —— 起服务确认新路由可达**

```bash
npm run build && timeout 25 node build/src/index.js --no-console 2>&1 | head -5
```

> 这一步的可选性：`--no-console` 会跳过 ConsoleServer，无法验证路由。要真验证需要起完整服务并用 curl 打 `/api/system/info`。**若执行环境不便起服务，跳过本步** —— Task 2/3 的单测已覆盖路由行为，本 Task 只负责挂载，且 `npm run typecheck` + `ConsoleServer.test.ts` 已验证挂载不炸。**不要**为了冒烟而绕过 `--no-console` 起一个会尝试连接浏览器的完整进程。

- [ ] **Step 5b（必须，Task 2 遗留）: `/api/system/logs` 非 disastrous 错误的传播路径补一条测试**

Task 2 的单测证明了 info 会对列表错误降级，但 `/logs` 自己对非 `ENOENT` 错误的
**传播**（抛出 → RestRouter 兑底 500 `INTERNAL`）只有手工探针证据，无自动化。
在 `tests/unit/web/routes/system.test.ts` 补一条（放在 `describe('GET /api/system/logs')` 内）：

```ts
it('propagates a non-ENOENT log dir error to the caller', () => {
  // logDir 指向一个普通文件：readdirSync 抛 ENOTDIR（非 ENOENT），
  // listLogFiles 必须重新抛出 —— 由 handler 直接冒泡（RestRouter 会转成 500 INTERNAL）。
  const notADir = join(tmpRoot, 'plain-file.log');
  writeFileSync(notADir, 'x', 'utf8');
  const routes = createSystemRoutes({
    version: 'test',
    startedAt: Date.now(),
    logDir: notADir,
    configPath: join(tmpRoot, 'cfg.json'),
  });
  const handler = routes.get('GET /api/system/logs')!;
  const {req, res} = mockReqRes('GET', '/api/system/logs');
  assert.throws(() => handler(req, res), /ENOTDIR/);
});
```

（具体复用现有测试文件的 helper 名与 tmpdir 约定，不必逐字照搬上面这段。）
若你的实现中 handler 包了 try/catch 而不抛，请以实际行为为准并修正断言 —— 但**禁止**为了
让这条测试通过而把 `/logs` 的错误改成降级返回 `logFiles: []`：那会把 info 与 logs 的
错误语义扭成一样，用户再也无从得知日志目录坏了。

- [ ] **Step 6: 文件级门禁 + 提交**

```bash
npx prettier --check src/web/ConsoleServer.ts src/index.ts tests/unit/web/routes/system.test.ts && npx eslint src/web/ConsoleServer.ts src/index.ts tests/unit/web/routes/system.test.ts
git add src/web/ConsoleServer.ts src/index.ts tests/unit/web/routes/system.test.ts
git commit -m "feat(web): mount system routes and pass CLI config seed"
```

---

## 验证说明

spec §7 要求收尾跑：

```bash
npm run typecheck && npm run web:typecheck && npm run test:unit && npm run check-format
```

**⚠️ `npm run check-format` 在本仓库会 OOM**（本计划编写时已实测：`eslint --cache .` 会连 `open-source/` 一起扫，运行约 4 分钟后 `FATAL ERROR: Reached heap limit - JavaScript heap out of memory`）。这是**既有基线问题，不是本轮改动引入的**。

因此收尾验证改为：

```bash
# 1. 后端类型
npm run typecheck
# 2. 前端类型（严配置，本轮的主要验证边界）
npm run web:typecheck
# 3. 全量单测
npm run test:unit
# 4. 文件级门禁（替代会 OOM 的 check-format）
npx prettier --check src/utils/logger.ts src/config/runtimeConfigPersistence.ts \
  src/web/routes/system.ts src/web/routes/config.ts src/web/ConsoleServer.ts \
  src/index.ts src/web/types.ts \
  src/web-ui/src/lib/api.ts src/web-ui/src/lib/protocol.ts \
  src/web-ui/src/routes/settings.tsx src/web-ui/src/components/settings/*.tsx \
  tests/unit/web/routes/system.test.ts tests/unit/web/routes/config.test.ts \
  tests/unit/config/runtimeConfigPersistence.test.ts
npx eslint src/utils/logger.ts src/config/runtimeConfigPersistence.ts \
  src/web/routes/system.ts src/web/routes/config.ts src/web/ConsoleServer.ts \
  src/index.ts src/web/types.ts \
  src/web-ui/src/lib/api.ts src/web-ui/src/lib/protocol.ts \
  src/web-ui/src/routes/settings.tsx src/web-ui/src/components/settings/*.tsx \
  tests/unit/web/routes/system.test.ts tests/unit/web/routes/config.test.ts \
  tests/unit/config/runtimeConfigPersistence.test.ts
```

完成时**如实说明**：`npm run check-format` 因仓库既有 OOM 未跑，已用文件级 prettier + eslint 覆盖本轮全部改动文件。不要声称四道命令全绿。

---

## 自审记录

**1. Spec 覆盖检查**（逐节核对 `docs/superpowers/specs/2026-09-02-system-settings-design.md）：

| Spec 节                                              | 覆盖 Task                          |
| ---------------------------------------------------- | ---------------------------------- |
| §3.1 `/api/system/*` 三接口 + 1MiB 上限 + 路径穿越   | Task 2                             |
| §3.2 `SystemInfo` 响应结构                           | Task 2（实现）+ Task 4（协议类型） |
| §3.3 `logger.ts` 两处改动                            | Task 1                             |
| §3.4 `PERSISTED_KEYS` 导出 + `deleteRuntimeConfig()` | Task 1                             |
| §3.5 `config.ts` 三条路由 + 两个注入字段             | Task 3                             |
| §3.6 `ConsoleServerOptions` + `src/index.ts`         | Task 9                             |
| §4.1 前端文件结构（6 个文件）                        | Task 5/6/7/8                       |
| §4.2 shell 职责 + `patchBrowser`/`patchRoot`         | Task 8                             |
| §4.3 五分区字段表 + viewport 特判                    | Task 5/6/7                         |
| §4.4 协议与 api 客户端（5 个方法）                   | Task 4                             |
| §6 错误码表（6 个 code）                             | Task 2/3                           |
| §7 测试计划（3 个文件）                              | Task 1/2/3                         |

**§2 决策表核对**：导出 apiKey 恒掩码（Task 3 实现 + Task 7 提示）；日志返回路径+列表+下载不 spawn（Task 2/7）；重置删文件+回到 env+CLI seed（Task 3 + Task 9）；CLI 参数保（Task 9）；每区独立保存（Task 5/6/8）；验证边界后端 node:test + 前端 `web:typecheck`（验证说明）。

**2. Placeholder 扫描**：本计划无 TBD / TODO /「handle edge cases」/「Similar to Task N」。Step 3 里 `system.ts` 的实现是完整代码（含 `readLogTail` / `listLogFiles` / `resolveLogFile` 三个 helper 的完整函数体），不是「实现路径穿越防御」这类空话。Task 9 Step 5 的冒烟标了「可选 / 环境不便则跳过」并给了替代验证，不是无内容步骤。

**3. 类型一致性核对**：

- `patchBrowser: (patch: Partial<BrowserConfig>) => void` —— Task 5/6/7 三个分区 props 与 Task 8 实现逐字一致。
- `patchRoot: (patch: Partial<RuntimeConfig>) => void` —— Task 6 props 与 Task 8 实现一致。
- `createSystemRoutes(cfg: SystemRoutesConfig)` 的四个字段（`version` / `startedAt` / `configPath?` / `logDir?`）—— Task 2 定义、Task 9 调用一致。
- `ConfigRoutesConfig` 的 `configSeed?` / `deleteConfig?` —— Task 3 定义并测试、Task 9 只在 `ConsoleServer` 侧传 `configSeed`（`deleteConfig` 留默认 `deleteRuntimeConfig`，线上正确），一致。
- `SystemInfo` / `LogFileInfo` / `LogContent` / `ExportedConfig` —— Task 2 在 `system.ts` 内定义并导出，Task 4 在 `src/web/types.ts` 重新声明同样的结构供前端消费。**两处结构逐字段一致**（这是有意的：后端路由文件保持自包含，协议文件供前端；若担心重复，可让 `system.ts` 改为从 `types.ts` 导入，但那会让 `web/types.ts` → `routes/system.ts` 与 `routes/system.ts` → `types.js` 形成循环，触发 `import/no-cycle`，故保持现状）。
- lucide-react 图标名全部已核实存在于 `node_modules/lucide-react`（`Settings`/`Globe`/`Key`/`Shield`/`Gauge`/`Info`/`FileDown`/`FileUp`/`RotateCcw`/`Copy`/`Check`/`Download`/`Activity`/`RefreshCw`/`Save`/`Plug`/`PlugZap`）。

**4. 已知取舍（与 spec §8 一致）**：

- import 是合并语义，跨版本导入时旧文件缺失的字段保留当前值。
- 日志读取 1 MiB 上限，download 同样受此约束（返回的不是完整原始文件）。
- `configSeed` 只覆盖 `parseWorkerArgs()` 认识的 flag（`WorkerArgs.ts` 的 `BOOLEAN_FLAGS` / `VALUE_FLAGS`）。
- apiKey 掩码导出使导出文件不可用于迁移（spec 决策 A）。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-09-02-system-settings.md`. Two execution options:**

**1. Subagent-Driven（推荐）** —— 每个 Task 派一个全新 subagent，Task 之间做两阶段评审，迭代快。

**2. Inline Execution** —— 在当前会话里按 Task 顺序执行，批量执行 + 检查点评审。

**Which approach?**
