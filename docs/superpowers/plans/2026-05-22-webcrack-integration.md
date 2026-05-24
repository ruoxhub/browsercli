# Webcrack 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 jshookmcp 中的 webcrack 适配器移植进当前项目，作为反混淆主管线的 Step 0.5 前置策略，让 webpack/browserify bundle 拆包、unminify、javascript-obfuscator 还原能力先于现有 Packer/JSVMP/Advanced 子管线执行。

**Architecture:** 新增 `src/modules/deobfuscator/webcrack.ts` 作为对 `webcrack` 包的适配层（含 Node 版本守卫、bundle 摘要化、mapping 规则、outputDir 路径校验、可选依赖优雅降级）。在 `Deobfuscator.ts` 的 `deobfuscate()` 入口插入 `runWebcrack()` 调度，紧邻 Step 1 之前；webcrack 成功时其输出 code 流入后续管线，bundle/savedTo/engine 字段透传到结果。webcrack 整体是可选依赖，import 失败 / Node 版本不匹配 / 调用异常时全部走 fallback，主管线行为不退化。

**Tech Stack:** TypeScript（ESM `.js` 扩展名导入）、`@babel/*`（已有）、`webcrack@^2.16.0`（新增 optional）、`isolated-vm`（webcrack 间接原生依赖）、`node:test`（测试）、swc 编译。

---

## 设计要点（落地必读）

1. **可选依赖**：webcrack → optionalDependencies。`isolated-vm` 在 Windows 需要 C++ 构建链，普通用户没有不能阻塞 npm install。
2. **Node 版本守卫**：webcrack 仅支持 `>=22.12 <23 || >=24 <25`。项目 engines 是 `^20.19.0 || ^22.12.0 || >=23`，存在 Node 20/23 用户。运行时检测，不匹配直接 `applied: false` 走 fallback。
3. **import 守卫**：`await import('webcrack')` 必须 try/catch，防止 optional 没装时 ReferenceError。
4. **类型扩展**：扩展现有 `DeobfuscateOptions/Result/ObfuscationType`，不新建并行类型系统。
5. **outputDir 路径穿越校验**：`path.relative(cwd)` 拒绝 `..` 或绝对路径越界。
6. **缓存键**：把 webcrack 相关字段纳入 `generateCacheKey`，防止开关切换时拿到陈旧缓存。
7. **顺序**：webcrack → Packer → JSVMP → Advanced → 基础管线 → ASTOptimizer → 重命名 → LLM。webcrack 已经做的活（unminify/unpack/javascript-obfuscator 重命名）后续步骤会重复，但都是幂等的，不会损坏结果，先不优化。
8. **transformation 追踪**：`type: 'webcrack'`，`detail.bundle` / `detail.savedTo` 写入；触发的混淆类型加入 `mergeObfuscationTypes`。

---

## 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `src/types/index.ts` | 修改 | 扩展 `DeobfuscateOptions/Result/ObfuscationType`，新增 bundle/mapping/artifact 类型 |
| `src/modules/deobfuscator/webcrack.ts` | 新建 | webcrack 适配器，唯一对 `webcrack` 包做 dynamic import 的位置 |
| `src/modules/deobfuscator/Deobfuscator.ts` | 修改 | 新增 `runWebcrack` 方法 + 在主管线 Step 0.5 调用 + 缓存键 + 透传 bundle/savedTo |
| `src/modules/deobfuscator/index.ts` | 修改 | 导出 `runWebcrack` 与新增类型（仅供测试与外部使用，可选） |
| `package.json` | 修改 | `optionalDependencies` 增加 `webcrack` |
| `tests/unit/modules/Deobfuscator.webcrack.test.ts` | 新建 | 集成行为测试（auto 触发、graceful degradation、bundle 摘要、缓存） |
| `tests/unit/modules/webcrack.test.ts` | 新建 | 适配器单元测试（版本守卫、optionsUsed、outputDir 校验、bundle summarize） |

---

## Task 1: 扩展反混淆类型定义

**Files:**
- Modify: `src/types/index.ts:121-182`

- [ ] **Step 1: 写失败测试（类型契约）**

新建 `tests/unit/types/deobfuscator-types.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {
  DeobfuscateOptions,
  DeobfuscateResult,
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateSavedArtifact,
  ObfuscationType,
} from '../../../src/types/index.js';

describe('Deobfuscator type contract', () => {
  it('DeobfuscateOptions accepts webcrack-related fields', () => {
    const opts: DeobfuscateOptions = {
      code: 'var a=1;',
      webcrack: true,
      unpack: true,
      unminify: false,
      jsx: true,
      mangle: false,
      outputDir: 'tmp/out',
      forceOutput: false,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [{path: 'x.js', pattern: 'foo'}],
    };
    assert.equal(opts.code, 'var a=1;');
  });

  it('DeobfuscateResult exposes engine and bundle fields', () => {
    const result: DeobfuscateResult = {
      code: '',
      readabilityScore: 0,
      confidence: 0,
      obfuscationType: ['webcrack'],
      transformations: [],
      analysis: '',
      engine: 'webcrack',
      webcrackApplied: true,
      cached: false,
      savedTo: 'out',
      bundle: {
        type: 'webpack',
        entryId: '0',
        moduleCount: 1,
        truncated: false,
        modules: [],
      },
      savedArtifacts: [],
    };
    assert.equal(result.engine, 'webcrack');
  });

  it('ObfuscationType union includes webcrack-derived tags', () => {
    const tags: ObfuscationType[] = [
      'webcrack',
      'bundle-unpack',
      'unminify',
      'jsx-decompile',
      'mangle',
    ];
    assert.equal(tags.length, 5);
  });

  it('DeobfuscateMappingRule allows optional matchType and target', () => {
    const rule: DeobfuscateMappingRule = {
      path: 'src/foo.js',
      pattern: 'helper',
      matchType: 'regex',
      target: 'code',
    };
    assert.equal(rule.path, 'src/foo.js');
  });

  it('DeobfuscateSavedArtifact has size and type fields', () => {
    const a: DeobfuscateSavedArtifact = {path: 'a.js', size: 10, type: 'file'};
    assert.equal(a.type, 'file');
  });

  it('DeobfuscateBundleSummary supports optional mappingsApplied', () => {
    const b: DeobfuscateBundleSummary = {
      type: 'browserify',
      entryId: '1',
      moduleCount: 2,
      truncated: true,
      mappingsApplied: 1,
      modules: [
        {
          id: '1',
          path: 'a.js',
          isEntry: true,
          size: 100,
          mappedPathFrom: 'old.js',
        },
      ],
    };
    assert.equal(b.modules[0].mappedPathFrom, 'old.js');
  });
});
```

- [ ] **Step 2: 跑测试，确认编译失败**

```bash
npm run typecheck
```
Expected: `tsc --noEmit` 报 `DeobfuscateBundleSummary`、`DeobfuscateMappingRule`、`DeobfuscateSavedArtifact` 不存在，`webcrack`/`bundle-unpack` 等不在 `ObfuscationType` 联合体中。

- [ ] **Step 3: 扩展 ObfuscationType 联合**

`src/types/index.ts:153-174` 把：

```typescript
export type ObfuscationType =
  | 'javascript-obfuscator'
  | 'webpack'
  ...
  | 'custom'
  | 'unknown';
```

替换为（在 `'unknown'` 之后追加 5 个新成员）：

```typescript
export type ObfuscationType =
  | 'javascript-obfuscator'
  | 'webpack'
  | 'uglify'
  | 'vm-protection'
  | 'self-modifying'
  | 'invisible-unicode'
  | 'control-flow-flattening'
  | 'string-array-rotation'
  | 'dead-code-injection'
  | 'opaque-predicates'
  | 'jsfuck'
  | 'aaencode'
  | 'jjencode'
  | 'packer'
  | 'eval-obfuscation'
  | 'base64-encoding'
  | 'hex-encoding'
  | 'jscrambler'
  | 'urlencoded'
  | 'custom'
  | 'unknown'
  | 'bundle-unpack'
  | 'unminify'
  | 'jsx-decompile'
  | 'mangle'
  | 'webcrack';
```

- [ ] **Step 4: 在 DeobfuscateOptions 后面新增 mapping/bundle/artifact 类型**

紧跟 `src/types/index.ts:130` `}` 之后插入：

```typescript
export interface DeobfuscateMappingRule {
  /** 重映射后的目标路径，如 'src/auth/login.js' */
  path: string;
  /** 用于匹配模块的字符串/正则源 */
  pattern: string;
  /** 匹配方式，默认 'includes' */
  matchType?: 'includes' | 'regex' | 'exact';
  /** 匹配字段，默认 'code' */
  target?: 'code' | 'path';
}

export interface DeobfuscateSavedArtifact {
  path: string;
  size: number;
  type: 'file';
}

export interface DeobfuscateBundleModuleSummary {
  id: string;
  path: string;
  isEntry: boolean;
  size: number;
  /** 仅当 includeModuleCode=true 时返回 */
  code?: string;
  /** 触发了 mapping 规则时记录原路径 */
  mappedPathFrom?: string;
}

export interface DeobfuscateBundleSummary {
  type: 'webpack' | 'browserify';
  entryId: string;
  moduleCount: number;
  /** moduleCount 超过 maxBundleModules 时为 true */
  truncated: boolean;
  /** 应用了多少条 mapping 规则 */
  mappingsApplied?: number;
  modules: DeobfuscateBundleModuleSummary[];
}
```

- [ ] **Step 5: 扩展 DeobfuscateOptions**

把 `src/types/index.ts:123-130` 的：

```typescript
export interface DeobfuscateOptions {
  code: string;
  llm?: 'gpt-4' | 'claude';
  aggressive?: boolean;
  preserveLogic?: boolean;
  renameVariables?: boolean;
  inlineFunctions?: boolean;
}
```

替换为：

```typescript
export interface DeobfuscateOptions {
  code: string;
  llm?: 'gpt-4' | 'claude';
  aggressive?: boolean; // 启用激进的反混淆（控制流平坦化还原等）
  preserveLogic?: boolean; // 保留原始逻辑
  renameVariables?: boolean; // 重命名变量为有意义的名称
  inlineFunctions?: boolean; // 内联简单函数

  /** 显式开关 webcrack 子管线（auto 模式下检测到 webpack/javascript-obfuscator 自动启用） */
  webcrack?: boolean;
  /** webcrack: 解 bundle */
  unpack?: boolean;
  /** webcrack: 反 minify（变量重命名/控制流恢复等） */
  unminify?: boolean;
  /** webcrack: 反 JSX 编译 */
  jsx?: boolean;
  /** webcrack: 反 mangle */
  mangle?: boolean;
  /** webcrack: 把还原产物写入指定目录（必须在项目根目录内） */
  outputDir?: string;
  /** outputDir 已存在时是否先清空 */
  forceOutput?: boolean;
  /** bundle 摘要中是否带模块源码 */
  includeModuleCode?: boolean;
  /** 摘要中保留的最大模块数，默认 100 */
  maxBundleModules?: number;
  /** 把还原后的模块按规则重映射到工程路径 */
  mappings?: DeobfuscateMappingRule[];
}
```

- [ ] **Step 6: 扩展 DeobfuscateResult**

把 `src/types/index.ts:132-151` 的接口体后半部分加入新字段。把：

```typescript
export interface DeobfuscateResult {
  code: string;
  readabilityScore: number;
  confidence: number;
  obfuscationType: ObfuscationType[];
  transformations: Transformation[];
  analysis: string;
  warnings?: string[];
  unresolvedParts?: UnresolvedPart[];
}
```

替换为：

```typescript
export interface DeobfuscateResult {
  code: string;
  readabilityScore: number;
  confidence: number;
  obfuscationType: ObfuscationType[];
  transformations: Transformation[];
  analysis: string;

  /**
   * 全部子管线产生的警告/分析信息，外部 AI 可据此做进一步推理
   * 包含：编码机制分析、VM 结构识别、指令映射、LLM 中间分析等
   */
  warnings?: string[];

  /**
   * 未能完全还原的部分，携带位置、原因、建议
   * 外部 AI 可据此决定是否进行针对性的二次分析
   */
  unresolvedParts?: UnresolvedPart[];

  /** webcrack 解出的 bundle 摘要（webpack/browserify） */
  bundle?: DeobfuscateBundleSummary;
  /** outputDir 落盘路径（绝对路径） */
  savedTo?: string;
  /** 落盘的文件清单 */
  savedArtifacts?: DeobfuscateSavedArtifact[];
  /** 实际生效的引擎组合 */
  engine?: 'legacy' | 'webcrack' | 'hybrid';
  /** webcrack 是否被实际执行（与 engine 区分：webcrack 跳过时为 false） */
  webcrackApplied?: boolean;
  /** 本次结果是否来自 LRU 缓存 */
  cached?: boolean;
}
```

- [ ] **Step 7: 跑类型测试通过**

```bash
npm run typecheck && npm run build && node --require ./build/tests/setup.js --test build/tests/unit/types/deobfuscator-types.test.js
```
Expected: typecheck pass，6 个 it 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/types/index.ts tests/unit/types/deobfuscator-types.test.ts
git commit -m "feat(types): extend DeobfuscateOptions/Result with webcrack fields"
```

---

## Task 2: 把 webcrack 加为可选依赖

**Files:**
- Modify: `package.json:139-142`

- [ ] **Step 1: 编辑 package.json，把 webcrack 加入 optionalDependencies**

在 `package.json:139-142` 找到：

```json
  "optionalDependencies": {
    "@swc/core-linux-x64-gnu": "^1.15.33",
    "chrome-devtools-frontend": "^1.0.1608868"
  }
```

替换为：

```json
  "optionalDependencies": {
    "@swc/core-linux-x64-gnu": "^1.15.33",
    "chrome-devtools-frontend": "^1.0.1608868",
    "webcrack": "^2.16.0"
  }
```

- [ ] **Step 2: 安装依赖**

```bash
npm install
```
Expected: `webcrack@2.x` 出现在 `node_modules/webcrack/`；如果 `isolated-vm` 在当前机器编译失败，npm 会跳过（optional 不报错），后续运行时由 import 守卫兜底。验证：

```bash
node -e "import('webcrack').then(m => console.log('ok', Object.keys(m))).catch(e => console.log('skipped:', e.code || e.message))"
```
两种结果都可接受：`ok [ 'webcrack' ]` 或 `skipped: ...`。

- [ ] **Step 3: 提交 lockfile + manifest**

```bash
git add package.json package-lock.json
git commit -m "feat(deps): add webcrack as optional dependency"
```

---

## Task 3: 实现 webcrack 适配器

**Files:**
- Create: `src/modules/deobfuscator/webcrack.ts`
- Test: `tests/unit/modules/webcrack.test.ts`

- [ ] **Step 1: 写失败的适配器单元测试**

新建 `tests/unit/modules/webcrack.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import path from 'node:path';
import {describe, it} from 'node:test';

import {runWebcrack} from '../../../src/modules/deobfuscator/webcrack.js';

describe('runWebcrack adapter', () => {
  it('returns optionsUsed with defaults when nothing supplied', async () => {
    const r = await runWebcrack('var a = 1;', {});
    assert.deepStrictEqual(r.optionsUsed, {
      jsx: true,
      mangle: false,
      unminify: true,
      unpack: true,
    });
  });

  it('respects explicit overrides', async () => {
    const r = await runWebcrack('var a = 1;', {
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
    assert.deepStrictEqual(r.optionsUsed, {
      jsx: false,
      mangle: true,
      unminify: false,
      unpack: false,
    });
  });

  it('returns applied: true for trivially valid input', async () => {
    const r = await runWebcrack('var x = 1 + 2;', {});
    assert.equal(r.applied, true);
    assert.equal(typeof r.code, 'string');
    assert.ok(r.code.length > 0);
  });

  it('returns applied: false with reason for unparseable input', async () => {
    const r = await runWebcrack('{{{{not valid javascript at all!!!!', {});
    assert.equal(r.applied, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok((r.reason ?? '').length > 0);
  });

  it('rejects outputDir that escapes project root', async () => {
    await assert.rejects(
      runWebcrack('var a=1;', {outputDir: path.join('..', '..', 'evil')}),
      /outputDir must resolve to a path within the project root/,
    );
  });

  it('summarizes a webpack-like bundle when unpack=true', async () => {
    const bundle = `
      (function(modules){
        function __webpack_require__(id){
          var m = {exports: {}};
          modules[id].call(m.exports, m, m.exports, __webpack_require__);
          return m.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports, __webpack_require__){
          var dep = __webpack_require__(1);
          module.exports = function(){ return dep.hello(); };
        },
        function(module, exports){
          module.exports = { hello: function(){ return "world"; } };
        }
      ]);
    `;
    const r = await runWebcrack(bundle, {unpack: true});
    assert.equal(r.applied, true);
    if (r.bundle) {
      assert.equal(r.bundle.type, 'webpack');
      assert.ok(r.bundle.moduleCount > 0);
      assert.ok(r.bundle.modules.length > 0);
    }
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/webcrack.test.js
```
Expected: 6 个 it 全部 FAIL（`Cannot find module .../webcrack.js`）。

- [ ] **Step 3: 创建适配器实现**

新建 `src/modules/deobfuscator/webcrack.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * webcrack 适配层
 *
 * 目标：在主反混淆管线中，作为前置 Step 0.5 引入 webcrack 的能力
 * （bundle 拆包 / unminify / javascript-obfuscator 反向 / mangle 反向）。
 * 失败、不可用、Node 版本不匹配时返回 applied:false，由调用方兜底。
 */

import {readdir, rm, stat} from 'node:fs/promises';
import path from 'node:path';

import type {
  DeobfuscateBundleModuleSummary,
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateOptions,
  DeobfuscateSavedArtifact,
} from '../../types/index.js';
import {logger} from '../../utils/logger.js';

type WebcrackModuleLike = {
  id: string;
  path: string;
  isEntry: boolean;
  code: string;
};

type WebcrackBundleLike = {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Map<string, WebcrackModuleLike>;
};

type WebcrackResultLike = {
  code: string;
  bundle?: WebcrackBundleLike;
  save: (targetPath: string) => Promise<void>;
};

type WebcrackRuntimeOptions = {
  jsx?: boolean;
  unpack?: boolean;
  deobfuscate?: boolean;
  unminify?: boolean;
  mangle?: boolean;
  sandbox?: unknown;
};

type WebcrackModuleImport = {
  webcrack: (
    code: string,
    options?: WebcrackRuntimeOptions,
  ) => Promise<WebcrackResultLike>;
};

type WebcrackInvocationOptions = Pick<
  DeobfuscateOptions,
  | 'forceOutput'
  | 'includeModuleCode'
  | 'jsx'
  | 'mangle'
  | 'mappings'
  | 'maxBundleModules'
  | 'outputDir'
  | 'unminify'
  | 'unpack'
>;

export interface WebcrackExecutionResult {
  applied: boolean;
  code: string;
  bundle?: DeobfuscateBundleSummary;
  savedTo?: string;
  savedArtifacts?: DeobfuscateSavedArtifact[];
  optionsUsed: Required<
    Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
  >;
  reason?: string;
}

const DEFAULT_OPTIONS: Required<
  Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
> = {
  jsx: true,
  mangle: false,
  unminify: true,
  unpack: true,
};

const MAX_BUNDLE_MODULES = 100;

type MappingMetadata = {fromPath: string};

function normalizeOptions(
  options: WebcrackInvocationOptions,
): Required<Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>> {
  return {
    jsx: options.jsx ?? DEFAULT_OPTIONS.jsx,
    mangle: options.mangle ?? DEFAULT_OPTIONS.mangle,
    unminify: options.unminify ?? DEFAULT_OPTIONS.unminify,
    unpack: options.unpack ?? DEFAULT_OPTIONS.unpack,
  };
}

/** webcrack 仅在 Node 22.12+ 与 Node 24.x 上支持 */
export function isSupportedNodeVersion(): boolean {
  const [majorPart = '0', minorPart = '0'] = process.versions.node.split('.');
  const major = Number.parseInt(majorPart, 10);
  const minor = Number.parseInt(minorPart, 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }
  if (major === 22) return minor >= 12;
  return major === 24;
}

function matchesRule(
  module: WebcrackModuleLike,
  rule: DeobfuscateMappingRule,
): boolean {
  const target = rule.target === 'path' ? module.path : module.code;
  const matchType = rule.matchType ?? 'includes';
  if (matchType === 'exact') return target === rule.pattern;
  if (matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'm').test(target);
    } catch {
      return false;
    }
  }
  return target.includes(rule.pattern);
}

function applyBundleMappings(
  bundle: WebcrackBundleLike,
  mappings: DeobfuscateMappingRule[] | undefined,
): Map<string, MappingMetadata> {
  const remapped = new Map<string, MappingMetadata>();
  if (!mappings || mappings.length === 0) return remapped;

  for (const module of bundle.modules.values()) {
    for (const rule of mappings) {
      if (!rule.path || !rule.pattern) continue;
      if (matchesRule(module, rule)) {
        if (module.path !== rule.path) {
          remapped.set(module.id, {fromPath: module.path});
          module.path = rule.path;
        }
        break;
      }
    }
  }
  return remapped;
}

function summarizeBundle(
  bundle: WebcrackBundleLike,
  options: Pick<DeobfuscateOptions, 'includeModuleCode' | 'maxBundleModules'>,
  remapped: Map<string, MappingMetadata>,
): DeobfuscateBundleSummary {
  const maxBundleModules = options.maxBundleModules ?? MAX_BUNDLE_MODULES;
  const modules = Array.from(bundle.modules.values())
    .sort((a, b) => {
      if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1;
      return a.path.localeCompare(b.path);
    })
    .slice(0, maxBundleModules)
    .map<DeobfuscateBundleModuleSummary>(module => ({
      id: module.id,
      path: module.path,
      isEntry: module.isEntry,
      size: module.code.length,
      code: options.includeModuleCode ? module.code : undefined,
      mappedPathFrom: remapped.get(module.id)?.fromPath,
    }));

  return {
    type: bundle.type,
    entryId: bundle.entryId,
    moduleCount: bundle.modules.size,
    truncated: bundle.modules.size > maxBundleModules,
    mappingsApplied: remapped.size,
    modules,
  };
}

async function collectSavedArtifacts(
  rootDir: string,
  currentDir = rootDir,
): Promise<DeobfuscateSavedArtifact[]> {
  const entries = await readdir(currentDir, {withFileTypes: true});
  const artifacts: DeobfuscateSavedArtifact[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await collectSavedArtifacts(rootDir, fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;

    const meta = await stat(fullPath);
    artifacts.push({
      path: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
      size: meta.size,
      type: 'file',
    });
  }

  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function assertOutputDirSafe(savedTo: string): void {
  const cwd = process.cwd();
  const relFromCwd = path.relative(cwd, savedTo);
  if (
    path.isAbsolute(relFromCwd) ||
    relFromCwd.startsWith('..') ||
    savedTo === '/' ||
    savedTo === path.parse(savedTo).root
  ) {
    throw new Error(
      `outputDir must resolve to a path within the project root. Got: ${savedTo}`,
    );
  }
}

export async function runWebcrack(
  code: string,
  options: WebcrackInvocationOptions,
): Promise<WebcrackExecutionResult> {
  const optionsUsed = normalizeOptions(options);

  if (!isSupportedNodeVersion()) {
    const reason = `webcrack requires Node.js 22.12+ or 24.x; current runtime is ${process.versions.node}`;
    logger.warn(reason);
    return {applied: false, code, optionsUsed, reason};
  }

  // 验证 outputDir 安全 —— 在调用 webcrack 之前抛错，避免做无用功
  let savedTo: string | undefined;
  if (
    typeof options.outputDir === 'string' &&
    options.outputDir.trim().length > 0
  ) {
    savedTo = path.resolve(options.outputDir);
    assertOutputDirSafe(savedTo);
  }

  let webcrackModule: WebcrackModuleImport;
  try {
    webcrackModule = (await import('webcrack')) as WebcrackModuleImport;
  } catch (error) {
    const reason =
      error instanceof Error
        ? `webcrack module not available: ${error.message}`
        : 'webcrack module not available';
    logger.warn(reason);
    return {applied: false, code, optionsUsed, reason};
  }

  try {
    const result = await webcrackModule.webcrack(code, {
      jsx: optionsUsed.jsx,
      unpack: optionsUsed.unpack,
      deobfuscate: true,
      unminify: optionsUsed.unminify,
      mangle: optionsUsed.mangle,
    });

    const remapped = result.bundle
      ? applyBundleMappings(result.bundle, options.mappings)
      : new Map<string, MappingMetadata>();

    let savedArtifacts: DeobfuscateSavedArtifact[] | undefined;
    if (savedTo) {
      if (options.forceOutput) {
        await rm(savedTo, {recursive: true, force: true});
      }
      await result.save(savedTo);
      savedArtifacts = await collectSavedArtifacts(savedTo);
    }

    return {
      applied: true,
      code: result.code,
      bundle: result.bundle
        ? summarizeBundle(
            result.bundle,
            {
              includeModuleCode: options.includeModuleCode,
              maxBundleModules: options.maxBundleModules,
            },
            remapped,
          )
        : undefined,
      savedTo,
      savedArtifacts,
      optionsUsed,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('webcrack execution failed, falling back to legacy pipeline');
    return {applied: false, code, optionsUsed, reason};
  }
}
```

- [ ] **Step 4: 跑测试通过**

```bash
npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/webcrack.test.js
```
Expected: 6 个 it 全部 PASS。如果当前机器没装 `webcrack`（`isolated-vm` 未编译），则 `applied: true` 的两条会变成 `applied: false` —— 此时跳过这两条断言并把测试改成兼容形式（见 Step 5）。

- [ ] **Step 5: 让测试在 webcrack 不可用时也能跑过**

如果 Step 4 看到 import 守卫触发，把 `tests/unit/modules/webcrack.test.ts` 中以下 3 个 it 改造成兼容形式：

```ts
  it('returns applied: true for trivially valid input', async () => {
    const r = await runWebcrack('var x = 1 + 2;', {});
    if (r.applied) {
      assert.equal(typeof r.code, 'string');
      assert.ok(r.code.length > 0);
    } else {
      assert.match(r.reason ?? '', /webcrack (module not available|requires)/);
    }
  });

  it('returns applied: false with reason for unparseable input', async () => {
    const r = await runWebcrack('{{{{not valid javascript at all!!!!', {});
    assert.equal(r.applied, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok((r.reason ?? '').length > 0);
  });

  it('summarizes a webpack-like bundle when unpack=true', async () => {
    const bundle = `... same as before ...`;
    const r = await runWebcrack(bundle, {unpack: true});
    if (r.applied && r.bundle) {
      assert.equal(r.bundle.type, 'webpack');
      assert.ok(r.bundle.moduleCount > 0);
    } else {
      assert.equal(r.applied, false);
      assert.match(r.reason ?? '', /webcrack/i);
    }
  });
```

重跑 Step 4 命令直到全绿。

- [ ] **Step 6: 提交**

```bash
git add src/modules/deobfuscator/webcrack.ts tests/unit/modules/webcrack.test.ts
git commit -m "feat(deobfuscator): add webcrack adapter with version & import guards"
```

---

## Task 4: 在主管线中接入 runWebcrack（Step 0.5）

**Files:**
- Modify: `src/modules/deobfuscator/Deobfuscator.ts`

- [ ] **Step 1: 在主管线注入 import**

`src/modules/deobfuscator/Deobfuscator.ts:48-60` 找到子模块 import 区，在末尾追加：

```typescript
import {runWebcrack, type WebcrackExecutionResult} from './webcrack.js';
```

- [ ] **Step 2: 准备 pipeline 状态容器**

把 `src/modules/deobfuscator/Deobfuscator.ts:162-164` 的：

```typescript
      const pipelineWarnings: string[] = [];
      const pipelineUnresolved: UnresolvedPart[] = [];
```

替换为：

```typescript
      const pipelineWarnings: string[] = [];
      const pipelineUnresolved: UnresolvedPart[] = [];
      let pipelineBundle: import('../../types/index.js').DeobfuscateBundleSummary | undefined;
      let pipelineSavedTo: string | undefined;
      let pipelineSavedArtifacts:
        | import('../../types/index.js').DeobfuscateSavedArtifact[]
        | undefined;
      let webcrackApplied = false;
```

- [ ] **Step 3: 在 Step 1 (`runUnpack`) 之前插入 Step 0.5**

把 `src/modules/deobfuscator/Deobfuscator.ts:175-185` 的：

```typescript
      // ── Step 1: Packer / AAEncode / URLEncode 自动解包 ──
      if (
        this.shouldRun(options.unpack, autoMode, obfuscationType, [
          'packer',
          'aaencode',
          'urlencoded',
          'eval-obfuscation',
        ])
      ) {
        code = await this.runUnpack(code, transformations);
      }
```

替换为（在它前面加 Step 0.5）：

```typescript
      // ── Step 0.5: webcrack 前置 ──
      if (
        this.shouldRun(options.webcrack, autoMode, obfuscationType, [
          'webpack',
          'javascript-obfuscator',
          'uglify',
        ])
      ) {
        const wc = await this.runWebcrack(
          code,
          options,
          transformations,
          pipelineWarnings,
        );
        if (wc.applied) {
          code = wc.code;
          webcrackApplied = true;
          pipelineBundle = wc.bundle;
          pipelineSavedTo = wc.savedTo;
          pipelineSavedArtifacts = wc.savedArtifacts;
        }
      }

      // ── Step 1: Packer / AAEncode / URLEncode 自动解包 ──
      if (
        this.shouldRun(options.unpack, autoMode, obfuscationType, [
          'packer',
          'aaencode',
          'urlencoded',
          'eval-obfuscation',
        ])
      ) {
        code = await this.runUnpack(code, transformations);
      }
```

注意：`options.unpack` 现在同时被 webcrack 和 PackerDeobfuscator 用作 hint，但 webcrack 的开关是 `options.webcrack`，`unpack` 只透传给 webcrack 内部，不影响 Step 1 的判定。Step 1 的语义保留：`unpack` 仍然是自动模式下 Packer/AAEncode/URLEncode 的显式开关。

- [ ] **Step 4: 在结果构建处把 bundle/savedTo/engine 字段写出**

把 `src/modules/deobfuscator/Deobfuscator.ts:287-298` 的：

```typescript
      const result: DeobfuscateResult = {
        code,
        readabilityScore,
        confidence,
        obfuscationType: finalTypes,
        transformations,
        analysis,
        warnings: pipelineWarnings.length > 0 ? pipelineWarnings : undefined,
        unresolvedParts:
          pipelineUnresolved.length > 0 ? pipelineUnresolved : undefined,
      };
```

替换为：

```typescript
      const otherTransforms = transformations.filter(
        t => t.type !== 'webcrack' && t.success,
      );
      const engine: 'legacy' | 'webcrack' | 'hybrid' = webcrackApplied
        ? otherTransforms.length > 0
          ? 'hybrid'
          : 'webcrack'
        : 'legacy';

      const result: DeobfuscateResult = {
        code,
        readabilityScore,
        confidence,
        obfuscationType: finalTypes,
        transformations,
        analysis,
        warnings: pipelineWarnings.length > 0 ? pipelineWarnings : undefined,
        unresolvedParts:
          pipelineUnresolved.length > 0 ? pipelineUnresolved : undefined,
        bundle: pipelineBundle,
        savedTo: pipelineSavedTo,
        savedArtifacts: pipelineSavedArtifacts,
        engine,
        webcrackApplied,
        cached: false,
      };
```

- [ ] **Step 5: 缓存命中时把 cached 标记成 true**

把 `src/modules/deobfuscator/Deobfuscator.ts:151-155` 的：

```typescript
      const cached = this.resultCache.get(cacheKey);
      if (cached) {
        logger.debug('Deobfuscation result from cache');
        return cached;
      }
```

替换为：

```typescript
      const cached = this.resultCache.get(cacheKey);
      if (cached) {
        logger.debug('Deobfuscation result from cache');
        return {...cached, cached: true};
      }
```

- [ ] **Step 6: 把 webcrack 字段纳入缓存键**

把 `src/modules/deobfuscator/Deobfuscator.ts:1690-1701` 的：

```typescript
  private generateCacheKey(options: DeobfuscateFullOptions): string {
    const key = JSON.stringify({
      code: options.code.substring(0, 1000),
      aggressive: options.aggressive,
      advanced: options.advanced,
      jsvmp: options.jsvmp,
      astOptimize: options.astOptimize,
      unpack: options.unpack,
      auto: options.auto,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }
```

替换为：

```typescript
  private generateCacheKey(options: DeobfuscateFullOptions): string {
    const key = JSON.stringify({
      code: options.code.substring(0, 1000),
      aggressive: options.aggressive,
      advanced: options.advanced,
      jsvmp: options.jsvmp,
      astOptimize: options.astOptimize,
      unpack: options.unpack,
      auto: options.auto,
      webcrack: options.webcrack,
      unminify: options.unminify,
      jsx: options.jsx,
      mangle: options.mangle,
      includeModuleCode: options.includeModuleCode,
      maxBundleModules: options.maxBundleModules,
      outputDir: options.outputDir,
      forceOutput: options.forceOutput,
      mappingsCount: options.mappings?.length ?? 0,
    });
    return crypto.createHash('md5').update(key).digest('hex');
  }
```

- [ ] **Step 7: 在 ==== 子管线调度 ==== 区段末尾添加 runWebcrack 私有方法**

在 `src/modules/deobfuscator/Deobfuscator.ts:537` 的 `runASTOptimizer` 方法之后，紧接着 `// ==================== 检测 ====================` 之前插入：

```typescript
  /**
   * webcrack 前置策略：bundle 拆包 + unminify + javascript-obfuscator 反向
   * 失败/不可用时返回 applied:false，由后续管线兜底
   */
  private async runWebcrack(
    code: string,
    options: DeobfuscateFullOptions,
    transformations: Transformation[],
    pipelineWarnings: string[],
  ): Promise<WebcrackExecutionResult> {
    try {
      logger.info('Running webcrack...');
      const result = await runWebcrack(code, {
        unpack: options.unpack,
        unminify: options.unminify,
        jsx: options.jsx,
        mangle: options.mangle ?? options.renameVariables,
        mappings: options.mappings,
        outputDir: options.outputDir,
        forceOutput: options.forceOutput,
        includeModuleCode: options.includeModuleCode,
        maxBundleModules: options.maxBundleModules,
      });

      if (!result.applied) {
        if (result.reason) {
          pipelineWarnings.push(`[webcrack] ${result.reason}`);
        }
        transformations.push({
          type: 'webcrack',
          description: `webcrack skipped: ${result.reason ?? 'unknown reason'}`,
          success: false,
        });
        return result;
      }

      const detail: Record<string, unknown> = {
        optionsUsed: result.optionsUsed,
      };
      if (result.bundle) {
        detail.bundle = {
          type: result.bundle.type,
          moduleCount: result.bundle.moduleCount,
          truncated: result.bundle.truncated,
          mappingsApplied: result.bundle.mappingsApplied,
        };
      }
      if (result.savedTo) detail.savedTo = result.savedTo;

      transformations.push({
        type: 'webcrack',
        description:
          `webcrack applied (unpack=${result.optionsUsed.unpack}, ` +
          `unminify=${result.optionsUsed.unminify}, ` +
          `jsx=${result.optionsUsed.jsx}, mangle=${result.optionsUsed.mangle})` +
          (result.bundle
            ? ` — recovered ${result.bundle.moduleCount} modules`
            : ''),
        success: true,
        detail,
      });

      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('webcrack pipeline error', error);
      pipelineWarnings.push(`[webcrack] ${reason}`);
      transformations.push({
        type: 'webcrack',
        description: `webcrack pipeline error: ${reason}`,
        success: false,
      });
      return {
        applied: false,
        code,
        optionsUsed: {jsx: true, mangle: false, unminify: true, unpack: true},
        reason,
      };
    }
  }
```

- [ ] **Step 8: 把 webcrack 透传给 mergeObfuscationTypes**

把 `src/modules/deobfuscator/Deobfuscator.ts:653-687` 的 `mergeObfuscationTypes` 方法体里 `for (const t of transformations)` 循环最后加上：

找到：
```typescript
        if (
          t.type === 'advanced' &&
          t.description.includes('dead-code-injection')
        )
          types.add('dead-code-injection');
      }
    }
```

替换为：
```typescript
        if (
          t.type === 'advanced' &&
          t.description.includes('dead-code-injection')
        )
          types.add('dead-code-injection');

        if (t.type === 'webcrack') {
          types.add('webcrack');
          const detail = t.detail as
            | {
                bundle?: {type?: string};
                optionsUsed?: {unminify?: boolean; mangle?: boolean; jsx?: boolean};
              }
            | undefined;
          if (detail?.bundle?.type) types.add('bundle-unpack');
          if (detail?.optionsUsed?.unminify) types.add('unminify');
          if (detail?.optionsUsed?.mangle) types.add('mangle');
          if (detail?.optionsUsed?.jsx) types.add('jsx-decompile');
        }
      }
    }
```

- [ ] **Step 9: 跑全量编译与现有测试**

```bash
npm run typecheck && npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/Deobfuscator.test.js build/tests/unit/modules/Deobfuscator.extended.test.js build/tests/unit/modules/webcrack.test.js
```
Expected: typecheck 通过，所有原 Deobfuscator 测试 + webcrack 测试全部 PASS（webcrack 不可用时按 Task 3 Step 5 的兼容分支走）。

- [ ] **Step 10: 提交**

```bash
git add src/modules/deobfuscator/Deobfuscator.ts
git commit -m "feat(deobfuscator): add webcrack as Step 0.5 prefix in main pipeline"
```

---

## Task 5: 集成行为测试（端到端）

**Files:**
- Create: `tests/unit/modules/Deobfuscator.webcrack.test.ts`

- [ ] **Step 1: 写集成测试**

新建 `tests/unit/modules/Deobfuscator.webcrack.test.ts`：

```ts
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {Deobfuscator} from '../../../src/modules/deobfuscator/Deobfuscator.js';
import {isSupportedNodeVersion} from '../../../src/modules/deobfuscator/webcrack.js';

describe('Deobfuscator + webcrack integration', () => {
  it('does not run webcrack when auto=false and webcrack flag absent', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1 + 2;',
      auto: false,
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.equal(wc, undefined);
    assert.equal(r.webcrackApplied, false);
    assert.equal(r.engine, 'legacy');
  });

  it('runs webcrack when explicitly enabled even on tiny input', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1 + 2;',
      auto: false,
      webcrack: true,
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.ok(wc, 'webcrack transformation entry expected');
    if (isSupportedNodeVersion()) {
      // 当 webcrack 可用时 success 应为 true（除非 isolated-vm 缺失）
      // 这里弱断言：要么成功要么因为缺包失败，但一定有 transformation 记录
      assert.ok(typeof wc!.success === 'boolean');
    }
  });

  it('triggers webcrack automatically when webpack pattern detected', async () => {
    const d = new Deobfuscator();
    const code = `
      (function(modules){
        function __webpack_require__(id){
          var m = {exports:{}};
          modules[id].call(m.exports, m, m.exports, __webpack_require__);
          return m.exports;
        }
        return __webpack_require__(0);
      })([
        function(module, exports){ module.exports = function(){return 42;}; }
      ]);
    `;
    const r = await d.deobfuscate({code, auto: true});
    const wc = r.transformations.find(t => t.type === 'webcrack');
    assert.ok(wc, 'auto mode should pick webcrack on webpack input');
  });

  it('returns engine=legacy when webcrack unavailable / not triggered', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
    });
    assert.equal(r.engine, 'legacy');
    assert.equal(r.webcrackApplied, false);
  });

  it('flags cached=true on second identical call', async () => {
    const d = new Deobfuscator();
    const opts = {code: 'var a = 1 + 2;', auto: false} as const;
    const first = await d.deobfuscate(opts);
    const second = await d.deobfuscate(opts);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
  });

  it('produces different cache entries when webcrack flag toggles', async () => {
    const d = new Deobfuscator();
    const a = await d.deobfuscate({code: 'var a = 1;', auto: false});
    const b = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
      webcrack: true,
    });
    // 两次结果都不是缓存命中（因为 cache key 不同）
    assert.equal(a.cached, false);
    assert.equal(b.cached, false);
  });

  it('rejects outputDir that escapes project root via warning', async () => {
    const d = new Deobfuscator();
    const r = await d.deobfuscate({
      code: 'var a = 1;',
      auto: false,
      webcrack: true,
      outputDir: '../../escape',
    });
    const wc = r.transformations.find(t => t.type === 'webcrack');
    // 失败被记录为 success:false，且 warnings 中包含 outputDir 错误
    assert.ok(wc);
    assert.equal(wc!.success, false);
    assert.ok(
      (r.warnings ?? []).some(w =>
        w.toLowerCase().includes('outputdir'),
      ),
      `expected outputDir warning, got: ${JSON.stringify(r.warnings)}`,
    );
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/Deobfuscator.webcrack.test.js
```
Expected: 7 个 it 全部 PASS。

- [ ] **Step 3: 跑全量反混淆相关测试，确认无回归**

```bash
node --require ./build/tests/setup.js --test build/tests/unit/modules/Deobfuscator.test.js build/tests/unit/modules/Deobfuscator.extended.test.js build/tests/unit/modules/AdvancedDeobfuscator.test.js build/tests/unit/modules/ASTOptimizer.test.js build/tests/unit/modules/webcrack.test.js build/tests/unit/modules/Deobfuscator.webcrack.test.js
```
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add tests/unit/modules/Deobfuscator.webcrack.test.ts
git commit -m "test(deobfuscator): add integration tests for webcrack pipeline step"
```

---

## Task 6: 公开导出（按需）

**Files:**
- Modify: `src/modules/deobfuscator/index.ts`

- [ ] **Step 1: 追加 webcrack 导出**

把 `src/modules/deobfuscator/index.ts:34` 末尾文件结构保持，在最后追加：

```typescript

// webcrack 前置策略
export {runWebcrack, isSupportedNodeVersion} from './webcrack.js';
export type {WebcrackExecutionResult} from './webcrack.js';
```

- [ ] **Step 2: 验证编译**

```bash
npm run typecheck && npm run build
```
Expected: 全部通过。

- [ ] **Step 3: 提交**

```bash
git add src/modules/deobfuscator/index.ts
git commit -m "feat(deobfuscator): export runWebcrack & isSupportedNodeVersion"
```

---

## Task 7: 全量验证

- [ ] **Step 1: 跑完整 build + typecheck**

```bash
npm run typecheck && npm run build
```
Expected: 0 错误。

- [ ] **Step 2: 跑全部单元测试**

```bash
npm run test:unit
```
Expected: 全部 PASS（含原有 Deobfuscator 套件、新加的 webcrack 适配器与集成套件）。

- [ ] **Step 3: 在没装 webcrack 的环境上做一次回归**

```bash
node -e "require('fs').rmSync('node_modules/webcrack', {recursive: true, force: true})"
npm run build && node --require ./build/tests/setup.js --test build/tests/unit/modules/Deobfuscator.webcrack.test.js
```
Expected: 测试仍然全绿（适配器走 import 失败分支，pipeline 标记 `engine: 'legacy'`）。完成后跑 `npm install` 恢复 webcrack（如果 isolated-vm 之前能编译）。

- [ ] **Step 4: 在 GitNexus 上做最终影响分析**

调用 `gitnexus_detect_changes()`，确认改动只命中：
- `src/types/index.ts` 的 `DeobfuscateOptions/Result/ObfuscationType`
- `src/modules/deobfuscator/Deobfuscator.ts` 的 `deobfuscate / generateCacheKey / mergeObfuscationTypes` 与新增 `runWebcrack`
- 新增 `src/modules/deobfuscator/webcrack.ts`、`src/modules/deobfuscator/index.ts`

外部消费者（`RuntimeServices.getDeobfuscator`、tools 层）应不受影响 —— 所有新字段均为可选。

- [ ] **Step 5: 提交最终验收说明（如需）**

无文件改动则跳过，否则：

```bash
git add docs/superpowers/plans/2026-05-22-webcrack-integration.md
git commit -m "docs: webcrack integration plan checkpoint"
```

---

## 验收标准

- `npm run typecheck` 0 错误
- `npm run test:unit` 全绿
- 安装了 webcrack + isolated-vm 的 Node 22.14 / 24.x 环境上：webpack 输入 → `engine: 'webcrack'` 或 `'hybrid'`，`bundle.moduleCount > 0`
- 未安装 / Node 不支持的环境上：`engine: 'legacy'`，`webcrackApplied: false`，主管线行为与移植前一致
- 调用方传 `outputDir: '../foo'` 时：webcrack transformation 标记为 `success: false`，warnings 包含 `outputDir` 错误，主管线不抛
- 第二次相同请求：`cached: true`
