# 全景架构重构 Phase 1：基础设施解环与分层修正 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实施全景架构重构规范的 Phase 1（Milestone 1），解除 11 节点配置巨环与 WebSocket 双向环，清零 Level 0 基础层向 Level 1 的非法反向依赖，并落地本地 ESLint 静态分层架构门禁（`npm run check-arch`）。

**Architecture:** 依据 4 层严格单向分层模型（L3 接入层 → L2 调度层 → L1 领域核心层 → L0 基础支撑层），将下层依赖的共享契约类型（`BrowserManagerConfig`、`SourceMapError`/`SourceMapConfig`）下沉至 Level 0（`src/types/`）；将服务工厂（`createAIService`）移入 Level 1 服务层；消除 `resolver.ts` 冗余重导出与 `logger.ts`/`fsSafe.ts` 对配置的向上引入；迁移 `CacheAdapters.ts` 出 `utils/`；提取网络共享类型拆开环 4；摘除 `servicesConfig.ts` 的 `import/no-cycle` 抑制并配置 ESLint 分层门禁。

**Tech Stack:** TypeScript 5.x ESM, Node.js `node:test`, ESLint 9 Flat Config (`eslint-plugin-import`, `typescript-eslint`), SWC。

**Spec:** `docs/superpowers/specs/2026-09-04-architecture-master-spec.md` (重点涵盖 §2.1 目标 1-2、§3 分层模型、§5.1 环 1/4、§5.2 分层倒置、§6 门禁规范、§7 Phase 1 验收路线图)。

---

## Global Constraints

- **Node 运行环境与模块标准**：Node `^20.19.0 || ^22.12.0 || >=23`；TypeScript ESM，所有相对导入必须带 `.js` 扩展名、Node 原生模块必须带 `node:` 前缀。
- **编码与格式规范**：Prettier `singleQuote: true`、`trailingComma: all`、`arrowParens: avoid`、`endOfLine: lf`；ESLint 导入严格按字母序升序分组。
- **零新增依赖**：不引入 `dependency-cruiser` 或其他外部库，完全复用项目现有的 `eslint-plugin-import` 与 `no-restricted-imports`。
- **不破坏既有契约**：所有 MCP 工具契约（166 个 handler）向后兼容，保持 `npm run test:contracts` 100% 通过；保持反检测分层边界（零 JS 注入哲学）不变。
- **测试框架与镜像目录**：测试使用 Node 内置 `node:test` + `node:assert/strict`；新建源码文件需在 `tests/unit/` 下建立镜像测试。
- **提交规范**：每个 Task 完成并验证通过后执行一次 Git 提交，遵循 Conventional Commits（如 `refactor(arch):`、`fix(config):`、`test(arch):`），不附带 AI 署名。
- **已知已登记例外**：`src/config/RuntimeConfigStore.ts ⇄ src/config/resolver.ts` 的播种时序环依规范 §5.1 决议 A 保留并显式登记，Phase 4 再复核。

---

## Scope Check & Multi-Phase Roadmap

本项目架构重构覆盖全库 4 个层级，按主规范分成 4 个阶段里程碑：

- **Phase 1（本计划）**：基础设施解环与分层修正（解除环 1、环 4，消除 L0→L1 倒置，落地静态门禁）。
- **Phase 2（后续计划）**：God 模块拆解与调用链收敛（`browser.ts`、`tools/debugger/index.ts` 拆解，解除环 3/5/7）。
- **Phase 3（后续计划）**：调度与契约收敛（`types/index.ts` 领域下沉，64 个工具直连 runtime 改为 context 注入，解除环 6）。
- **Phase 4（后续计划）**：DRY 与生命周期治理（`CdpScriptFetcher` 统一，严格门禁与死代码清理）。

本计划专注于 **Phase 1 (Milestone 1)**，每个 Task 独立可测试、可交付。

---

## File Structure

| 动作     | 文件路径                                           | 职责说明                                                                                    |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **新建** | `src/types/browser.ts`                             | Level 0：浏览器基础配置接口 `BrowserManagerConfig` 与 `Channel` 类型                        |
| **新建** | `src/types/sourcemap.ts`                           | Level 0：SourceMap 错误类 `SourceMapError`、错误码与基础配置 `SourceMapConfig`              |
| **新建** | `src/services/createAIService.ts`                  | Level 1：AI 服务实例工厂函数，接收 `AIConfig` 实例化对应 Provider                           |
| **新建** | `src/modules/collector/adapters/CacheAdapters.ts`  | Level 1：原 `src/utils/CacheAdapters.ts` 迁移落点，适配 Collector 缓存                      |
| **新建** | `src/modules/network/types.ts`                     | Level 1：WebSocket 与网络共享消息/流量统计类型（打破环 4）                                  |
| **新建** | `tests/unit/config/servicesConfig.browser.test.ts` | 单元测试：验证 `getBrowserManagerConfig()` 在 L0 类型支撑下的解析行为                       |
| **新建** | `tests/unit/services/createAIService.test.ts`      | 单元测试：验证 AI 服务工厂函数的配置读取、初始化与错误分支                                  |
| **新建** | `tests/unit/utils/logger-env.test.ts`              | 单元测试：验证 `logger.ts` 纯环境变量驱动解析逻辑                                           |
| **新建** | `tests/unit/utils/fsSafe.test.ts`                  | 单元测试：验证 `fsSafe.ts` 纯环境变量驱动的安全路径校验                                     |
| **新建** | `tests/unit/modules/network/types.test.ts`         | 单元测试：验证网络共享类型与格式化器断开循环引用的契约稳定性                                |
| **修改** | `src/modules/browser/browser.ts`                   | 提取 `BrowserManagerConfig` 与 `Channel` 至 `src/types/browser.ts` 并 re-export             |
| **修改** | `src/modules/sourcemap/types.ts`                   | 提取 `SourceMapError` 等至 `src/types/sourcemap.ts` 并 re-export                            |
| **修改** | `src/config/servicesConfig.ts`                     | 移除 `createAIService` 及对 L1 的导入，改引 L0 `types/` 契约，摘除 eslint-disable           |
| **修改** | `src/config/resolver.ts`                           | 移除末尾对 `servicesConfig.ts` 的 9 个符号重导出，校订 disable 注释                         |
| **修改** | `src/config/RuntimeConfigStore.ts`                 | 校订 disable 注释指向决议 A                                                                 |
| **修改** | `src/runtime.ts`                                   | 将 `getBrowserManagerConfig` 改为直连 `config/servicesConfig.js`，更新 `CacheAdapters` 路径 |
| **修改** | `src/diagnostics/environment.ts`                   | 将 `getAIConfig`/`getDefaultLLMProvider` 改为直连 `config/servicesConfig.js`                |
| **修改** | `src/services/LLMService.ts`                       | 将 `createAIService` 改为直接从 `./createAIService.js` 导入                                 |
| **修改** | `src/web/routes/config.ts`                         | 将 `createAIService` 改为从 `../../services/createAIService.js` 导入                        |
| **修改** | `src/utils/logger.ts`                              | 移除 `getEnvValue` 导入，直读 `process.env.LOG_LEVEL`                                       |
| **修改** | `src/utils/fsSafe.ts`                              | 移除 `getEnvValue` 导入，直读 `process.env.BROWSER_OUTPUT_DIR`                              |
| **删除** | `src/utils/CacheAdapters.ts`                       | 消除 L0→L1 倒置，文件已迁至 `src/modules/collector/adapters/`                               |
| **修改** | `tests/unit/cache/CacheAdapters.test.ts`           | 更新 `CacheAdapters` 测试导入路径                                                           |
| **修改** | `tests/unit/utils/config.test.ts`                  | 更新 `createAIService` 测试导入路径                                                         |
| **修改** | `src/modules/network/NetworkTypes.ts`              | 改引 `modules/network/types.ts`，断开与 `websocketFormatter.ts` 的反向依赖                  |
| **修改** | `src/formatters/websocketFormatter.ts`             | 改引 `modules/network/types.ts` 并 re-export，消除双向引用                                  |
| **修改** | `package.json`                                     | 新增 `"check-arch"` 脚本命令                                                                |
| **修改** | `eslint.config.mjs`                                | 配置 L0 / L1 单向分层约束，排除 `src/web-ui/**`                                             |

---

### Task 1: 浏览器配置契约下沉至 Level 0 (`src/types/browser.ts`)

**Files:**

- Create: `src/types/browser.ts`
- Modify: `src/modules/browser/browser.ts:60-120, 203-240`
- Modify: `src/config/servicesConfig.ts:17`
- Test: `tests/unit/config/servicesConfig.browser.test.ts`

**Interfaces:**

- Consumes: 无（基础类型契约）。
- Produces: `src/types/browser.ts` 导出 `type Channel` 与 `interface BrowserManagerConfig`。`src/modules/browser/browser.ts` 保持向后兼容 re-export。`src/config/servicesConfig.ts` 仅依赖 `../types/browser.js`。

- [ ] **Step 1: 编写失败测试**

新建 `tests/unit/config/servicesConfig.browser.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import {getBrowserManagerConfig} from '../../../src/config/servicesConfig.js';
import type {BrowserManagerConfig} from '../../../src/types/browser.js';

test('getBrowserManagerConfig returns valid BrowserManagerConfig typed from L0', () => {
  const originalEnv = process.env.CHROME_HEADLESS;
  try {
    process.env.CHROME_HEADLESS = 'true';
    const config: BrowserManagerConfig = getBrowserManagerConfig();
    assert.equal(config.headless, true);
    assert.equal(typeof config, 'object');
  } finally {
    if (originalEnv === undefined) {
      delete process.env.CHROME_HEADLESS;
    } else {
      process.env.CHROME_HEADLESS = originalEnv;
    }
  }
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `npm run test:only -- tests/unit/config/servicesConfig.browser.test.ts`
预期: 编译或运行失败，报错找不到模块 `../../../src/types/browser.js`。

- [ ] **Step 3: 编写最小实现**

1. 创建 `src/types/browser.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type Channel =
  | 'stable'
  | 'beta'
  | 'dev'
  | 'canary'
  | 'chromium'
  | 'bidi-chromium'
  | 'bidi-chrome'
  | 'bidi-chrome-beta'
  | 'bidi-chrome-dev'
  | 'bidi-chrome-canary'
  | 'firefox'
  | 'moz-firefox';

export interface BrowserManagerConfig {
  headless?: boolean;
  executablePath?: string;
  channel?: Channel;
  isolated?: boolean;
  browserURL?: string;
  wsEndpoint?: string;
  remoteDebuggingUrl?: string;
  remoteDebuggingPort?: number;
  wsHeaders?: Record<string, string>;
  useStealthScripts?: boolean;
  cloak?: boolean;
  jsStealth?: boolean;
  fullStealthArgs?: boolean;
  minimalStealth?: boolean;
  acceptInsecureCerts?: boolean;
  userDataDir?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
  ignoreDefaultArgs?: string[] | boolean;
  proxy?: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
  defaultTimeout?: number;
  autoClose?: boolean;
  devtools?: boolean;
}
```

1. 修改 `src/modules/browser/browser.ts`:
   删除原 `export type Channel = ...` 与 `export interface BrowserManagerConfig { ... }` 定义，替换为从 `src/types/browser.js` 导入并重导出：

```typescript
import type {BrowserManagerConfig, Channel} from '../../types/browser.js';
export type {BrowserManagerConfig, Channel};
```

1. 修改 `src/config/servicesConfig.ts:17`:
   将：

```typescript
import type {BrowserManagerConfig} from '../modules/browser/browser.js';
```

替换为：

```typescript
import type {BrowserManagerConfig} from '../types/browser.js';
```

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/config/servicesConfig.browser.test.ts`
预期: PASS。

- [ ] **Step 5: 提交更改**

```bash
git add src/types/browser.ts src/modules/browser/browser.ts src/config/servicesConfig.ts tests/unit/config/servicesConfig.browser.test.ts
git commit -m "refactor(config): move BrowserManagerConfig to types/browser.ts"
```

---

### Task 2: SourceMap 配置与错误类型下沉至 Level 0 (`src/types/sourcemap.ts`)

**Files:**

- Create: `src/types/sourcemap.ts`
- Modify: `src/modules/sourcemap/types.ts:10-35, 122-135`
- Modify: `src/config/servicesConfig.ts:18-20`
- Test: `tests/unit/config/servicesConfig.sourcemap.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces: `src/types/sourcemap.ts` 导出 `SourceMapErrorCode`、`SourceMapError` 与 `SourceMapConfig`。`src/modules/sourcemap/types.ts` re-export 保持向后兼容。`src/config/servicesConfig.ts` 消除向 `modules/sourcemap/types.ts` 的价值引用。

- [ ] **Step 1: 验证现有测试运行正常**

运行: `npm run test:only -- tests/unit/config/servicesConfig.sourcemap.test.ts`
预期: 现有测试通过，建立基线。

- [ ] **Step 2: 创建 Level 0 类型契约 `src/types/sourcemap.ts`**

创建 `src/types/sourcemap.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SourceMapErrorCode =
  | 'INVALID_SOURCE_INPUT'
  | 'SCRIPT_NOT_FOUND'
  | 'SOURCEMAP_REFERENCE_NOT_FOUND'
  | 'FETCH_BLOCKED'
  | 'FETCH_TOO_LARGE'
  | 'FETCH_TIMEOUT'
  | 'INDEXED_MAP_LIMIT_EXCEEDED'
  | 'PARSE_FAILED'
  | 'UNSUPPORTED_SEMANTICS'
  | 'MAP_NOT_FOUND'
  | 'OUTPUT_PATH_REQUIRED'
  | 'PATH_BLOCKED'
  | 'OUTPUT_EXISTS'
  | 'SOURCEMAP_CONFIG_INVALID';

export class SourceMapError extends Error {
  constructor(
    readonly code: SourceMapErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SourceMapError';
  }
}

export interface SourceMapConfig {
  maxMapSizeBytes: number;
  maxCacheSizeBytes: number;
  maxCacheEntries: number;
  cacheTtlMs: number;
  downloadTimeoutMs: number;
  maxSections: number;
}
```

- [ ] **Step 3: 修改 `src/modules/sourcemap/types.ts` 与 `src/config/servicesConfig.ts`**

1. 修改 `src/modules/sourcemap/types.ts`：
   移除原 `SourceMapErrorCode`、`SourceMapError`、`SourceMapConfig` 的声明，改为从 `../../types/sourcemap.js` 导入并重导出：

```typescript
export {
  SourceMapError,
  type SourceMapConfig,
  type SourceMapErrorCode,
} from '../../types/sourcemap.js';
```

1. 修改 `src/config/servicesConfig.ts:18-20`：
   将：

```typescript
import {
  type SourceMapConfig,
  SourceMapError,
} from '../modules/sourcemap/types.js';
```

改为：

```typescript
import {type SourceMapConfig, SourceMapError} from '../types/sourcemap.js';
```

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/config/servicesConfig.sourcemap.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/types/sourcemap.ts src/modules/sourcemap/types.ts src/config/servicesConfig.ts
git commit -m "refactor(config): move SourceMapError and SourceMapConfig to types/sourcemap.ts"
```

---

### Task 3: 提取 AI 服务工厂至 Level 1 (`src/services/createAIService.ts`)

**Files:**

- Create: `src/services/createAIService.ts`
- Modify: `src/config/servicesConfig.ts:22-24, 431-465`
- Modify: `src/services/LLMService.ts:6, 27`
- Modify: `src/web/routes/config.ts:40`
- Modify: `tests/unit/utils/config.test.ts:29`
- Create: `tests/unit/services/createAIService.test.ts`

**Interfaces:**

- Consumes: `getAIConfig()` 与 `AIConfig`（来自 `src/config/servicesConfig.js`），`AIService` 与 `RetryConfig`（来自 `src/services/AIService.js`），`OpenAIProvider`（来自 `src/services/OpenAIProvider.js`）。
- Produces: `export function createAIService(config?: AIConfig, retryConfig?: Partial<RetryConfig>): AIService | undefined` 移入 `src/services/createAIService.ts`。`src/config/servicesConfig.ts` 彻底移除对 `AIService` 和 `OpenAIProvider` 的依赖。

- [ ] **Step 1: 编写失败测试**

新建 `tests/unit/services/createAIService.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import type {AIConfig} from '../../../src/config/schema.js';
import {AIService} from '../../../src/services/AIService.js';
import {createAIService} from '../../../src/services/createAIService.js';

test('createAIService creates AIService instance when given valid openai config', () => {
  const config: AIConfig = {
    provider: 'openai',
    openai: {
      apiKey: 'test-api-key',
      baseURL: 'https://api.example.com/v1',
      model: 'gpt-4o',
    },
  };

  const service = createAIService(config);
  assert(service instanceof AIService);
  assert.equal(service.isAvailable(), true);
});

test('createAIService returns undefined when config is missing', () => {
  const service = createAIService(null as unknown as AIConfig);
  assert.equal(service, undefined);
});

test('createAIService throws error for unsupported provider', () => {
  const config = {
    provider: 'unsupported-provider' as unknown,
  } as AIConfig;

  assert.throws(() => createAIService(config), {
    message: /Unknown provider: unsupported-provider/,
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `npm run test:only -- tests/unit/services/createAIService.test.ts`
预期: 编译错误，找不到模块 `src/services/createAIService.js`。

- [ ] **Step 3: 编写最小实现与消费方迁移**

1. 创建 `src/services/createAIService.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {type AIConfig} from '../config/schema.js';
import {getAIConfig} from '../config/servicesConfig.js';

import {type RetryConfig, AIService} from './AIService.js';
import {OpenAIProvider} from './OpenAIProvider.js';

/**
 * 创建 AI Service 实例
 *
 * @param config AI 配置，缺省走 getAIConfig()
 * @param retryConfig 重试策略覆盖；连接测试等场景传 {maxRetries: 0} 快速失败
 */
export function createAIService(
  config?: AIConfig,
  retryConfig?: Partial<RetryConfig>,
): AIService | undefined {
  const aiConfig = config || getAIConfig();

  if (!aiConfig) {
    return undefined;
  }

  const {provider} = aiConfig;

  switch (provider) {
    case 'openai': {
      if (!aiConfig.openai) {
        throw new Error('OpenAI configuration not found');
      }
      return new AIService(
        new OpenAIProvider({
          apiKey: aiConfig.openai.apiKey,
          baseURL: aiConfig.openai.baseURL,
          model: aiConfig.openai.model,
        }),
        retryConfig,
      );
    }

    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
```

1. 修改 `src/config/servicesConfig.ts`:

- 移除 lines 22-23:

  ```typescript
  import {type RetryConfig, AIService} from '../services/AIService.js';
  import {OpenAIProvider} from '../services/OpenAIProvider.js';
  ```

- 移除 lines 431-465 的 `createAIService` 函数定义。

1. 修改 `src/services/LLMService.ts:6`:
   将：

```typescript
import {createAIService} from '../config.js';
```

改为：

```typescript
import {createAIService} from './createAIService.js';
```

1. 修改 `src/web/routes/config.ts:40`:
   将：

```typescript
import {
  getBrowserManagerConfig,
  getAIConfig,
  getDefaultLLMProvider,
  createAIService,
} from '../../config/servicesConfig.js';
```

改为：

```typescript
import {
  getBrowserManagerConfig,
  getAIConfig,
  getDefaultLLMProvider,
} from '../../config/servicesConfig.js';
import {createAIService} from '../../services/createAIService.js';
```

1. 修改 `tests/unit/utils/config.test.ts`:
   将 `createAIService` 的导入从 `src/config/resolver.js` 或 `src/utils/config.js` 改为直接从 `src/services/createAIService.js` 导入。

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/services/createAIService.test.ts tests/unit/utils/config.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/services/createAIService.ts src/config/servicesConfig.ts src/services/LLMService.ts src/web/routes/config.ts tests/unit/services/createAIService.test.ts tests/unit/utils/config.test.ts
git commit -m "refactor(services): move createAIService to services/ layer"
```

---

### Task 4: 移除 `resolver.ts` 冗余重导出并直连消费方

**Files:**

- Modify: `src/config/resolver.ts:333-343`
- Modify: `src/runtime.ts:6`
- Modify: `src/diagnostics/environment.ts:10`
- Create: `tests/unit/config/resolver-exports.test.ts`

**Interfaces:**

- Consumes: `src/config/servicesConfig.js`。
- Produces: `src/config/resolver.ts` 不再向下依赖 `servicesConfig.ts`（彻底切断 `servicesConfig ⇄ resolver` 双向重导出）。`runtime.ts` 与 `diagnostics/environment.ts` 直连 `config/servicesConfig.js`。

- [ ] **Step 1: 编写失败测试**

新建 `tests/unit/config/resolver-exports.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import * as resolver from '../../../src/config/resolver.js';
import * as servicesConfig from '../../../src/config/servicesConfig.js';

test('resolver does not re-export servicesConfig symbols', () => {
  const resolverAny = resolver as Record<string, unknown>;
  assert.equal(resolverAny.createAIService, undefined);
  assert.equal(resolverAny.getBrowserManagerConfig, undefined);
  assert.equal(resolverAny.getAIConfig, undefined);
});

test('servicesConfig exports browser and system config functions directly', () => {
  assert.equal(typeof servicesConfig.getBrowserManagerConfig, 'function');
  assert.equal(typeof servicesConfig.getAIConfig, 'function');
  assert.equal(typeof servicesConfig.getDefaultLLMProvider, 'function');
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `npm run test:only -- tests/unit/config/resolver-exports.test.ts`
预期: FAIL（`assert.equal(resolverAny.getBrowserManagerConfig, undefined)` 失败，因为目前仍有 re-export）。

- [ ] **Step 3: 移除 `resolver.ts` 的 re-export 并更新消费方**

1. 修改 `src/config/resolver.ts:330-345`:
   删除以下块：

```typescript
// ==========================================================================
// 第三部分：服务配置（AI / Browser / System）— 已拆分至 servicesConfig.ts
// ==========================================================================

export {
  createAIService,
  getAIConfig,
  getBrowserConfig,
  getBrowserManagerConfig,
  getDefaultLLMProvider,
  getEnv,
  getSystemConfig,
  isDebugEnabled,
  validateConfig,
} from './servicesConfig.js';
```

1. 修改 `src/runtime.ts:6`:
   将：

```typescript
import {getBrowserManagerConfig} from './config.js';
```

改为：

```typescript
import {getBrowserManagerConfig} from './config/servicesConfig.js';
```

1. 修改 `src/diagnostics/environment.ts:10`:
   将：

```typescript
import {getDefaultLLMProvider, getAIConfig} from '../config/resolver.js';
```

改为：

```typescript
import {getDefaultLLMProvider, getAIConfig} from '../config/servicesConfig.js';
```

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/config/resolver-exports.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/config/resolver.ts src/runtime.ts src/diagnostics/environment.ts tests/unit/config/resolver-exports.test.ts
git commit -m "refactor(config): remove servicesConfig re-exports from resolver.ts"
```

---

### Task 5: 解耦日志与通用工具对配置层的依赖 (`logger.ts`, `fsSafe.ts`)

**Files:**

- Modify: `src/utils/logger.ts:20, 294`
- Modify: `src/utils/fsSafe.ts:10, 31`
- Create: `tests/unit/utils/logger-env.test.ts`
- Create: `tests/unit/utils/fsSafe.test.ts`

**Interfaces:**

- Consumes: 原生 `process.env.LOG_LEVEL` 与 `process.env.BROWSER_OUTPUT_DIR`。
- Produces: `src/utils/logger.ts` 与 `src/utils/fsSafe.ts` 彻底移除对 `../config.js` 的引用。

- [ ] **Step 1: 编写失败测试**

1. 新建 `tests/unit/utils/logger-env.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import {Logger} from '../../../src/utils/logger.js';

test('Logger respects LOG_LEVEL environment parsing without config dependency', () => {
  const testLogger = new Logger('warn');
  assert.equal(testLogger.level, 'warn');
});
```

1. 新建 `tests/unit/utils/fsSafe.test.ts`:

```typescript
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {validateOutputPath} from '../../../src/utils/fsSafe.js';

test('validateOutputPath permits paths within allowed output dir', () => {
  const resolved = validateOutputPath('sub/dir/output.json');
  assert.equal(resolved, path.resolve('sub/dir/output.json'));
});

test('validateOutputPath rejects directory traversal escaping base', () => {
  assert.throws(() => validateOutputPath('../../etc/passwd'), {
    message: /Path traversal blocked/,
  });
});
```

- [ ] **Step 2: 运行测试验证**

运行: `npm run test:only -- tests/unit/utils/logger-env.test.ts tests/unit/utils/fsSafe.test.ts`
预期: PASS（已有行为可跑通）。

- [ ] **Step 3: 消除 `../config.js` 导入**

1. 修改 `src/utils/logger.ts`:

- 移除 line 20:

  ```typescript
  import {getEnvValue} from '../config.js';
  ```

- 修改 line 294（或原 `new Logger(parseLogLevel(...))`）为：

  ```typescript
  export const logger = new Logger(parseLogLevel(process.env.LOG_LEVEL));
  ```

1. 修改 `src/utils/fsSafe.ts`:

- 移除 line 10:

  ```typescript
  import {getEnvValue} from '../config.js';
  ```

- 修改 line 31:

  ```typescript
  const allowedBase = process.env.BROWSER_OUTPUT_DIR?.trim() || process.cwd();
  ```

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/utils/logger-env.test.ts tests/unit/utils/fsSafe.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/utils/logger.ts src/utils/fsSafe.ts tests/unit/utils/logger-env.test.ts tests/unit/utils/fsSafe.test.ts
git commit -m "refactor(utils): read env directly in logger.ts and fsSafe.ts, removing config import"
```

---

### Task 6: 迁移缓存适配器至收集器模块 (`src/modules/collector/adapters/CacheAdapters.ts`)

**Files:**

- Create: `src/modules/collector/adapters/CacheAdapters.ts`
- Delete: `src/utils/CacheAdapters.ts`
- Modify: `src/runtime.ts:36-39`
- Modify: `tests/unit/cache/CacheAdapters.test.ts:15-16`

**Interfaces:**

- Consumes: `CodeCache`、`CodeCompressor`（来自 `src/modules/collector/`），`DetailedDataManager` 与 `UnifiedCacheManager`（来自 `src/utils/`）。
- Produces: `src/modules/collector/adapters/CacheAdapters.ts` 导出 `CodeCacheAdapter`、`CodeCompressorAdapter`、`DetailedDataManagerAdapter`、`createCacheAdapters`。`src/utils/` 彻底消除对 `modules/collector/` 的非法向上引用。

- [ ] **Step 1: 创建新适配器文件并更新相对路径**

创建 `src/modules/collector/adapters/CacheAdapters.ts`（复制原 `src/utils/CacheAdapters.ts` 并调整导入）：

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 缓存适配器 - 将现有缓存适配到 UnifiedCacheManager
 *
 * 适配器模式：
 * - 不修改现有缓存实现
 * - 提供统一的接口
 * - 支持异步和同步方法
 */

import type {DetailedDataManager} from '../../../utils/detailedDataManager.js';
import type {
  CacheInstance,
  CacheStats,
} from '../../../utils/UnifiedCacheManager.js';
import type {CodeCache} from '../CodeCache.js';
import type {CodeCompressor} from '../CodeCompressor.js';

export class DetailedDataManagerAdapter implements CacheInstance {
  name = 'DetailedDataManager';

  constructor(private manager: DetailedDataManager) {}

  getStats(): CacheStats {
    const stats = this.manager.getStats();
    return {
      entries: stats.cacheSize,
      size: this.estimateSize(stats.cacheSize),
      hits: 0,
      misses: 0,
      ttl: stats.defaultTTLSeconds * 1000,
      maxSize: stats.maxCacheSize,
    };
  }

  clear(): void {
    this.manager.clear();
  }

  private estimateSize(entries: number): number {
    return entries * 50 * 1024;
  }
}

export class CodeCacheAdapter implements CacheInstance {
  name = 'CodeCache';

  constructor(private cache: CodeCache) {}

  getStats(): CacheStats {
    const stats = this.cache.getStats();
    return {
      entries: stats.totalEntries,
      size: stats.totalSize,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: stats.hitRate,
    };
  }

  clear(): void {
    this.cache.clear();
  }
}

export class CodeCompressorAdapter implements CacheInstance {
  name = 'CodeCompressor';

  constructor(private compressor: CodeCompressor) {}

  getStats(): CacheStats {
    const stats = this.compressor.getStats();
    return {
      entries: stats.cacheEntries,
      size: stats.cacheSize,
      hits: stats.cacheHits,
      misses: stats.cacheMisses,
      hitRate: stats.cacheHitRate,
    };
  }

  clear(): void {
    this.compressor.clearCache();
  }
}

export function createCacheAdapters(options: {
  detailedDataManager?: DetailedDataManager;
  codeCache?: CodeCache;
  codeCompressor?: CodeCompressor;
}): CacheInstance[] {
  const adapters: CacheInstance[] = [];

  if (options.detailedDataManager) {
    adapters.push(new DetailedDataManagerAdapter(options.detailedDataManager));
  }

  if (options.codeCache) {
    adapters.push(new CodeCacheAdapter(options.codeCache));
  }

  if (options.codeCompressor) {
    adapters.push(new CodeCompressorAdapter(options.codeCompressor));
  }

  return adapters;
}
```

- [ ] **Step 2: 删除原 `src/utils/CacheAdapters.ts`**

执行: `rm src/utils/CacheAdapters.ts`。

- [ ] **Step 3: 更新调用方与测试导入**

1. 修改 `src/runtime.ts:36-39`:
   将：

```typescript
import {CodeCacheAdapter, createCacheAdapters} from './utils/CacheAdapters.js';
```

改为：

```typescript
import {
  CodeCacheAdapter,
  createCacheAdapters,
} from './modules/collector/adapters/CacheAdapters.js';
```

1. 修改 `tests/unit/cache/CacheAdapters.test.ts:14-17`:
   将：

```typescript
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  createCacheAdapters,
  DetailedDataManagerAdapter,
} from '../../../src/utils/CacheAdapters.js';
```

改为：

```typescript
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  createCacheAdapters,
  DetailedDataManagerAdapter,
} from '../../../src/modules/collector/adapters/CacheAdapters.js';
```

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/cache/CacheAdapters.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/modules/collector/adapters/CacheAdapters.ts src/runtime.ts tests/unit/cache/CacheAdapters.test.ts
git rm src/utils/CacheAdapters.ts
git commit -m "refactor(collector): move CacheAdapters from utils to collector/adapters"
```

---

### Task 7: 解除环 4：提取共享 WebSocket 类型至 `src/modules/network/types.ts`

**Files:**

- Create: `src/modules/network/types.ts`
- Modify: `src/modules/network/NetworkTypes.ts:16-20`
- Modify: `src/formatters/websocketFormatter.ts:10-48, 590-595`
- Create: `tests/unit/modules/network/types.test.ts`
- Test: `tests/unit/formatters/websocketFormatter.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces: `src/modules/network/types.ts` 导出 `SizeCategory`、`MessageGroupV2`、`TrafficSummary`、`WsDecodeMode`。`src/modules/network/NetworkTypes.ts` 与 `src/formatters/websocketFormatter.ts` 单向依赖该类型文件，彻底消除两者之间的双向引用（环 4）。

- [ ] **Step 1: 编写失败测试**

新建 `tests/unit/modules/network/types.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  TrafficSummary,
  WsDecodeMode,
} from '../../../src/modules/network/types.js';

test('network/types defines TrafficSummary and WsDecodeMode cleanly', () => {
  const mode: WsDecodeMode = 'json';
  assert.equal(mode, 'json');

  const summary: TrafficSummary = {
    wsid: 1,
    url: 'wss://example.com/ws',
    durationMs: 100,
    totalFrames: 2,
    sentCount: 1,
    receivedCount: 1,
    groups: [],
    groupToIndices: new Map(),
  };
  assert.equal(summary.wsid, 1);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行: `npm run test:only -- tests/unit/modules/network/types.test.ts`
预期: 编译错误，找不到 `src/modules/network/types.js`。

- [ ] **Step 3: 提取公共类型并调整导入**

1. 创建 `src/modules/network/types.ts`:

```typescript
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type SizeCategory = 'tiny' | 'small' | 'medium' | 'large' | 'xlarge';

export interface MessageGroupV2 {
  id: string;
  direction: 'sent' | 'received';
  head4B: string;
  sizeCategory: SizeCategory;
  count: number;
  minSize: number;
  maxSize: number;
  hint: string;
  sampleIndices: number[];
}

export interface TrafficSummary {
  wsid: number;
  url: string;
  durationMs: number;
  totalFrames: number;
  sentCount: number;
  receivedCount: number;
  groups: MessageGroupV2[];
  groupToIndices: Map<string, number[]>;
}

export type WsDecodeMode = 'auto' | 'protobuf' | 'json' | 'raw';
```

1. 修改 `src/modules/network/NetworkTypes.ts:16-20`:
   将：

```typescript
import type {
  TrafficSummary,
  WsDecodeMode,
} from '../../formatters/websocketFormatter.js';
```

替换为：

```typescript
import type {TrafficSummary, WsDecodeMode} from './types.js';
```

并保持 re-export:

```typescript
export type {TrafficSummary, WsDecodeMode};
```

1. 修改 `src/formatters/websocketFormatter.ts`:

- 引入共享类型并 re-export:

  ```typescript
  import type {
    MessageGroupV2,
    SizeCategory,
    TrafficSummary,
    WsDecodeMode,
  } from '../modules/network/types.js';
  export type {MessageGroupV2, SizeCategory, TrafficSummary, WsDecodeMode};
  ```

- 移除原文件中重复的 `export type SizeCategory = ...`、`export interface MessageGroupV2 { ... }`、`export interface TrafficSummary { ... }`、`export type WsDecodeMode = ...` 声明。

- [ ] **Step 4: 运行测试验证通过**

运行: `npm run test:only -- tests/unit/modules/network/types.test.ts tests/unit/formatters/websocketFormatter.test.ts`
预期: PASS。
运行: `npm run typecheck`
预期: 0 errors。

- [ ] **Step 5: 提交更改**

```bash
git add src/modules/network/types.ts src/modules/network/NetworkTypes.ts src/formatters/websocketFormatter.ts tests/unit/modules/network/types.test.ts
git commit -m "refactor(network): extract WebSocket types to network/types.ts to break SCC 4"
```

---

### Task 8: 摘除 `servicesConfig.ts` 抑制注释并校订已知时序例外

**Files:**

- Modify: `src/config/servicesConfig.ts:7`
- Modify: `src/config/resolver.ts:7`
- Modify: `src/config/RuntimeConfigStore.ts:17`

**Interfaces:**

- Consumes: Task 1–4 完成后的解环成果。
- Produces: `servicesConfig.ts` 移除 `import/no-cycle` 抑制；`resolver.ts` 与 `RuntimeConfigStore.ts` 注释明确标注文档出处与决议 A。

- [ ] **Step 1: 移除 `src/config/servicesConfig.ts:7` 的 eslint-disable**

编辑 `src/config/servicesConfig.ts`，删除第 7 行：

```typescript
/* eslint-disable import/no-cycle -- servicesConfig consumes core resolver helpers (getEnvValue/configFromEnv) while resolver re-exports these factories for backward compat. The mutual dependency is intentional. */
```

- [ ] **Step 2: 校订 `resolver.ts` 与 `RuntimeConfigStore.ts` 的注释**

1. 在 `src/config/resolver.ts:7`，更新注释：

```typescript
/* eslint-disable import/no-cycle -- 已知例外：configFromEnv() 播种 store 与 getRuntimeConfigStore() 读回 store 的初始化时序契约。见 spec §2.1 目标 2 与 §5.1 环 1 决议 A，Phase 4 复核。 */
```

1. 在 `src/config/RuntimeConfigStore.ts:17`，更新注释：

```typescript
/* eslint-disable import/no-cycle -- 已知例外：configFromEnv() 播种 store 与 getRuntimeConfigStore() 读回 store 的初始化时序契约。见 spec §2.1 目标 2 与 §5.1 环 1 决议 A，Phase 4 复核。 */
```

- [ ] **Step 3: 运行 ESLint 校验该目录**

运行: `npx eslint src/config/`
预期: 0 errors, 0 warnings。无任何由 `servicesConfig.ts` 引发的 cycle 错误。

- [ ] **Step 4: 提交更改**

```bash
git add src/config/servicesConfig.ts src/config/resolver.ts src/config/RuntimeConfigStore.ts
git commit -m "fix(config): remove no-cycle disable from servicesConfig and align store exception comments"
```

---

### Task 9: 落地静态架构门禁规则与 `npm run check-arch`

**Files:**

- Modify: `package.json`
- Modify: `eslint.config.mjs`

**Interfaces:**

- Consumes: ESLint Flat Config 与 `import/no-cycle`。
- Produces: `package.json` 中的 `"check-arch"` 脚本；`eslint.config.mjs` 中的 Level 0 与 Level 1 严格单向分层拦截规则。

- [ ] **Step 1: 在 `eslint.config.mjs` 中添加架构分层规则块**

在 `eslint.config.mjs` 数组末尾添加两组规则，强制执行 Rule D1（禁止 L0 依赖 L1/L2/L3，禁止 L1 依赖 L2/L3），并显式排除 `src/web-ui/**`:

```javascript
  {
    name: 'Architecture: Level 0 Layering Purity',
    files: [
      'src/utils/**/*.ts',
      'src/config/**/*.ts',
      'src/config.ts',
      'src/types/**/*.ts',
      'src/third_party/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/modules/**',
                '**/services/**',
                '**/formatters/**',
                '**/worker/**',
                '**/reverse/**',
                '**/tools/**',
                '**/web/**',
                '**/ipc/**',
                '../*/modules/**',
                '../*/services/**',
                '../*/formatters/**',
                '../*/worker/**',
                '../*/reverse/**',
                '../*/tools/**',
                '../*/web/**',
                '../*/ipc/**',
              ],
              message:
                'Rule D1 Violation: Level 0 (utils, config, types, third_party) must not import from Level 1, 2, or 3.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Architecture: Level 1 Layering Purity',
    files: [
      'src/modules/**/*.ts',
      'src/services/**/*.ts',
      'src/formatters/**/*.ts',
      'src/trace-processing/**/*.ts',
      'src/diagnostics/**/*.ts',
      'src/database/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/worker/**',
                '**/reverse/**',
                '**/tools/**',
                '**/web/**',
                '**/ipc/**',
                '../*/worker/**',
                '../*/reverse/**',
                '../*/tools/**',
                '../*/web/**',
                '../*/ipc/**',
              ],
              message:
                'Rule D1 Violation: Level 1 (domain modules, services, formatters) must not import from Level 2 or 3.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 2: 在 `package.json` 中添加 `"check-arch"` 脚本**

在 `package.json` 的 `"scripts"` 中添加：

```json
"check-arch": "eslint --cache src"
```

- [ ] **Step 3: 运行 `npm run check-arch` 验证**

运行: `npm run check-arch`
预期: PASS，0 errors。

- [ ] **Step 4: 提交更改**

```bash
git add package.json eslint.config.mjs
git commit -m "feat(arch): add check-arch script and downward-only layering eslint rules"
```

---

### Task 10: Phase 1 全局集成验收与门禁闭环

**Files:**

- None (全流程集成验证与状态复核)

**Interfaces:**

- Consumes: Task 1–9 的全部产出。
- Produces: 验证报告与 Milestone 1 交付证明。

- [ ] **Step 1: 运行类型检查**

运行: `npm run typecheck`
预期: PASS (0 errors)。

- [ ] **Step 2: 运行单元测试**

运行: `npm run test:unit`
预期: 全部测试 PASS。

- [ ] **Step 3: 运行工具契约测试（保护 166 个已注册工具契约）**

运行: `npm run test:contracts`
预期: PASS (7 tests across 2 suites)。

- [ ] **Step 4: 运行格式与 Lint 检查**

运行: `npm run check-format`
预期: PASS。

- [ ] **Step 5: 运行架构门禁**

运行: `npm run check-arch`
预期: PASS。

- [ ] **Step 6: 静态复核 SCC 与分层状态**

运行静态检查脚本复核：

1. 文件级 SCC 从 7 组降至 5 组（环 1 彻底收缩为 `RuntimeConfigStore ⇄ resolver` 登记例外，环 4 消除）。
2. 全库 Level 0 → Level 1 VALUE import 降为 0 条。
3. `src/config/servicesConfig.ts` 纯净度恢复（0 条 L1 依赖）。

- [ ] **Step 7: 确认工作区整洁**

运行: `git status`
预期: clean, nothing to commit.
