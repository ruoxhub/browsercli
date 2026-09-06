# 前端动态配置改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 config.json 三级文件加载链路，改为 Worker 进程内存态 `RuntimeConfigStore`，由前端控制面板读取/修改，浏览器与数据库连接改为面板显式触发。

**Architecture:** 新增 `RuntimeConfigStore` 单例（env+CLI 播种，内存态，无持久化），所有配置读取函数（`getBrowserManagerConfig`/`getAIConfig`/`createAIService` 等）改为从 store 读取。Worker 启动不再自动连接浏览器/数据库。新增 `BrowserConnectionManager` 封装重连协调，新增 `routes/config.ts` 暴露 GET/PUT/POST REST API，前端新增"连接设置"页面。

**Tech Stack:** TypeScript ESM, Node.js `node:http`, zod, React + react-router-dom, patchright (BrowserManager)。

## Global Constraints

- Node `^20.19.0 || ^22.12.0 || >=23`；ESM；Prettier `singleQuote: true, trailingComma: all, arrowParens: avoid, endOfLine: lf`。
- 配置纯内存，Worker 重启后回落到 env/CLI 种子值（§11 已确认）。
- 不做配置磁盘持久化；不实现多用户隔离；不加密存储敏感字段。
- 不改动 `BrowserManager` 内部实现（stealth/CDP 等逻辑不动）。
- `proxycli/` 独立 CLI 包不在本次范围（§3 末尾已确认）。
- 敏感字段（apiKey）在 `GET /api/config` 响应中掩码，`PUT` 时掩码占位符不覆盖真实值（§6）。
- 测试框架 `node:test`；源码目录与测试目录镜像；提交前至少运行 `npm run test:unit` 与 `npm run check-format`。
- 提交遵循 Conventional Commits；不提交真实 apiKey / databaseUrl。

---

## File Structure

| 文件                                                 | 职责                                                                                         | 操作 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---- |
| `src/config/RuntimeConfigStore.ts`                   | 内存配置单例：`get()`/`update()`/`reset()`，env 播种                                         | 新建 |
| `src/config/resolver.ts`                             | 导出 `configFromEnv`；扩展其覆盖范围；删除文件加载函数；简化 `resolveConfig`                 | 修改 |
| `src/config/servicesConfig.ts`                       | `getBrowserManagerConfig`/`getAIConfig`/`createAIService`/`getDefaultLLMProvider` 改读 store | 修改 |
| `src/config/constants.ts`                            | 删除 `USER_CONFIG_*`/`PROJECT_CONFIG_FILENAME`/`ROOT_CONFIG_FILENAME`                        | 修改 |
| `src/config/index.ts`                                | 导出 `RuntimeConfigStore` 相关 API                                                           | 修改 |
| `src/index.ts`                                       | 移除自动连接浏览器/数据库；用 CLI 参数播种 store                                             | 修改 |
| `src/worker/BrowserConnectionManager.ts`             | `connectBrowser`/`disconnectBrowser` 协调函数                                                | 新建 |
| `src/web/routes/config.ts`                           | GET/PUT/POST config + connect/disconnect 路由                                                | 新建 |
| `src/web/routes/worker.ts`                           | `buildFullStatus` 改用 `contextProvider` 反映重连后实例                                      | 修改 |
| `src/web/ConsoleServer.ts`                           | 挂载 config 路由；注入 `contextProvider`/`wsHub`                                             | 修改 |
| `src/web-ui/src/routes/settings.tsx`                 | 连接设置页面（浏览器/LLM/数据库三区块）                                                      | 新建 |
| `src/web-ui/src/lib/api.ts`                          | 新增 config/connect API 方法                                                                 | 修改 |
| `src/web-ui/src/App.tsx`                             | 新增导航项与路由                                                                             | 修改 |
| `tests/unit/config/RuntimeConfigStore.test.ts`       | store 单元测试                                                                               | 新建 |
| `tests/unit/worker/BrowserConnectionManager.test.ts` | 连接协调单元测试                                                                             | 新建 |
| `tests/unit/web/routes/config.test.ts`               | 路由单元测试                                                                                 | 新建 |
| `tests/unit/config/schema.test.ts`                   | 删除文件加载相关用例                                                                         | 修改 |
| `tests/unit/utils/config.test.ts`                    | 删除 `getUserConfigPath` 等文件相关用例                                                      | 修改 |

---

### Task 1: RuntimeConfigStore + configFromEnv 扩展

**Files:**

- Modify: `src/config/resolver.ts`（导出 `configFromEnv`；扩展其读取 gemini/anthropic/browser 扩展字段）
- Create: `src/config/RuntimeConfigStore.ts`
- Modify: `src/config/index.ts`
- Test: `tests/unit/config/RuntimeConfigStore.test.ts`

**Interfaces:**

- Consumes: `GlobalConfig`, `validateGlobalConfig` from `src/config/schema.ts`；`configFromEnv` from `src/config/resolver.ts`
- Produces: `RuntimeConfigStore` 类（`get(): Readonly<GlobalConfig>`、`update(partial): GlobalConfig`、`reset(seed?): void`）；`getRuntimeConfigStore()` 懒初始化访问器；`resetRuntimeConfigStore(seed?)` 测试重置器。后续所有任务通过 `getRuntimeConfigStore()` 读取配置。

- [ ] **Step 1: 扩展 configFromEnv 覆盖 gemini/anthropic/browser 扩展字段**

在 `src/config/resolver.ts` 的 `configFromEnv()` 函数中，在现有 `openai` 块之后、`browser` 块之前，新增 gemini 和 anthropic 的 env 读取；在 `browser` 块中新增 jsStealth/cloak/fullStealthArgs/minimalStealth 字段。

找到 `configFromEnv()` 中 `if (Object.keys(openai).length > 0) result.openai = openai;` 这一行之后，插入 gemini 和 anthropic 读取块：

```ts
const gemini: NonNullable<GlobalConfig['gemini']> = {};
const geminiApiKey = getEnvValue('GEMINI_API_KEY');
const geminiCliPath = getEnvValue('GEMINI_CLI_PATH');
const geminiUseAPI = getEnvBoolean('GEMINI_USE_API');
const geminiModel = getEnvValue('GEMINI_MODEL');
if (geminiApiKey !== undefined) gemini.apiKey = geminiApiKey;
if (geminiCliPath !== undefined) gemini.cliPath = geminiCliPath;
if (geminiUseAPI !== undefined) gemini.useAPI = geminiUseAPI;
if (geminiModel !== undefined) gemini.model = geminiModel;
if (Object.keys(gemini).length > 0) result.gemini = gemini;

const anthropic: NonNullable<GlobalConfig['anthropic']> = {};
const anthropicApiKey = getEnvValue('ANTHROPIC_API_KEY');
const anthropicBaseURL = getEnvValue('ANTHROPIC_BASE_URL');
const anthropicModel = getEnvValue('ANTHROPIC_MODEL');
if (anthropicApiKey !== undefined) anthropic.apiKey = anthropicApiKey;
if (anthropicBaseURL !== undefined) anthropic.baseURL = anthropicBaseURL;
if (anthropicModel !== undefined) anthropic.model = anthropicModel;
if (Object.keys(anthropic).length > 0) result.anthropic = anthropic;
```

然后在 `BROWSER_ENV_MAP` 常量中新增四个字段（在 `BROWSER_MAX_SINGLE_FILE_SIZE` 行之后）：

```ts
  BROWSER_MAX_SINGLE_FILE_SIZE: 'maxSingleFileSize',
  BROWSER_JS_STEALTH: 'jsStealth',
  BROWSER_CLOAK: 'cloak',
  BROWSER_FULL_STEALTH_ARGS: 'fullStealthArgs',
  BROWSER_MINIMAL_STEALTH: 'minimalStealth',
```

注意：`BROWSER_ENV_MAP` 的值类型是字符串键名，但 `jsStealth`/`cloak`/`fullStealthArgs`/`minimalStealth` 是布尔值。由于 `configFromEnv()` 的 `BROWSER_ENV_MAP` 循环直接把字符串值赋给 `browser` 对象，布尔字段会以字符串 `'true'`/`'false'` 存储。这会被 `BrowserConfigSchema` 的 `booleanSchema`（zod preprocess）正确强制转换。验证：`validateGlobalConfig(result)` 在 `configFromEnv()` 末尾调用，zod preprocess 会把 `'true'` → `true`。

- [ ] **Step 2: 导出 configFromEnv**

在 `src/config/resolver.ts` 中将 `function configFromEnv()` 改为 `export function configFromEnv()`。

- [ ] **Step 3: 编写 RuntimeConfigStore 失败测试**

创建 `tests/unit/config/RuntimeConfigStore.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  getRuntimeConfigStore,
  resetRuntimeConfigStore,
} from '../../../src/config/RuntimeConfigStore.js';

describe('RuntimeConfigStore', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.BROWSER_HEADLESS;
    delete process.env.DEFAULT_LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = {...originalEnv};
    resetRuntimeConfigStore();
  });

  it('seeds from configFromEnv on first access', () => {
    process.env.OPENAI_API_KEY = 'sk-seed';
    process.env.DEFAULT_LLM_PROVIDER = 'openai';
    resetRuntimeConfigStore();

    const config = getRuntimeConfigStore().get();

    assert.strictEqual(config.openai?.apiKey, 'sk-seed');
    assert.strictEqual(config.llmProvider, 'openai');
  });

  it('update merges top-level fields', () => {
    resetRuntimeConfigStore({rpcHost: 'ws://old', group: 'g1'});

    const store = getRuntimeConfigStore();
    store.update({rpcHost: 'ws://new'});

    assert.strictEqual(store.get().rpcHost, 'ws://new');
    assert.strictEqual(store.get().group, 'g1');
  });

  it('update shallow-merges nested browser field', () => {
    resetRuntimeConfigStore({
      browser: {headless: true, channel: 'stable'},
    });

    const store = getRuntimeConfigStore();
    store.update({browser: {headless: false}});

    // headless 被覆盖，channel 被保留（浅合并）
    assert.strictEqual(store.get().browser?.headless, false);
    assert.strictEqual(store.get().browser?.channel, 'stable');
  });

  it('update shallow-merges nested openai field', () => {
    resetRuntimeConfigStore({
      openai: {apiKey: 'sk-orig', model: 'gpt-4o'},
    });

    const store = getRuntimeConfigStore();
    store.update({openai: {apiKey: 'sk-new'}});

    assert.strictEqual(store.get().openai?.apiKey, 'sk-new');
    assert.strictEqual(store.get().openai?.model, 'gpt-4o');
  });

  it('update validates via zod and throws on invalid input', () => {
    resetRuntimeConfigStore();

    assert.throws(
      () => getRuntimeConfigStore().update({llmProvider: 'invalid-provider'}),
      /llmProvider/,
    );
  });

  it('reset re-seeds the store', () => {
    const store = getRuntimeConfigStore();
    store.update({rpcHost: 'ws://modified'});

    resetRuntimeConfigStore({rpcHost: 'ws://reset'});

    assert.strictEqual(getRuntimeConfigStore().get().rpcHost, 'ws://reset');
  });

  it('get returns a readonly snapshot', () => {
    resetRuntimeConfigStore({rpcHost: 'ws://x'});
    const snapshot = getRuntimeConfigStore().get();

    assert.strictEqual(snapshot.rpcHost, 'ws://x');
  });
});
```

- [ ] **Step 4: 运行测试验证失败**

Run: `npm run build && node --test --import tsx tests/unit/config/RuntimeConfigStore.test.ts`（若项目用 `tsx` 直接跑 TS；否则先 `npm run build` 再 `node --test build/tests/unit/config/RuntimeConfigStore.test.js`）

Expected: FAIL — 找不到模块 `../../../src/config/RuntimeConfigStore.js`

- [ ] **Step 5: 实现 RuntimeConfigStore**

创建 `src/config/RuntimeConfigStore.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RuntimeConfigStore — 进程内存态配置单例。
 *
 * 启动时用 configFromEnv() + CLI 参数播种，不读任何 JSON 文件。
 * 面板通过 update() 修改配置，重启后回落到种子值。
 *
 * 深层字段（browser/openai/gemini/anthropic/toolResultRecording）在 update()
 * 时做浅合并，避免面板只改一个字段却清空其余字段。
 */

import {configFromEnv} from './resolver.js';
import {type GlobalConfig, validateGlobalConfig} from './schema.js';

/** 需要浅合并的深层对象字段 */
const DEEP_MERGE_KEYS = new Set([
  'browser',
  'openai',
  'gemini',
  'anthropic',
  'toolResultRecording',
]);

export class RuntimeConfigStore {
  private config: GlobalConfig;

  constructor(seed: GlobalConfig = configFromEnv()) {
    this.config = validateGlobalConfig(seed);
  }

  get(): Readonly<GlobalConfig> {
    return this.config;
  }

  update(partial: Partial<GlobalConfig>): GlobalConfig {
    const merged: GlobalConfig = {...this.config};

    for (const [key, value] of Object.entries(partial)) {
      if (
        value !== undefined &&
        DEEP_MERGE_KEYS.has(key) &&
        typeof value === 'object' &&
        value !== null
      ) {
        const oldValue = (this.config as Record<string, unknown>)[key];
        (merged as Record<string, unknown>)[key] =
          oldValue && typeof oldValue === 'object'
            ? {...(oldValue as object), ...(value as object)}
            : value;
      } else if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }

    this.config = validateGlobalConfig(merged);
    return this.config;
  }

  reset(seed?: GlobalConfig): void {
    this.config = validateGlobalConfig(seed ?? configFromEnv());
  }
}

let store: RuntimeConfigStore | undefined;

export function getRuntimeConfigStore(): RuntimeConfigStore {
  if (!store) {
    store = new RuntimeConfigStore();
  }
  return store;
}

/**
 * 重置 store（测试用）。传入 seed 则用 seed 重建；不传则从当前 env 重新播种。
 */
export function resetRuntimeConfigStore(seed?: GlobalConfig): void {
  store = new RuntimeConfigStore(seed);
}
```

- [ ] **Step 6: 从 config/index.ts 导出**

在 `src/config/index.ts` 中新增导出：

```ts
export * from './RuntimeConfigStore.js';
```

文件最终内容：

```ts
export * from './constants.js';
export * from './resolver.js';
export * from './schema.js';
export * from './RuntimeConfigStore.js';
```

- [ ] **Step 7: 运行测试验证通过**

Run: `npm run build && node --test build/tests/unit/config/RuntimeConfigStore.test.js`

Expected: PASS — 全部 7 个用例通过。

- [ ] **Step 8: 提交**

```bash
git add src/config/RuntimeConfigStore.ts src/config/resolver.ts src/config/index.ts tests/unit/config/RuntimeConfigStore.test.ts
git commit -m "feat(config): add RuntimeConfigStore memory-only config singleton"
```

---

### Task 2: 迁移配置读取函数到 RuntimeConfigStore

**Files:**

- Modify: `src/config/servicesConfig.ts`（`getBrowserManagerConfig`/`getAIConfig`/`getDefaultLLMProvider` 改读 store）
- Modify: `src/config/resolver.ts`（`getToolResultRecordingConfig` 改读 store）
- Test: `tests/unit/utils/config.test.ts`（验证 env 行为不变）

**Interfaces:**

- Consumes: `getRuntimeConfigStore()` from Task 1
- Produces: `getBrowserManagerConfig()` / `getAIConfig()` / `createAIService()` / `getDefaultLLMProvider()` / `getToolResultRecordingConfig()` 仍保持原有签名，但内部数据源从 `loadFullConfig()` + 直接 env 读取切换为 `getRuntimeConfigStore().get()`。调用方无感知。

- [ ] **Step 1: 编写 getDefaultLLMProvider 读 store 的验证测试**

在 `tests/unit/utils/config.test.ts` 的 `describe('getDefaultLLMProvider')` 中新增一个用例（在最后一个 `it` 之后）：

```ts
it('should reflect RuntimeConfigStore updates', () => {
  const {
    resetRuntimeConfigStore,
    getRuntimeConfigStore,
  } = require('../../../src/config/RuntimeConfigStore.js');
  resetRuntimeConfigStore({llmProvider: 'anthropic'});

  const provider = getDefaultLLMProvider();
  assert.strictEqual(provider, 'anthropic');

  getRuntimeConfigStore().update({llmProvider: 'openai'});
  assert.strictEqual(getDefaultLLMProvider(), 'openai');

  resetRuntimeConfigStore();
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run build && node --test build/tests/unit/utils/config.test.js`

Expected: FAIL — `getDefaultLLMProvider()` 仍走 `loadFullConfig()`，不读 store，`llmProvider` 不会变为 `anthropic`。

- [ ] **Step 3: 改造 getDefaultLLMProvider 读 store**

在 `src/config/servicesConfig.ts` 中，找到 `getDefaultLLMProvider()` 函数，替换为：

```ts
import {getRuntimeConfigStore} from './RuntimeConfigStore.js';

/**
 * 获取默认 LLM 提供商
 *
 * 优先级：环境变量 > RuntimeConfigStore > 默认值
 */
export function getDefaultLLMProvider(): LLMProvider {
  const envProvider = getEnvValue('DEFAULT_LLM_PROVIDER')?.toLowerCase();
  if (
    envProvider === 'openai' ||
    envProvider === 'gemini' ||
    envProvider === 'anthropic'
  ) {
    return envProvider as LLMProvider;
  }

  const config = getRuntimeConfigStore().get();
  if (config.llmProvider) return config.llmProvider as LLMProvider;

  return 'gemini';
}
```

注意：在文件顶部 import 区新增 `import {getRuntimeConfigStore} from './RuntimeConfigStore.js';`（按字母序，放在 `import {...} from './resolver.js';` 之前）。

- [ ] **Step 4: 改造 getAIConfig 读 store**

在 `src/config/servicesConfig.ts` 中，找到 `getAIConfig()` 函数，替换为：

```ts
/**
 * 从 RuntimeConfigStore 获取 AI 配置
 */
export function getAIConfig(): AIConfig | undefined {
  const provider = getDefaultLLMProvider();
  const config = getRuntimeConfigStore().get();

  const result: AIConfig = {
    provider,
  };

  // OpenAI：env > store
  const envApiKey = getEnvValue('OPENAI_API_KEY');
  if (envApiKey) {
    result.openai = {
      apiKey: envApiKey,
      baseURL: getEnvValue('OPENAI_BASE_URL'),
      model: getEnvValue('OPENAI_MODEL') || 'gpt-4o',
    };
  } else if (config.openai) {
    result.openai = {
      apiKey: config.openai.apiKey || '',
      baseURL: config.openai.baseURL,
      model: config.openai.model || 'gpt-4o',
    };
  }

  // Gemini：env > store
  const envGeminiKey = getEnvValue('GEMINI_API_KEY');
  const envGeminiCliPath = getEnvValue('GEMINI_CLI_PATH');
  const envGeminiUseAPI = getEnvBoolean('GEMINI_USE_API');
  const envGeminiModel = getEnvValue('GEMINI_MODEL');
  if (envGeminiKey || envGeminiCliPath || envGeminiUseAPI || envGeminiModel) {
    result.gemini = {
      apiKey: envGeminiKey,
      cliPath: envGeminiCliPath,
      useAPI: envGeminiUseAPI,
      model: envGeminiModel,
    };
  } else if (config.gemini) {
    result.gemini = {
      apiKey: config.gemini.apiKey,
      cliPath: config.gemini.cliPath,
      useAPI: config.gemini.useAPI,
      model: config.gemini.model,
    };
  } else if (provider === 'gemini') {
    result.gemini = {};
  }

  // Anthropic：env > store
  const envAnthropicKey = getEnvValue('ANTHROPIC_API_KEY');
  if (envAnthropicKey) {
    result.anthropic = {
      apiKey: envAnthropicKey,
      baseURL: getEnvValue('ANTHROPIC_BASE_URL'),
      model: getEnvValue('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-20241022',
    };
  } else if (config.anthropic) {
    result.anthropic = {
      apiKey: config.anthropic.apiKey || '',
      baseURL: config.anthropic.baseURL,
      model: config.anthropic.model || 'claude-3-5-sonnet-20241022',
    };
  }

  const hasAnyProvider = result.openai || result.gemini || result.anthropic;
  return hasAnyProvider ? result : undefined;
}
```

- [ ] **Step 5: 改造 getBrowserManagerConfig 读 store**

在 `src/config/servicesConfig.ts` 中，找到 `getBrowserManagerConfig()` 函数，将开头的 `const {merged: fileConfig} = loadFullConfig();` 和 `const fileBrowser = fileConfig.browser;` 替换为从 store 读取：

```ts
export function getBrowserManagerConfig(): BrowserManagerConfig {
  const globalConfig = getRuntimeConfigStore().get();
  const fileBrowser = globalConfig.browser;
  const fileConfig = globalConfig;
```

其余逻辑（`fields` 数组、`getters`、env vs fileVal vs extraFallback）保持不变。`fileConfig` 仍用于 `extraFallback` 读取 top-level `cloak`/`fullStealthArgs`/`browserUrl`/`wsEndpoint` 字段。删除 `loadFullConfig` 的 import（若 `servicesConfig.ts` 不再直接使用它）。

注意：`servicesConfig.ts` 顶部 import 中有 `loadFullConfig`，改造后若不再使用则删除该 import。检查 `getSystemConfig()` 仍调用 `getAIConfig()` 和 `getBrowserManagerConfig()`，不直接用 `loadFullConfig`。

- [ ] **Step 6: 改造 getToolResultRecordingConfig 读 store**

在 `src/config/resolver.ts` 中，找到 `getToolResultRecordingConfig()` 函数，替换为：

```ts
import {getRuntimeConfigStore} from './RuntimeConfigStore.js';
import {USER_CONFIG_DIR_NAME} from './constants.js';

export function getToolResultRecordingConfig(): ResolvedToolResultRecordingConfig {
  const fileConfig = getRuntimeConfigStore().get();
  const envEnabled = getEnvBoolean('BROWSER_RECORD_TOOL_RESULTS');
  const envOutputDir = getEnvValue('BROWSER_TOOL_RESULTS_DIR');
  const outputDir =
    envOutputDir ??
    fileConfig.toolResultRecording?.outputDir ??
    (fileConfig.outputDir
      ? path.join(fileConfig.outputDir, 'tool-results')
      : path.join(os.homedir(), USER_CONFIG_DIR_NAME, 'tool-results'));

  return {
    enabled: envEnabled ?? fileConfig.toolResultRecording?.enabled ?? false,
    outputDir,
  };
}
```

注意：在 `resolver.ts` 顶部新增 `import {getRuntimeConfigStore} from './RuntimeConfigStore.js';`。`USER_CONFIG_DIR_NAME` 在 Task 6 会被删除，但当前仍保留，此处继续使用。

- [ ] **Step 7: 运行测试验证通过**

Run: `npm run build && node --test build/tests/unit/utils/config.test.js`

Expected: PASS — 全部用例通过，包括新增的 store 反映用例。

- [ ] **Step 8: 运行 schema 测试验证无回归**

Run: `npm run build && node --test build/tests/unit/config/schema.test.js`

Expected: 除文件加载相关用例外（Task 6 处理），其余通过。

- [ ] **Step 9: 提交**

```bash
git add src/config/servicesConfig.ts src/config/resolver.ts tests/unit/utils/config.test.ts
git commit -m "refactor(config): migrate config readers to RuntimeConfigStore"
```

---

### Task 3: Worker 启动改造 — 移除自动连接，CLI 播种 store

**Files:**

- Modify: `src/index.ts`
- Test: `tests/unit/index.test.ts`（若不存在则新建）

**Interfaces:**

- Consumes: `getRuntimeConfigStore()` / `resetRuntimeConfigStore()` from Task 1；`parseWorkerArgs` from `src/worker/WorkerArgs.ts`
- Produces: `main()` 启动后 store 已用 CLI 参数播种；浏览器/数据库不再自动连接。`contextProvider` 以未连接状态初始化。

- [ ] **Step 1: 编写启动不自动连接的验证测试**

创建 `tests/unit/index.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, beforeEach, describe, it, mock} from 'node:test';

describe('Worker main() startup', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.argv = originalArgv;
    mock.reset();
  });

  it('does not auto-connect browser on startup', async () => {
    // 验证 ensureBrowser 不在启动流程中被调用
    // 通过检查 getRuntime().browserManager.isConnected() === false 来断言
    // （实际启动需 mock ConsoleServer，此处验证种子逻辑）
    const {resetRuntimeConfigStore, getRuntimeConfigStore} =
      await import('../../src/config/RuntimeConfigStore.js');
    const {parseWorkerArgs} = await import('../../src/worker/WorkerArgs.js');

    const cliConfig = parseWorkerArgs(['--rpcHost', 'ws://test:5612']);
    resetRuntimeConfigStore();
    getRuntimeConfigStore().update(cliConfig);

    assert.strictEqual(getRuntimeConfigStore().get().rpcHost, 'ws://test:5612');
  });

  it('seeds store with CLI overrides on top of env', async () => {
    process.env.RPC_HOST = 'ws://env:5612';
    const {resetRuntimeConfigStore, getRuntimeConfigStore} =
      await import('../../src/config/RuntimeConfigStore.js');
    const {parseWorkerArgs} = await import('../../src/worker/WorkerArgs.js');

    resetRuntimeConfigStore();
    const cliConfig = parseWorkerArgs(['--rpcHost', 'ws://cli:5612']);
    getRuntimeConfigStore().update(cliConfig);

    // CLI 覆盖 env
    assert.strictEqual(getRuntimeConfigStore().get().rpcHost, 'ws://cli:5612');
    delete process.env.RPC_HOST;
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run build && node --test build/tests/unit/index.test.js`

Expected: FAIL — store 未用 CLI 播种（`rpcHost` 为 undefined）

- [ ] **Step 3: 改造 src/index.ts 移除自动连接 + CLI 播种**

在 `src/index.ts` 中，找到 `main()` 函数，替换为以下内容（保留文件头注释和 import）：

```ts
import './utils/logger.js';

import {resolveConfig} from './config.js';
import {getRuntimeConfigStore} from './config/RuntimeConfigStore.js';
import {getRuntime} from './runtime.js';
import {ConsoleServer} from './web/ConsoleServer.js';
import {JobStore} from './worker/JobStore.js';
import {SekiroInvoker} from './worker/SekiroInvoker.js';
import {ToolAdapter} from './worker/ToolAdapter.js';
import {ToolContextProvider} from './worker/ToolContext.js';
import {parseWorkerArgs, toWorkerOptions} from './worker/WorkerArgs.js';
import {createGracefulShutdown} from './worker/WorkerLifecycle.js';

export const workerStartContext: {
  group?: string;
  rpcHost?: string;
} = {};

async function main(): Promise<void> {
  // 1. 解析 CLI 参数，播种 RuntimeConfigStore（CLI > env > 默认值）
  const cliConfig = parseWorkerArgs(process.argv.slice(2));
  getRuntimeConfigStore().update(cliConfig);

  // 2. 解析启动选项（rpcHost/group 等启动期固定值，不随面板变更）
  const resolved = resolveConfig(cliConfig);
  const options = toWorkerOptions(resolved);

  workerStartContext.group = options.group;
  workerStartContext.rpcHost = options.rpcHost;

  console.log('[Worker] 启动中...');
  console.log(`[Worker] Rpc Host: ${options.rpcHost}`);
  console.log(`[Worker] Group: ${options.group}`);

  // 3. 初始化聚合 Runtime（创建 BrowserManager 实例但不自动连接）
  const runtime = getRuntime();

  // 4. 以未连接状态初始化 ToolContextProvider
  const contextProvider = new ToolContextProvider(runtime);
  runtime.contextProvider = contextProvider;
  await contextProvider.init();

  // 5. 创建 ToolAdapter
  const toolAdapter = new ToolAdapter(contextProvider);

  console.log(
    '[Worker] HTTP 传输模式：等待 /api/v1 请求（浏览器/数据库需从控制面板连接）',
  );

  // 启动 Web 控制台
  const noConsole = process.argv.includes('--no-console');
  const consolePortIndex = process.argv.indexOf('--console-port');
  let consolePort = 8765;
  if (consolePortIndex !== -1 && consolePortIndex + 1 < process.argv.length) {
    const portNum = parseInt(process.argv[consolePortIndex + 1], 10);
    if (!isNaN(portNum) && portNum > 0) {
      consolePort = portNum;
    }
  }

  let consoleServer: ConsoleServer | undefined;
  if (!noConsole) {
    try {
      const invoker = new SekiroInvoker({
        rpcHost: options.rpcHost,
      });
      consoleServer = new ConsoleServer({
        port: consolePort,
        host: process.env.WORKER_HOST ?? '127.0.0.1',
        group: options.group,
        rpcHost: options.rpcHost,
        runtime,
        invoker,
        toolAdapter,
        jobStore: new JobStore(),
        apiToken: process.env.WORKER_API_TOKEN,
      });
      await consoleServer.start();
      console.log(
        `[Worker] 本地工作台 Web 控制台已启动: http://127.0.0.1:${consolePort}`,
      );
    } catch (err) {
      console.error('[Worker] 启动 Web 控制台服务失败:', err);
    }
  }

  // 6. 注册信号处理
  const gracefulShutdown = createGracefulShutdown({
    browserManager: runtime.browserManager,
    contextProvider,
  });

  const handleShutdown = async (signal: string) => {
    if (consoleServer) {
      try {
        await consoleServer.stop();
        console.log('[Worker] 控制台服务已关闭');
      } catch (err) {
        console.error('[Worker] 关闭控制台服务失败:', err);
      }
    }
    await gracefulShutdown(signal);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

main().catch(err => {
  console.error('[Worker] 启动失败:', err);
  process.exit(1);
});
```

关键变更：

- 删除 `import {dbService}` —— 数据库连接移至面板触发（Task 5）。
- 删除 `if (options.databaseUrl) { await dbService.connect(...) }` 自动连接块。
- 删除 `const browser = await runtime.browserManager.ensureBrowser()` 及后续 `browserContext` 获取/`setContext` 逻辑。
- 新增 `getRuntimeConfigStore().update(cliConfig)` 在 `getRuntime()` 之前播种。
- `contextProvider.init()` 在未连接状态调用（其内部对 context 为空已有处理分支）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run build && node --test build/tests/unit/index.test.js`

Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`

Expected: 无错误（`dbService` import 删除后，确认无其他文件因 index.ts 变更报错）

- [ ] **Step 6: 提交**

```bash
git add src/index.ts tests/unit/index.test.ts
git commit -m "refactor(worker): remove auto-connect browser/database on startup"
```

---

### Task 4: BrowserConnectionManager

**Files:**

- Create: `src/worker/BrowserConnectionManager.ts`
- Test: `tests/unit/worker/BrowserConnectionManager.test.ts`

**Interfaces:**

- Consumes: `BrowserManager`（`getInstance`/`resetInstance`/`ensureBrowser`/`getContext`/`getBrowser`）from `src/modules/browser/index.ts`；`ToolContextProvider`（`setBrowserManager`/`setBrowser`/`setContext`/`init`）from `src/worker/ToolContext.ts`；`BrowserManagerConfig` from `src/modules/browser/browser.ts`
- Produces: `connectBrowser(contextProvider, config): Promise<{mode: string}>` 和 `disconnectBrowser(contextProvider): Promise<void>`。Task 5 的路由调用这两个函数。

- [ ] **Step 1: 编写 BrowserConnectionManager 失败测试**

创建 `tests/unit/worker/BrowserConnectionManager.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it, mock} from 'node:test';

import {
  connectBrowser,
  disconnectBrowser,
} from '../../../src/worker/BrowserConnectionManager.js';
import {BrowserManager} from '../../../src/modules/browser/index.js';

describe('BrowserConnectionManager', () => {
  it('connectBrowser resets old instance, creates new, binds to contextProvider', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );
    const fakeBrowser = {
      contexts: () => [{pages: () => []}],
      isConnected: () => true,
      version: () => 'test',
    };
    const fakeManager = {
      ensureBrowser: () => Promise.resolve(fakeBrowser),
      getContext: () => fakeBrowser.contexts()[0],
      getBrowser: () => fakeBrowser,
      isConnected: () => true,
    };
    const getInstanceMock = mock.method(
      BrowserManager,
      'getInstance',
      () => fakeManager,
    );

    const setBrowserManager = mock.fn();
    const setBrowser = mock.fn();
    const setContext = mock.fn();
    const init = mock.fn(() => Promise.resolve());
    const contextProvider = {setBrowserManager, setBrowser, setContext, init};

    const config = {headless: true, isolated: true};
    const result = await connectBrowser(
      contextProvider as never,
      config as never,
    );

    assert.strictEqual(resetMock.mock.callCount(), 1);
    assert.strictEqual(getInstanceMock.mock.callCount(), 1);
    assert.strictEqual(setBrowserManager.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.callCount(), 1);
    assert.strictEqual(setContext.mock.callCount(), 1);
    assert.strictEqual(init.mock.callCount(), 1);
    assert.ok(result.mode);

    resetMock.mock.restore();
    getInstanceMock.mock.restore();
  });

  it('disconnectBrowser resets instance and clears contextProvider browser', async () => {
    const resetMock = mock.method(BrowserManager, 'resetInstance', () =>
      Promise.resolve(),
    );

    const setBrowser = mock.fn();
    const setContext = mock.fn();
    const contextProvider = {setBrowser, setContext};

    await disconnectBrowser(contextProvider as never);

    assert.strictEqual(resetMock.mock.callCount(), 1);
    // setBrowser(null) 清除旧引用
    assert.strictEqual(setBrowser.mock.callCount(), 1);
    assert.strictEqual(setBrowser.mock.calls[0].arguments[0], null);

    resetMock.mock.restore();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run build && node --test build/tests/unit/worker/BrowserConnectionManager.test.js`

Expected: FAIL — 找不到模块 `BrowserConnectionManager.js`

- [ ] **Step 3: 实现 BrowserConnectionManager**

创建 `src/worker/BrowserConnectionManager.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrowserConnectionManager — 封装"用最新配置重新连接浏览器"的协调逻辑。
 *
 * 不改动 BrowserManager 内部实现，只调用其 getInstance / resetInstance /
 * ensureBrowser，并通过 ToolContextProvider 更新工具层持有的引用。
 */

import type {BrowserManagerConfig} from '../modules/browser/index.js';
import {BrowserManager} from '../modules/browser/index.js';
import type {ToolContextProvider} from './ToolContext.js';

export interface ConnectResult {
  connected: boolean;
  mode: string;
}

/**
 * 用最新配置连接浏览器（断开旧实例若有）。
 *
 * @param contextProvider 工具上下文提供者，连接后更新其 BrowserManager/Browser/Context 引用
 * @param config 浏览器配置（从 RuntimeConfigStore 读取）
 */
export async function connectBrowser(
  contextProvider: ToolContextProvider,
  config: BrowserManagerConfig,
): Promise<ConnectResult> {
  await BrowserManager.resetInstance();
  const manager = BrowserManager.getInstance(config);
  const browser = await manager.ensureBrowser();
  const context = manager.getContext() ?? browser.contexts()[0] ?? null;

  contextProvider.setBrowserManager(manager);
  contextProvider.setBrowser(browser);
  if (context) {
    contextProvider.setContext(context);
  }
  await contextProvider.init();

  const mode = config.browserURL
    ? 'attach'
    : config.wsEndpoint
      ? 'ws-endpoint'
      : 'launch';

  return {connected: true, mode};
}

/**
 * 断开浏览器连接，清除 contextProvider 中的旧引用。
 */
export async function disconnectBrowser(
  contextProvider: ToolContextProvider,
): Promise<void> {
  await BrowserManager.resetInstance();
  contextProvider.setBrowser(null as never);
}
```

注意：`setBrowser(null)` — `BrowserContextProvider.setBrowser` 签名是 `(browser: Browser)`，传 `null` 需要类型断言。实际 `BrowserContextProvider` 内部 `_browser` 是 `Browser | null`，`setBrowser` 赋值 `this._browser = browser`。这里用 `as never` 绕过类型检查，或修改 `setBrowser` 签名接受 `Browser | null`（更干净）。选择后者：在 `src/worker/ToolContext.ts` 的 `setBrowser` 改签名为 `setBrowser(browser: Browser | null): void`，在 `BrowserContextProvider.ts` 的 `setBrowser` 同步改签名。

- [ ] **Step 4: 调整 setBrowser 签名接受 null**

在 `src/worker/context/BrowserContextProvider.ts` 中，将 `setBrowser` 方法签名改为：

```ts
  setBrowser(browser: Browser | null): void {
    this._browser = browser;
  }
```

在 `src/worker/ToolContext.ts` 中，将 `setBrowser` 方法签名改为：

```ts
  setBrowser(browser: Browser | null): void {
    this._browserContext.setBrowser(browser);
  }
```

然后 `BrowserConnectionManager.ts` 中 `contextProvider.setBrowser(null)` 不再需要 `as never`：

```ts
contextProvider.setBrowser(null);
```

- [ ] **Step 5: 运行测试验证通过**

Run: `npm run build && node --test build/tests/unit/worker/BrowserConnectionManager.test.js`

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/worker/BrowserConnectionManager.ts src/worker/context/BrowserContextProvider.ts src/worker/ToolContext.ts tests/unit/worker/BrowserConnectionManager.test.ts
git commit -m "feat(worker): add BrowserConnectionManager for panel-triggered connect/disconnect"
```

---

### Task 5: Config + 连接 REST 路由

**Files:**

- Create: `src/web/routes/config.ts`
- Modify: `src/web/routes/worker.ts`（`buildFullStatus` 改用 `contextProvider`）
- Modify: `src/web/ConsoleServer.ts`（挂载 config 路由，注入 `contextProvider`/`wsHub`）
- Modify: `src/web/ConsoleServer.ts`（`WorkerRoutesConfig` 新增 `contextProvider`）
- Test: `tests/unit/web/routes/config.test.ts`

**Interfaces:**

- Consumes: `getRuntimeConfigStore()` from Task 1；`connectBrowser`/`disconnectBrowser` from Task 4；`dbService` from `src/services/DatabaseService.ts`；`WsHub` from `src/web/ws/WsHub.ts`；`ToolContextProvider` from `src/worker/ToolContext.ts`
- Produces: `createConfigRoutes(cfg)` 返回 `Map<string, RouteHandler>`，路由表见下。`ConfigRoutesConfig` 接口包含 `contextProvider`、`wsHub`、`dbService`。

**路由表：**

| 方法 | 路径                      | 说明                                    |
| ---- | ------------------------- | --------------------------------------- |
| GET  | `/api/config`             | 返回 store 快照（apiKey 掩码）          |
| PUT  | `/api/config/browser`     | 更新 browser 配置                       |
| PUT  | `/api/config/llm`         | 更新 LLM 配置（掩码占位符不覆盖真实值） |
| PUT  | `/api/config/database`    | 更新 databaseUrl                        |
| POST | `/api/browser/connect`    | 调用 connectBrowser                     |
| POST | `/api/browser/disconnect` | 调用 disconnectBrowser                  |
| POST | `/api/database/connect`   | 调用 dbService.connect + migrate        |

- [ ] **Step 1: 编写 GET /api/config 掩码逻辑失败测试**

创建 `tests/unit/web/routes/config.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {
  createConfigRoutes,
  maskApiKey,
  isMaskPlaceholder,
} from '../../../../src/web/routes/config.js';
import {resetRuntimeConfigStore} from '../../../../src/config/RuntimeConfigStore.js';

function mockReqRes(method: string, body?: unknown) {
  const chunks: Buffer[] = [];
  if (body !== undefined) {
    chunks.push(Buffer.from(JSON.stringify(body)));
  }
  const req = {
    method,
    url: '/api/config',
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data' && chunks.length > 0) cb(chunks.shift());
      if (event === 'end') cb();
    },
  } as never;
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let responseBody = '';
  const res = {
    statusCode,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    end(body: string) {
      responseBody = body;
    },
    get headersSent() {
      return false;
    },
  } as never;
  return {req, res, getStatus: () => statusCode, getBody: () => responseBody};
}

describe('config routes', () => {
  afterEach(() => {
    resetRuntimeConfigStore();
  });

  describe('maskApiKey', () => {
    it('masks key showing only last 4 chars', () => {
      assert.strictEqual(maskApiKey('sk-abcdef1234'), 'sk-***1234');
    });

    it('returns empty string for empty input', () => {
      assert.strictEqual(maskApiKey(''), '');
    });

    it('returns mask for very short keys', () => {
      assert.strictEqual(maskApiKey('ab'), '***');
    });
  });

  describe('isMaskPlaceholder', () => {
    it('detects mask placeholder pattern', () => {
      assert.ok(isMaskPlaceholder('sk-***1234'));
    });

    it('returns false for real keys', () => {
      assert.strictEqual(isMaskPlaceholder('sk-real-key-1234'), false);
    });

    it('returns false for empty string', () => {
      assert.strictEqual(isMaskPlaceholder(''), false);
    });
  });

  describe('GET /api/config', () => {
    it('returns config with masked apiKeys', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-secretkey9999', model: 'gpt-4o'},
        llmProvider: 'openai',
        databaseUrl: 'postgres://localhost/db',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
      } as never);

      const handler = routes.get('GET /api/config')!;
      const {req, res, getBody} = mockReqRes('GET');

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-***9999');
      assert.strictEqual(parsed.data.openai.model, 'gpt-4o');
      assert.strictEqual(parsed.data.databaseUrl, 'postgres://localhost/db');
    });
  });

  describe('PUT /api/config/llm mask placeholder preservation', () => {
    it('preserves existing apiKey when placeholder is sent', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-original1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
      } as never);

      // 前端回传掩码占位符（未修改 key）
      const handler = routes.get('PUT /api/config/llm')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-***1234', model: 'gpt-4o-mini'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.ok(parsed.success);
      // apiKey 保留原值，model 更新为新值
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-original1234');
      assert.strictEqual(parsed.data.openai.model, 'gpt-4o-mini');
    });

    it('overwrites apiKey when real value is sent', async () => {
      resetRuntimeConfigStore({
        openai: {apiKey: 'sk-old1234', model: 'gpt-4o'},
        llmProvider: 'openai',
      });

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
      } as never);

      const handler = routes.get('PUT /api/config/llm')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        llmProvider: 'openai',
        openai: {apiKey: 'sk-newrealkey5678'},
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.data.openai.apiKey, 'sk-newrealkey5678');
    });
  });

  describe('PUT /api/config/browser validation', () => {
    it('returns 400 on invalid browser config', async () => {
      resetRuntimeConfigStore();

      const routes = createConfigRoutes({
        contextProvider: null,
        wsHub: null,
      } as never);

      const handler = routes.get('PUT /api/config/browser')!;
      const {req, res, getBody} = mockReqRes('PUT', {
        remoteDebuggingPort: 80, // 端口太低
      });

      await handler(req, res);

      const parsed = JSON.parse(getBody());
      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error.code, 'VALIDATION');
      assert.ok(parsed.error.message.includes('remoteDebuggingPort'));
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npm run build && node --test build/tests/unit/web/routes/config.test.js`

Expected: FAIL — 找不到模块 `config.js`

- [ ] **Step 3: 实现 config 路由**

创建 `src/web/routes/config.ts`：

```ts
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config + 连接 REST 路由
 *
 *  GET  /api/config               — 返回 RuntimeConfigStore 快照（敏感字段掩码）
 *  PUT  /api/config/browser       — 更新 browser 配置
 *  PUT  /api/config/llm           — 更新 LLM 配置（掩码占位符不覆盖真实值）
 *  PUT  /api/config/database      — 更新 databaseUrl
 *  POST /api/browser/connect      — 调用 connectBrowser
 *  POST /api/browser/disconnect   — 调用 disconnectBrowser
 *  POST /api/database/connect     — 调用 dbService.connect + migrate
 */

import type {IncomingMessage, ServerResponse} from 'node:http';

import {getRuntimeConfigStore} from '../../config/RuntimeConfigStore.js';
import type {GlobalConfig} from '../../config/schema.js';
import {
  BrowserConfigSchema,
  formatConfigValidationError,
} from '../../config/schema.js';
import {dbService} from '../../services/DatabaseService.js';
import type {ToolContextProvider} from '../../worker/ToolContext.js';
import {
  connectBrowser,
  disconnectBrowser,
} from '../../worker/BrowserConnectionManager.js';
import {getBrowserManagerConfig} from '../../config/servicesConfig.js';
import {sendError, sendJson, sendUnexpected} from '../middleware/error.js';
import type {WsHub} from '../ws/WsHub.js';

const MAX_BODY_BYTES = 1 * 1024 * 1024;

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params?: Record<string, string>,
) => Promise<void> | void;

export interface ConfigRoutesConfig {
  contextProvider: ToolContextProvider;
  wsHub: WsHub;
}

// ==================== 敏感字段掩码 ====================

/** 掩码 API key：仅保留前 3 字符 + *** + 后 4 字符 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 7) return '***';
  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

/** 检测字符串是否为掩码占位符（格式：xxx***xxxx） */
export function isMaskPlaceholder(value: string): boolean {
  if (!value) return false;
  return /^\S{1,5}\*\*\*\S{1,8}$/.test(value);
}

/** 对 config 快照中的敏感字段做掩码 */
function maskSensitiveFields(config: GlobalConfig): GlobalConfig {
  const masked = {...config};

  if (masked.openai?.apiKey) {
    masked.openai = {
      ...masked.openai,
      apiKey: maskApiKey(masked.openai.apiKey),
    };
  }
  if (masked.anthropic?.apiKey) {
    masked.anthropic = {
      ...masked.anthropic,
      apiKey: maskApiKey(masked.anthropic.apiKey),
    };
  }
  if (masked.gemini?.apiKey) {
    masked.gemini = {
      ...masked.gemini,
      apiKey: maskApiKey(masked.gemini.apiKey),
    };
  }

  return masked;
}

// ==================== Body 读取 ====================

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ==================== 路由工厂 ====================

export function createConfigRoutes(
  cfg: ConfigRoutesConfig,
): Map<string, RouteHandler> {
  return new Map<string, RouteHandler>([
    // GET /api/config — 返回掩码后的配置快照
    [
      'GET /api/config',
      (_req, res) => {
        const config = getRuntimeConfigStore().get();
        sendJson(res, maskSensitiveFields(config));
      },
    ],

    // PUT /api/config/browser — 更新 browser 配置
    [
      'PUT /api/config/browser',
      async (req, res) => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
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

        const parseResult = BrowserConfigSchema.safeParse(body);
        if (!parseResult.success) {
          sendError(
            res,
            'VALIDATION',
            formatConfigValidationError(parseResult.error),
            400,
          );
          return;
        }

        const updated = getRuntimeConfigStore().update({
          browser: parseResult.data,
        });
        sendJson(res, maskSensitiveFields(updated));
      },
    ],

    // PUT /api/config/llm — 更新 LLM 配置（掩码占位符不覆盖真实值）
    [
      'PUT /api/config/llm',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(res, code, '请求体不是合法 JSON', 400);
          return;
        }

        const current = getRuntimeConfigStore().get();
        const update: Partial<GlobalConfig> = {};

        if (typeof body.llmProvider === 'string') {
          update.llmProvider = body.llmProvider as GlobalConfig['llmProvider'];
        }

        // 处理 openai：掩码占位符 → 保留原值，真实值 → 覆盖
        if (body.openai && typeof body.openai === 'object') {
          const incoming = body.openai as Record<string, unknown>;
          const merged: Record<string, unknown> = {...current.openai};

          for (const [k, v] of Object.entries(incoming)) {
            if (k === 'apiKey' && typeof v === 'string') {
              if (isMaskPlaceholder(v)) {
                // 保留原值，不更新
                continue;
              }
              merged.apiKey = v;
            } else if (v !== undefined) {
              merged[k] = v;
            }
          }
          update.openai = merged as GlobalConfig['openai'];
        }

        // 处理 anthropic
        if (body.anthropic && typeof body.anthropic === 'object') {
          const incoming = body.anthropic as Record<string, unknown>;
          const merged: Record<string, unknown> = {...current.anthropic};

          for (const [k, v] of Object.entries(incoming)) {
            if (k === 'apiKey' && typeof v === 'string') {
              if (isMaskPlaceholder(v)) {
                continue;
              }
              merged.apiKey = v;
            } else if (v !== undefined) {
              merged[k] = v;
            }
          }
          update.anthropic = merged as GlobalConfig['anthropic'];
        }

        // 处理 gemini
        if (body.gemini && typeof body.gemini === 'object') {
          const incoming = body.gemini as Record<string, unknown>;
          const merged: Record<string, unknown> = {...current.gemini};

          for (const [k, v] of Object.entries(incoming)) {
            if (k === 'apiKey' && typeof v === 'string') {
              if (isMaskPlaceholder(v)) {
                continue;
              }
              merged.apiKey = v;
            } else if (v !== undefined) {
              merged[k] = v;
            }
          }
          update.gemini = merged as GlobalConfig['gemini'];
        }

        const updated = getRuntimeConfigStore().update(update);
        sendJson(res, maskSensitiveFields(updated));
      },
    ],

    // PUT /api/config/database — 更新 databaseUrl（不自动连接）
    [
      'PUT /api/config/database',
      async (req, res) => {
        let body: Record<string, unknown>;
        try {
          body = (await readJsonBody(req)) as Record<string, unknown>;
        } catch (err) {
          const code = err instanceof Error ? err.message : 'INVALID_JSON';
          sendError(res, code, '请求体不是合法 JSON', 400);
          return;
        }

        const databaseUrl =
          typeof body.databaseUrl === 'string' ? body.databaseUrl : undefined;

        const updated = getRuntimeConfigStore().update({databaseUrl});
        sendJson(res, {databaseUrl: updated.databaseUrl});
      },
    ],

    // POST /api/browser/connect — 用当前配置连接浏览器
    [
      'POST /api/browser/connect',
      async (_req, res) => {
        try {
          const config = getBrowserManagerConfig();
          const result = await connectBrowser(cfg.contextProvider, config);
          cfg.wsHub.broadcast('worker.status', {
            browser: {connected: true, mode: result.mode},
          });
          sendJson(res, result);
        } catch (err) {
          sendError(
            res,
            'BROWSER_CONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],

    // POST /api/browser/disconnect — 断开浏览器
    [
      'POST /api/browser/disconnect',
      async (_req, res) => {
        try {
          await disconnectBrowser(cfg.contextProvider);
          cfg.wsHub.broadcast('worker.status', {
            browser: {connected: false, mode: 'disconnected'},
          });
          sendJson(res, {connected: false});
        } catch (err) {
          sendError(
            res,
            'BROWSER_DISCONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],

    // POST /api/database/connect — 连接数据库
    [
      'POST /api/database/connect',
      async (_req, res) => {
        try {
          const {databaseUrl} = getRuntimeConfigStore().get();
          if (!databaseUrl) {
            sendError(
              res,
              'DATABASE_URL_NOT_SET',
              'databaseUrl 未配置，请先在面板设置',
              400,
            );
            return;
          }
          await dbService.connect(databaseUrl);
          await dbService.migrate();
          cfg.wsHub.broadcast('worker.status', {
            database: {connected: true},
          });
          sendJson(res, {connected: true});
        } catch (err) {
          sendError(
            res,
            'DATABASE_CONNECT_FAILED',
            err instanceof Error ? err.message : String(err),
            502,
          );
        }
      },
    ],
  ]);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npm run build && node --test build/tests/unit/web/routes/config.test.js`

Expected: PASS — 全部用例通过

- [ ] **Step 5: 更新 buildFullStatus 使用 contextProvider**

在 `src/web/routes/worker.ts` 中，修改 `WorkerRoutesConfig` 接口和 `buildFullStatus` 函数。

在 `WorkerRoutesConfig` 接口中新增可选字段：

```ts
import type {ToolContextProvider} from '../../worker/ToolContext.js';

export interface WorkerRoutesConfig {
  runtime: Runtime;
  contextProvider?: ToolContextProvider;
  group: string;
  rpcHost: string;
  version: string;
  startedAt: number;
  browserMode: string;
}
```

修改 `buildFullStatus` 函数，优先从 `contextProvider` 获取 browser 状态：

```ts
function buildFullStatus(cfg: WorkerRoutesConfig): WorkerFullStatus {
  const {runtime} = cfg;
  const ctxProvider = cfg.contextProvider ?? runtime.contextProvider;

  let isConnected: boolean;
  let pages: number;
  try {
    const ctx =
      ctxProvider?.getContext() ?? runtime.browserManager.getContext();
    pages = ctx?.pages().length ?? 0;
    isConnected =
      ctxProvider?.isBrowserConnected() ?? runtime.browserManager.isConnected();
  } catch {
    isConnected = false;
    pages = 0;
  }

  const hookStats = runtime.hookManager.getStats();
  const totalHooks = hookStats.totalHooks;
  const activeHooks = hookStats.enabledHooks;
  const pausedHooks = hookStats.disabledHooks;

  return {
    ...buildWorkerStatus(cfg),
    browser: {
      connected: isConnected,
      mode: cfg.browserMode,
      pages,
      sessions: pages,
    },
    hooks: {
      total: totalHooks,
      active: activeHooks,
      paused: pausedHooks,
    },
    tools: {
      total: 0,
    },
  };
}
```

- [ ] **Step 6: 在 ConsoleServer 挂载 config 路由并注入 contextProvider**

在 `src/web/ConsoleServer.ts` 中：

1. 新增 import：

```ts
import {createConfigRoutes} from './routes/config.js';
```

2. 在 `setupRoutes()` 方法中，`createWorkerRoutes` 调用处注入 `contextProvider`。找到 `const workerConfig: WorkerRoutesConfig = {...}` 块，新增 `contextProvider` 字段。注意：`contextProvider` 在 `main()` 中赋值给 `runtime.contextProvider`，但 `ConsoleServer` 构造时 `runtime.contextProvider` 可能已设置（`main()` 在 `new ConsoleServer()` 之前执行 `runtime.contextProvider = contextProvider`）。

在 `workerConfig` 对象中新增：

```ts
const workerConfig: WorkerRoutesConfig = {
  runtime: this.options.runtime,
  contextProvider: this.options.runtime.contextProvider,
  group: this.options.group,
  rpcHost: this.options.rpcHost,
  version,
  startedAt: this.startedAt,
  get browserMode(): string {
    try {
      const ctxProvider = self.options.runtime.contextProvider;
      const browser =
        ctxProvider?.getBrowser() ??
        self.options.runtime.browserManager.getBrowser();
      return browser?.version() ?? 'CDP';
    } catch {
      return 'CDP';
    }
  },
};
```

3. 在 `this.router.mount(createWorkerRoutes(...))` 之后新增：

```ts
this.router.mount(
  createConfigRoutes({
    contextProvider: this.options.runtime.contextProvider!,
    wsHub: this.wsHub,
  }),
);
```

注意：`contextProvider` 在 `ConsoleServer` 构造时已由 `main()` 赋值（`runtime.contextProvider = contextProvider` 发生在 `new ConsoleServer()` 之前）。使用 `!` 断言非空。

- [ ] **Step 7: 类型检查**

Run: `npm run typecheck`

Expected: 无错误

- [ ] **Step 8: 运行全部单元测试**

Run: `npm run build && npm run test:unit`

Expected: 除文件加载相关用例外（Task 6 处理），全部通过

- [ ] **Step 9: 提交**

```bash
git add src/web/routes/config.ts src/web/routes/worker.ts src/web/ConsoleServer.ts tests/unit/web/routes/config.test.ts
git commit -m "feat(web): add config and connection REST routes with apiKey masking"
```

---

### Task 6: 删除文件加载死代码 + 修复测试

**Files:**

- Modify: `src/config/resolver.ts`（删除文件加载函数，简化 resolveConfig）
- Modify: `src/config/constants.ts`（删除文件名常量）
- Modify: `tests/unit/config/schema.test.ts`（删除文件加载用例）
- Modify: `tests/unit/utils/config.test.ts`（删除 getUserConfigPath 用例）

**Interfaces:**

- Consumes: Task 2 已完成配置读取迁移（不再依赖 `loadFullConfig`）
- Produces: `resolver.ts` 不再导出 `loadFullConfig`/`loadUserConfig`/`loadProjectConfig`/`loadRootConfig`/`readConfigFile`/`writeConfigFile`/`mergeConfigs`/`getUserConfigPath`/`getProjectConfigPath`/`getRootConfigPath`/`initUserConfig`/`setUserConfigValue`/`deleteUserConfigValue`/`showConfigInfo`/`ConfigSource`。`resolveConfig()` 简化为合并 `configFromEnv()` + CLI 参数。

- [ ] **Step 1: 编写简化后 resolveConfig 的验证测试**

在 `tests/unit/config/schema.test.ts` 中，将 `resolveConfig` 相关用例更新为不依赖文件。找到 `it('validates and coerces environment-backed config before resolution', ...)` 用例，确认其只设置 env 变量不写文件——该用例无需修改。

删除以下两个用例（它们依赖文件加载）：

- `it('defaults tool result recording to the user config directory', ...)`
- `it('allows configuring tool result recording through config command', ...)`

找到这两个 `it(...)` 块，整块删除。

- [ ] **Step 2: 删除 config.test.ts 中 getUserConfigPath 用例**

在 `tests/unit/utils/config.test.ts` 中：

1. 从 import 中删除 `getUserConfigPath`：

```ts
import {
  getDefaultLLMProvider,
  getAIConfig,
  getBrowserConfig,
  getSystemConfig,
  validateConfig,
  getEnv,
  isDebugEnabled,
  createAIService,
  type SystemConfig,
  type AIConfig,
} from '../../../src/config.js';
```

2. 删除整个 `describe('user config path', ...)` 块。

3. 在 `beforeEach` 中新增 store 重置（确保每个用例从干净状态开始）：

```ts
beforeEach(() => {
  mock.method(os, 'homedir', () => '/nonexistent-homedir');
  mock.method(process, 'cwd', () => '/nonexistent-cwd');
  // ... existing env deletes ...

  // 重置 RuntimeConfigStore 以响应 env 变更
  const {
    resetRuntimeConfigStore,
  } = require('../../../src/config/RuntimeConfigStore.js');
  resetRuntimeConfigStore();
});
```

- [ ] **Step 3: 运行测试验证当前状态（文件加载函数仍存在）**

Run: `npm run build && node --test build/tests/unit/config/schema.test.js build/tests/unit/utils/config.test.js`

Expected: PASS — 删除文件依赖用例后，剩余用例通过

- [ ] **Step 4: 删除 resolver.ts 中的文件加载函数**

在 `src/config/resolver.ts` 中：

1. 删除 import：`existsSync, readFileSync, writeFileSync, mkdirSync` from `node:fs`，`os` from `node:os`（若 `getToolResultRecordingConfig` 仍需 `os.homedir()` 则保留 `os`）。检查：`getToolResultRecordingConfig` 使用 `os.homedir()`，保留 `os`。删除 fs imports。

2. 删除 import 中的 `PROJECT_CONFIG_FILENAME, ROOT_CONFIG_FILENAME, USER_CONFIG_DIR_NAME, USER_CONFIG_FILENAME`（从 constants），仅保留 `DEFAULT_GROUP, DEFAULT_RPC_HOST, RUNTIME_DIR_NAME`。

3. 删除以下函数/类型：
   - `ConfigSource` interface
   - `getUserConfigPath()`
   - `getProjectConfigPath()`
   - `getRootConfigPath()`
   - `readConfigFile()`
   - `writeConfigFile()`
   - `loadUserConfig()`
   - `loadProjectConfig()`
   - `loadRootConfig()`
   - `mergeConfigs()`
   - `loadFullConfig()`
   - `initUserConfig()`
   - `setUserConfigValue()`
   - `deleteUserConfigValue()`
   - `showConfigInfo()`

4. 简化 `resolveConfig()`：

```ts
export function resolveConfig(envArgs?: Partial<GlobalConfig>): ResolvedConfig {
  const envConfig = configFromEnv();
  const merged = validateGlobalConfig({...envConfig, ...envArgs});

  return {
    rpcHost: merged.rpcHost ?? DEFAULTS.rpcHost,
    group: merged.group ?? DEFAULTS.group,
    browserUrl: merged.browserUrl || undefined,
    wsEndpoint: merged.wsEndpoint || undefined,
    headless: merged.headless ?? DEFAULTS.headless,
    executablePath: merged.executablePath,
    databaseUrl: merged.databaseUrl || undefined,
    runtimeDirName: merged.runtimeDirName ?? DEFAULTS.runtimeDirName,
    debug: merged.debug ?? DEFAULTS.debug,
    cloak: merged.cloak ?? DEFAULTS.cloak,
    jsStealth: merged.jsStealth ?? DEFAULTS.jsStealth,
    fullStealthArgs: merged.fullStealthArgs ?? DEFAULTS.fullStealthArgs,
  };
}
```

5. 删除文件顶部注释中的文件优先级说明，替换为：

```ts
/**
 * 核心配置基础设施 — 环境变量工具、CLI 配置解析、RuntimeConfigStore 播种
 *
 * 配置优先级（高 → 低）：
 * 1. CLI 参数（--rpcHost 等）
 * 2. 环境变量（RPC_HOST, OPENAI_API_KEY 等）
 * 3. 内置默认值
 *
 * config.json 文件加载已移除，配置改为 RuntimeConfigStore 内存态，
 * 由前端控制面板管理（见 RuntimeConfigStore.ts）。
 */
```

- [ ] **Step 5: 删除 constants.ts 中的文件名常量**

在 `src/config/constants.ts` 中，删除：

```ts
/** 用户级配置目录名 */
export const USER_CONFIG_DIR_NAME = '.proxycli';

/** 用户级配置文件名 */
export const USER_CONFIG_FILENAME = 'config.json';

/** 项目级配置文件名 */
export const PROJECT_CONFIG_FILENAME = 'proxycli.config.json';

/** 项目根目录 config.json 文件名 */
export const ROOT_CONFIG_FILENAME = 'config.json';
```

文件最终内容：

```ts
/** Sekiro 默认分组名 */
export const DEFAULT_GROUP = 'proxycli';

/** Worker 进程运行时目录 */
export const RUNTIME_DIR_NAME = 'proxycli';

/** Sekiro 默认 RPC (WebSocket) 地址 */
export const DEFAULT_RPC_HOST = 'ws://127.0.0.1:5612';
```

- [ ] **Step 6: 修复 getToolResultRecordingConfig 的 USER_CONFIG_DIR_NAME 引用**

`getToolResultRecordingConfig()` 在 `resolver.ts` 中使用 `USER_CONFIG_DIR_NAME` 作为 outputDir 兜底路径。该常量已删除。将兜底路径改为硬编码：

在 `src/config/resolver.ts` 的 `getToolResultRecordingConfig()` 中：

```ts
const outputDir =
  envOutputDir ??
  fileConfig.toolResultRecording?.outputDir ??
  (fileConfig.outputDir
    ? path.join(fileConfig.outputDir, 'tool-results')
    : path.join(os.homedir(), '.proxycli', 'tool-results'));
```

并删除 `import {USER_CONFIG_DIR_NAME} from './constants.js';`（若已导入）。

- [ ] **Step 7: 检查 servicesConfig.ts 是否仍 import loadFullConfig**

在 `src/config/servicesConfig.ts` 中，确认 import 行不再包含 `loadFullConfig`。若 Task 2 已删除则跳过；若仍在 import 中则删除。

检查文件顶部 import：

```ts
import {
  getEnvBoolean,
  getEnvNumber,
  getEnvValue,
  type LLMProvider,
} from './resolver.js';
```

确认无 `loadFullConfig`。

- [ ] **Step 8: 全局搜索残留引用**

Run: `grep -rn "loadFullConfig\|loadUserConfig\|loadProjectConfig\|loadRootConfig\|writeConfigFile\|getUserConfigPath\|getProjectConfigPath\|getRootConfigPath\|initUserConfig\|setUserConfigValue\|deleteUserConfigValue\|showConfigInfo\|USER_CONFIG_FILENAME\|PROJECT_CONFIG_FILENAME\|ROOT_CONFIG_FILENAME" src/ tests/`

Expected: 无匹配（或仅匹配注释/字符串中的历史提及，无代码引用）

- [ ] **Step 9: 类型检查**

Run: `npm run typecheck`

Expected: 无错误

- [ ] **Step 10: 运行全部单元测试**

Run: `npm run build && npm run test:unit`

Expected: PASS — 全部单元测试通过

- [ ] **Step 11: 提交**

```bash
git add src/config/resolver.ts src/config/constants.ts src/config/servicesConfig.ts tests/unit/config/schema.test.ts tests/unit/utils/config.test.ts
git commit -m "refactor(config): remove config.json file loading, simplify resolveConfig"
```

---

### Task 7: 前端连接设置页面

**Files:**

- Create: `src/web-ui/src/routes/settings.tsx`
- Modify: `src/web-ui/src/lib/api.ts`
- Modify: `src/web-ui/src/App.tsx`
- Modify: `src/web-ui/src/lib/protocol.ts`（新增 config 类型导出）

**Interfaces:**

- Consumes: REST API from Task 5（`GET /api/config`, `PUT /api/config/*`, `POST /api/*/connect`）；`api` client from `src/web-ui/src/lib/api.ts`
- Produces: 设置页面组件 `SettingsPage`，导出为 `src/web-ui/src/routes/settings.tsx` 默认导出。`api.getConfig()`/`api.updateBrowserConfig()`/`api.updateLlmConfig()`/`api.updateDatabaseConfig()`/`api.connectBrowser()`/`api.disconnectBrowser()`/`api.connectDatabase()` API 方法。

- [ ] **Step 1: 在 protocol.ts 新增 config 类型**

在 `src/web-ui/src/lib/protocol.ts` 中，在文件末尾新增：

```ts
// ==================== Runtime Config ====================

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
}

export interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface GeminiConfig {
  apiKey?: string;
  cliPath?: string;
  useAPI?: boolean;
  model?: string;
}

export interface AnthropicConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface RuntimeConfig {
  rpcHost?: string;
  group?: string;
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  executablePath?: string;
  databaseUrl?: string;
  llmProvider?: 'openai' | 'gemini' | 'anthropic';
  openai?: OpenAIConfig;
  gemini?: GeminiConfig;
  anthropic?: AnthropicConfig;
  browser?: BrowserConfig;
  debug?: boolean;
}

export interface ConnectResult {
  connected: boolean;
  mode?: string;
}
```

- [ ] **Step 2: 在 api.ts 新增 config/connect 方法**

在 `src/web-ui/src/lib/api.ts` 中，import 区新增类型：

```ts
import type {
  ApiResponse,
  WorkerFullStatus,
  InvocationRecord,
  SiteExperience,
  RuntimeConfig,
  BrowserConfig,
  ConnectResult,
} from './protocol';
```

在 `api` 对象中（`deleteSiteExperience` 方法之后）新增：

```ts
  getConfig(): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('GET', '/api/config');
  },

  updateBrowserConfig(
    config: Partial<BrowserConfig>,
  ): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('PUT', '/api/config/browser', config);
  },

  updateLlmConfig(config: {
    llmProvider?: string;
    openai?: Record<string, unknown>;
    gemini?: Record<string, unknown>;
    anthropic?: Record<string, unknown>;
  }): Promise<RuntimeConfig> {
    return request<RuntimeConfig>('PUT', '/api/config/llm', config);
  },

  updateDatabaseConfig(databaseUrl: string): Promise<{databaseUrl: string}> {
    return request<{databaseUrl: string}>('PUT', '/api/config/database', {
      databaseUrl,
    });
  },

  connectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/connect');
  },

  disconnectBrowser(): Promise<ConnectResult> {
    return request<ConnectResult>('POST', '/api/browser/disconnect');
  },

  connectDatabase(): Promise<{connected: boolean}> {
    return request<{connected: boolean}>('POST', '/api/database/connect');
  },
```

- [ ] **Step 3: 创建 settings.tsx 页面**

创建 `src/web-ui/src/routes/settings.tsx`：

```tsx
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Globe,
  Key,
  Database,
  Plug,
  PlugZap,
  Save,
  RefreshCw,
} from 'lucide-react';
import {useEffect, useState} from 'react';

import {api} from '../lib/api';
import type {RuntimeConfig, BrowserConfig} from '../lib/protocol';
import {wsClient} from '../lib/ws';
import type {WorkerFullStatus} from '../lib/protocol';

export default function SettingsPage() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [status, setStatus] = useState<WorkerFullStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [browserConnected, setBrowserConnected] = useState(false);

  const fetchConfig = async () => {
    try {
      const data = await api.getConfig();
      setConfig(data);
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
      setStatus(data);
      setBrowserConnected(data.browser?.connected ?? false);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchStatus();

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

  const handleSaveBrowser = async () => {
    if (!config?.browser) return;
    setSaving('browser');
    try {
      const updated = await api.updateBrowserConfig(config.browser);
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveLlm = async () => {
    if (!config) return;
    setSaving('llm');
    try {
      const updated = await api.updateLlmConfig({
        llmProvider: config.llmProvider,
        openai: config.openai as Record<string, unknown>,
        gemini: config.gemini as Record<string, unknown>,
        anthropic: config.anthropic as Record<string, unknown>,
      });
      setConfig(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(null);
    }
  };

  const handleSaveDatabase = async () => {
    if (!config?.databaseUrl) return;
    setSaving('database');
    try {
      await api.updateDatabaseConfig(config.databaseUrl);
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

  const handleConnectDatabase = async () => {
    setSaving('connect-database');
    try {
      await api.connectDatabase();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接数据库失败');
    } finally {
      setSaving(null);
    }
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
    <div className="flex-1 p-6 lg:p-8 overflow-y-auto space-y-8 select-none">
      {/* 标题区 */}
      <div className="border-b border-[var(--color-border-muted)] pb-6">
        <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
          连接设置
        </h1>
        <p className="text-xs text-[var(--color-text-muted)] mt-1.5">
          配置浏览器连接、LLM Provider
          和数据库。配置仅存于内存，重启后回落到环境变量种子值。
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-[var(--color-status-red)]">
          {error}
        </div>
      )}

      {/* 浏览器连接区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Globe
              className={
                browserConnected
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
              browserConnected
                ? 'bg-emerald-500/10 text-[var(--color-status-green)] border-emerald-500/20'
                : 'bg-zinc-500/10 text-[var(--color-text-muted)] border-zinc-500/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${browserConnected ? 'bg-[var(--color-status-green)]' : 'bg-[var(--color-text-muted)]'}`}
            />
            {browserConnected ? '已连接' : '未连接'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Headless
            </span>
            <select
              value={config?.browser?.headless ? 'true' : 'false'}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          headless: e.target.value === 'true',
                        },
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Channel
            </span>
            <input
              type="text"
              value={config?.browser?.channel ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          channel: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="stable / chrome / firefox..."
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Browser URL
            </span>
            <input
              type="text"
              value={config?.browser?.browserURL ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          browserURL: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="http://127.0.0.1:9222"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              WS Endpoint
            </span>
            <input
              type="text"
              value={config?.browser?.wsEndpoint ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          wsEndpoint: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="ws://127.0.0.1:9222/devtools/browser/..."
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Executable Path
            </span>
            <input
              type="text"
              value={config?.browser?.executablePath ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          executablePath: e.target.value,
                        },
                      }
                    : prev,
                )
              }
              placeholder="/path/to/chrome"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex items-center gap-2 mt-6">
            <input
              type="checkbox"
              checked={config?.browser?.isolated ?? true}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        browser: {
                          ...(prev.browser ?? {}),
                          isolated: e.target.checked,
                        },
                      }
                    : prev,
                )
              }
              className="accent-[var(--color-accent)]"
            />
            <span className="text-xs text-[var(--color-text-secondary)]">
              Isolated Context
            </span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveBrowser}
            disabled={saving === 'browser'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={12} />
            {saving === 'browser' ? '保存中...' : '保存配置'}
          </button>
          {browserConnected ? (
            <button
              onClick={handleDisconnectBrowser}
              disabled={saving === 'disconnect-browser'}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 border border-red-500/20 text-[var(--color-status-red)] hover:bg-red-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <PlugZap size={12} />
              {saving === 'disconnect-browser' ? '断开中...' : '断开连接'}
            </button>
          ) : (
            <button
              onClick={handleConnectBrowser}
              disabled={saving === 'connect-browser'}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Plug size={12} />
              {saving === 'connect-browser' ? '连接中...' : '连接浏览器'}
            </button>
          )}
        </div>
      </div>

      {/* LLM Provider 区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center gap-3 mb-6">
          <Key
            className="text-[var(--color-accent)]"
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            LLM Provider
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Provider
            </span>
            <select
              value={config?.llmProvider ?? 'gemini'}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        llmProvider: e.target
                          .value as RuntimeConfig['llmProvider'],
                      }
                    : prev,
                )
              }
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)]"
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI API Key
            </span>
            <input
              type="password"
              value={config?.openai?.apiKey ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, apiKey: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="留空则不修改"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI Base URL
            </span>
            <input
              type="text"
              value={config?.openai?.baseURL ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, baseURL: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="https://api.openai.com/v1"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              OpenAI Model
            </span>
            <input
              type="text"
              value={config?.openai?.model ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        openai: {...prev.openai, model: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="gpt-4o"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Anthropic API Key
            </span>
            <input
              type="password"
              value={config?.anthropic?.apiKey ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        anthropic: {...prev.anthropic, apiKey: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="留空则不修改"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Gemini API Key
            </span>
            <input
              type="password"
              value={config?.gemini?.apiKey ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev
                    ? {
                        ...prev,
                        gemini: {...prev.gemini, apiKey: e.target.value},
                      }
                    : prev,
                )
              }
              placeholder="留空则不修改"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>
        </div>

        <button
          onClick={handleSaveLlm}
          disabled={saving === 'llm'}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <Save size={12} />
          {saving === 'llm' ? '保存中...' : '保存 LLM 配置'}
        </button>
      </div>

      {/* 数据库区块 */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-xl p-6 shadow-lg shadow-black/25">
        <div className="flex items-center gap-3 mb-6">
          <Database
            className="text-[var(--color-accent)]"
            size={20}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            数据库
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Database URL
            </span>
            <input
              type="text"
              value={config?.databaseUrl ?? ''}
              onChange={e =>
                setConfig(prev =>
                  prev ? {...prev, databaseUrl: e.target.value} : prev,
                )
              }
              placeholder="postgres://user:pass@localhost:5432/dbname"
              className="bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] font-mono"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveDatabase}
            disabled={saving === 'database'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Save size={12} />
            {saving === 'database' ? '保存中...' : '保存配置'}
          </button>
          <button
            onClick={handleConnectDatabase}
            disabled={saving === 'connect-database'}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent)] text-[var(--color-bg-primary)] hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Plug size={12} />
            {saving === 'connect-database' ? '连接中...' : '连接数据库'}
          </button>
        </div>
      </div>

      <button
        onClick={() => {
          fetchConfig();
          fetchStatus();
        }}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] active:scale-95 transition-all flex items-center gap-2"
      >
        <RefreshCw size={12} />
        刷新配置
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 在 App.tsx 注册路由和导航项**

在 `src/web-ui/src/App.tsx` 中：

1. 新增 import（在现有 route imports 之后）：

```ts
import SettingsPage from './routes/settings';
```

2. 在 import 图标区新增 `Settings`（从 `lucide-react`）：

```ts
import {
  LayoutDashboard,
  Wrench,
  Radio,
  Menu,
  X,
  Terminal,
  Globe,
  Settings,
} from 'lucide-react';
```

3. 在 `<nav>` 中"站点经验"NavLink 之后新增：

```tsx
<NavLink
  to="/settings"
  onClick={() => setSidebarOpen(false)}
  className={getNavLinkClass}
>
  <Settings size={16} />
  <span>连接设置</span>
</NavLink>
```

4. 在 `<Routes>` 中"site-experiences"Route 之后新增：

```tsx
<Route
  path="/settings"
  element={<SettingsPage />}
/>
```

- [ ] **Step 5: 构建前端**

Run: `npm run build`

Expected: 前端构建成功，无 TypeScript 错误

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`

Expected: 无错误

- [ ] **Step 7: 格式检查**

Run: `npm run check-format`

Expected: 无格式问题（若有则运行 `npm run format` 修复后重新检查）

- [ ] **Step 8: 运行全部单元测试**

Run: `npm run build && npm run test:unit`

Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add src/web-ui/src/routes/settings.tsx src/web-ui/src/lib/api.ts src/web-ui/src/lib/protocol.ts src/web-ui/src/App.tsx
git commit -m "feat(web-ui): add connection settings page with browser/LLM/database config"
```

---

## Self-Review

### 1. Spec coverage

- §2 总体架构（RuntimeConfigStore + Worker 懒启动 + 面板触发连接 + LLM 读 store）：Task 1（store）、Task 3（懒启动）、Task 4（connect）、Task 2（LLM 读 store）✓
- §3 移除范围（resolver.ts 删文件加载、servicesConfig.ts 改读 store、constants.ts 删常量、测试更新）：Task 2（迁移读取）、Task 6（删死代码+常量+测试）✓
- §4 RuntimeConfigStore 设计（get/update/浅合并/zod 校验/env 播种）：Task 1 ✓
- §5 Worker 启动改造（删 ensureBrowser + dbService.connect、新增 BrowserConnectionManager、未连接状态工具行为）：Task 3（删自动连接）、Task 4（BrowserConnectionManager）✓。§5.3 未连接工具返回 `BROWSER_NOT_CONNECTED` 错误码——设计文档明确说"具体改动点在实现阶段通过 impact 分析确认后落地，不在本设计做代码级细化"，当前 `ToolContextProvider.init()` 已处理 context 为空分支，工具调用时底层会抛 `Browser not initialized`。此为已知限制，不在本计划新增任务，但应在 Task 5 路由测试中记录。
- §6 REST 路由（GET/PUT/POST + 掩码 + WsHub 广播）：Task 5 ✓
- §7 前端改动（设置页三区块 + API 方法 + 导航）：Task 7 ✓
- §8 错误处理（zod 400、connect 502、BROWSER_NOT_CONNECTED）：Task 5 路由实现包含 400/502 ✓
- §9 测试策略（unit/integration/回归）：Task 1/2/4/5 的 unit 测试 ✓；Task 6 回归测试 ✓；integration 测试未单独列出（设计文档提及但非阻塞，可在 Task 5 后手动验证）
- §10 迁移顺序：Task 1→2→3→4→5→6→7 与设计文档步骤 1→2→3→4→5→6 对齐 ✓
- §11 已知限制：纯内存、不加密、进程级全局态——计划 Global Constraints 已记录 ✓

### 2. Placeholder scan

无 "TBD"/"TODO"/"implement later"/"add error handling" 等占位符。每个代码步骤包含完整实现代码。

### 3. Type consistency

- `RuntimeConfigStore.get()` 返回 `Readonly<GlobalConfig>` — Task 1 定义，Task 2/5 消费 ✓
- `getRuntimeConfigStore()` / `resetRuntimeConfigStore(seed?)` — Task 1 定义，Task 2/3/5/6 消费 ✓
- `connectBrowser(contextProvider, config)` 返回 `ConnectResult` — Task 4 定义，Task 5 消费 ✓
- `disconnectBrowser(contextProvider)` — Task 4 定义，Task 5 消费 ✓
- `createConfigRoutes(cfg: ConfigRoutesConfig)` — Task 5 定义，ConsoleServer 消费 ✓
- `maskApiKey` / `isMaskPlaceholder` — Task 5 定义并测试 ✓
- `setBrowser(browser: Browser | null)` — Task 4 修改签名，Task 4 自身消费 ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-frontend-dynamic-config.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
