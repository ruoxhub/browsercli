# God Class 拆分实施计划（Part 2：Phase 4–6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续拆分 AdvancedDeobfuscator、WasmCollector、CodeCollector 三个 god class。

**Architecture:** 延续 Part 1 的门面+策略模块模式。AdvancedDeobfuscator 按混淆技术切分（6 个策略文件），WasmCollector 按状态域切分（3 个策略文件 + 巨型 preload script 模板提取），CodeCollector 按职责域切分（3 个策略文件 + collect 方法解构）。

**Tech Stack:** TypeScript ESM, node:test, @babel/parser, Playwright, CDP

**Spec:** `docs/superpowers/specs/2026-07-01-god-class-split-design.md`

## Global Constraints

（与 Part 1 一致）

- 每个策略文件 ≤500 行，每个门面 ≤450 行
- 公共 API 签名不变，调用方代码不动
- 每类独立 commit，可独立回退
- 新增策略文件补对应单元测试
- `npm run typecheck` 通过，`npm run test:unit` 无回归

## 前置条件

- Phase 2（PageController.ts 拆分）已完成 —— WasmCollector 依赖 PageController

---

## Phase 4：AdvancedDeobfuscator.ts 拆分

AdvancedDeobfuscator 有 7 种混淆技术，按技术切分为 6 个策略文件（VM 保护是最大的一个）。

### Task 4.1: 基线验证

- [ ] **Step 1: 运行基线测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 确认待提取方法边界**

在 `src/modules/deobfuscator/AdvancedDeobfuscator.ts`（1463 行）中定位每个 detect+decode 方法对的起止行：

- InvisibleUnicode: `detectInvisibleUnicode` + `decodeInvisibleUnicode`
- VM Protection: `detectVMProtection` + `countVMInstructions` + `deobfuscateVM` + `analyzeVMStructure` + `extractVMComponents` + `buildVMDeobfuscationPrompt` + `simplifyVMCode`
- ControlFlow: `detectControlFlowFlattening` + 对应 deobfuscate 方法
- StringArray: `detectStringArrayRotation` + 对应 deobfuscate 方法
- DeadCode: `detectDeadCodeInjection` + 对应 deobfuscate 方法
- OpaquePredicate: `detectOpaquePredicates` + 对应 deobfuscate 方法

---

### Task 4.2: 创建 6 个策略文件

**Files:**

- Create: `src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.ts`
- Create: `src/modules/deobfuscator/VMProtectionDeobfuscator.ts`
- Create: `src/modules/deobfuscator/ControlFlowDeobfuscator.ts`
- Create: `src/modules/deobfuscator/StringArrayDeobfuscator.ts`
- Create: `src/modules/deobfuscator/DeadCodeDeobfuscator.ts`
- Create: `src/modules/deobfuscator/OpaquePredicateDeobfuscator.ts`

**模式**（所有 6 个策略文件遵循相同模式）：

每个文件导出一个类/函数集合，接收 LLM 服务（可选）作为参数：

```typescript
/**
 * [Technique] 去混淆器。提取自 AdvancedDeobfuscator.ts。
 */
import type {LLMService} from '../../services/LLMService.js';

export class InvisibleUnicodeDeobfuscator {
  constructor(private llm?: LLMService) {}

  static detectInvisibleUnicode(code: string): boolean {
    // 复制 detectInvisibleUnicode 的方法体
  }

  static decodeInvisibleUnicode(code: string): string {
    // 复制 decodeInvisibleUnicode 的方法体
  }
}
```

- [ ] **Step 1: 创建 InvisibleUnicodeDeobfuscator.ts**（最小，~120 行）

检测和编码方法都是纯静态方法，无需 LLM。

- [ ] **Step 2: 创建 VMProtectionDeobfuscator.ts**（最大，~450 行）

包含 LLM 辅助调用（需要 `llm` 参数）。如果超过 500 行，考虑进一步拆分 `analyzeVMStructure` + `extractVMComponents` 到 `VMStructureAnalyzer.ts`。

```typescript
export class VMProtectionDeobfuscator {
  constructor(private llm?: LLMService) {}

  static detectVMProtection(code: string): {
    detected: boolean;
    confidence: number;
  } {
    /* ... */
  }
  static countVMInstructions(code: string): number {
    /* ... */
  }
  async deobfuscateVM(
    code: string,
    options: {aggressiveVM?: boolean},
  ): Promise<VMDeobfuscateResult> {
    /* ... */
  }
  static analyzeVMStructure(code: string): VMStructure {
    /* ... */
  }
  static extractVMComponents(code: string): VMComponents {
    /* ... */
  }
  private buildVMDeobfuscationPrompt(
    code: string,
    vmStructure: VMStructure,
  ): string[] {
    /* ... */
  }
  static simplifyVMCode(code: string): string {
    /* ... */
  }
}
```

- [ ] **Step 3: 创建 ControlFlowDeobfuscator.ts**（~150 行）

```typescript
export class ControlFlowDeobfuscator {
  static detectControlFlowFlattening(code: string): boolean {
    /* ... */
  }
  async deobfuscateControlFlow(code: string): Promise<string> {
    /* ... */
  }
}
```

- [ ] **Step 4: 创建 StringArrayDeobfuscator.ts**（~150 行）

- [ ] **Step 5: 创建 DeadCodeDeobfuscator.ts**（~120 行）

- [ ] **Step 6: 创建 OpaquePredicateDeobfuscator.ts**（~120 行）

---

### Task 4.3: 更新 AdvancedDeobfuscator 门面

**Files:**

- Modify: `src/modules/deobfuscator/AdvancedDeobfuscator.ts`

- [ ] **Step 1: 导入所有策略模块**

```typescript
import {InvisibleUnicodeDeobfuscator} from './InvisibleUnicodeDeobfuscator.js';
import {VMProtectionDeobfuscator} from './VMProtectionDeobfuscator.js';
import {ControlFlowDeobfuscator} from './ControlFlowDeobfuscator.js';
import {StringArrayDeobfuscator} from './StringArrayDeobfuscator.js';
import {DeadCodeDeobfuscator} from './DeadCodeDeobfuscator.js';
import {OpaquePredicateDeobfuscator} from './OpaquePredicateDeobfuscator.js';
```

- [ ] **Step 2: 在 `deobfuscate` 方法中将 `this.detectXxx` 改为 `XxxDeobfuscator.detectXxx`**

将 `deobfuscate` 方法中的内联调用改为委托：

```typescript
async deobfuscate(code: string, options: DeobfuscateOptions = {}): Promise<DeobfuscateResult> {
  const detectedTechniques: string[] = [];
  let result = code;

  if (InvisibleUnicodeDeobfuscator.detectInvisibleUnicode(result)) {
    result = InvisibleUnicodeDeobfuscator.decodeInvisibleUnicode(result);
    detectedTechniques.push('invisible_unicode');
  }
  // ... 其他 6 种技术同理
}
```

- [ ] **Step 3: 删除已提取的私有方法**

从 AdvancedDeobfuscator 类中删除所有已移到策略文件的方法。

- [ ] **Step 4: 保留 `extractCodeFromLLMResponse`、`isValidJavaScript` 和 LLM 辅助**

这些是通用的工具方法，不属于任何单一技术，保留在门面中。

---

### Task 4.4: 添加策略文件的单元测试

**Files:**

- Create: `tests/unit/modules/deobfuscator/InvisibleUnicodeDeobfuscator.test.ts`
- Create: `tests/unit/modules/deobfuscator/VMProtectionDeobfuscator.test.ts`
- （其余 4 个策略文件同理）

- [ ] **Step 1: 编写 InvisibleUnicode 测试**

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';
import {InvisibleUnicodeDeobfuscator} from '../../../src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.js';

describe('InvisibleUnicodeDeobfuscator', () => {
  it('detects invisible unicode in code', () => {
    assert.strictEqual(
      InvisibleUnicodeDeobfuscator.detectInvisibleUnicode('normal code'),
      false,
    );
    // 用包含不可见 Unicode 的代码测试 detectInvisibleUnicode
  });

  it('decodes invisible unicode to readable text', () => {
    // 测试 decodeInvisibleUnicode
  });
});
```

- [ ] **Step 2: 编写 VMProtection 测试**（用 sample VM 混淆代码）

- [ ] **Step 3: 为其余 4 个策略文件编写测试**

每个策略文件至少 2 个测试用例（detect + deobfuscate）。

---

### Task 4.5: 运行验证并提交

- [ ] **Step 1: 构建 + 类型检查 + 单元测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 确认文件大小**

```bash
wc -l src/modules/deobfuscator/AdvancedDeobfuscator.ts
wc -l src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.ts
wc -l src/modules/deobfuscator/VMProtectionDeobfuscator.ts
wc -l src/modules/deobfuscator/ControlFlowDeobfuscator.ts
wc -l src/modules/deobfuscator/StringArrayDeobfuscator.ts
wc -l src/modules/deobfuscator/DeadCodeDeobfuscator.ts
wc -l src/modules/deobfuscator/OpaquePredicateDeobfuscator.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/modules/deobfuscator/AdvancedDeobfuscator.ts src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.ts src/modules/deobfuscator/VMProtectionDeobfuscator.ts src/modules/deobfuscator/ControlFlowDeobfuscator.ts src/modules/deobfuscator/StringArrayDeobfuscator.ts src/modules/deobfuscator/DeadCodeDeobfuscator.ts src/modules/deobfuscator/OpaquePredicateDeobfuscator.ts tests/unit/modules/deobfuscator/*.test.ts
git commit -m "refactor(deobfuscator): split AdvancedDeobfuscator by obfuscation technique

Extract 6 deobfuscation techniques into separate strategy modules:
InvisibleUnicode, VMProtection, ControlFlow, StringArray, DeadCode, OpaquePredicate.
AdvancedDeobfuscator remains as facade coordinating technique dispatch."
```

---

## Phase 5：WasmCollector.ts 拆分

WasmCollector 的要点在于 `buildPreloadScript` 是一个巨大的模板字面量（~500 行 JS 代码），需要完整提取到一个独立文件。binary registry 和 artifact 持久化也是独立的职责。

### Task 5.1: 基线验证 + 确认提取边界

- [ ] **Step 1: 运行基线测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 定位 buildPreloadScript 的起止范围**

```bash
grep -n "private buildPreloadScript\|^\s*}$" src/modules/wasm/WasmCollector.ts
```

确认 `buildPreloadScript` 从哪一行开始、到哪一行结束。这个方法包含一个返回字符串的函数，其中包含了注入到页面的完整 JS 代码。

- [ ] **Step 3: 定位 binary registry 和 artifacts 方法**

确认以下方法的起止行：

- Binary registry: `registerBinary` + `applyExportCallCounts` + 3 个 Map 属性
- Artifact 持久化：`persistArtifacts`

---

### Task 5.2: 创建 WasmPreloadScript.ts

**Files:**

- Create: `src/modules/wasm/WasmPreloadScript.ts`

- [ ] **Step 1: 创建文件，导出 buildPreloadScript 函数**

```typescript
/**
 * Wasm preload script builder.
 * 提取自 WasmCollector.ts —— 生成注入页面的 WebAssembly 拦截脚本。
 */

import type {WasmRuntimeEvent} from './WasmTypes.js';

export function buildPreloadScript(): string {
  // 完整复制 buildPreloadScript 方法的返回内容
  // 这是 ~500 行的 IIFE 模板字面量
  return `(function() {
    if (globalThis.__jshookWasmCaptureInstalled__) return;
    globalThis.__jshookWasmCaptureInstalled__ = true;
    // ... [the rest of the preload script — exact copy]
  })();`;
}
```

**关键注意**：

1. 模板字面量中使用了 `this.runtimeEvents` 和 `this.xxx` 访问 —— 检查 buildPreloadScript 内部是否真正使用了 `this`。如果使用了，预处理为接受参数。
2. 从 WasmCollector.ts 精确复制字符串内容，保持所有转义不变。
3. 如果 buildPreloadScript 内部有辅助函数（`normalizeSource`, `trackBuffer`, `recordEvent`, `setLastWasmActivity` 等），一并提取到这个文件中。

---

### Task 5.3: 创建 WasmBinaryRegistry.ts

**Files:**

- Create: `src/modules/wasm/WasmBinaryRegistry.ts`

- [ ] **Step 1: 提取 binary 注册逻辑**

```typescript
/**
 * Wasm binary registry — 模块 ID、二进制数据和哈希值之间的映射管理。
 */
import type {WasmModuleRecord, WasmRuntimeEvent} from './WasmTypes.js';

export class WasmBinaryRegistry {
  readonly modulesById = new Map<string, WasmModuleRecord>();
  readonly moduleIdsByHash = new Map<string, string>();
  readonly bytesByModuleId = new Map<string, Uint8Array>();

  registerBinary(
    moduleId: string,
    hash: string,
    bytes: Uint8Array,
    record: WasmModuleRecord,
  ): void {
    // 复制 registerBinary 方法体
  }

  applyExportCallCounts(runtimeEvents: WasmRuntimeEvent[]): void {
    // 复制 applyExportCallCounts 方法体
  }

  getModules(): WasmModuleRecord[] {
    /* ... */
  }
  getModuleById(moduleId: string): WasmModuleRecord | undefined {
    /* ... */
  }
  getModuleBytes(moduleId: string): Uint8Array | undefined {
    /* ... */
  }
}
```

- [ ] **Step 2: 从 WasmCollector.ts 精确复制方法体**

---

### Task 5.4: 创建 WasmArtifactStore.ts

**Files:**

- Create: `src/modules/wasm/WasmArtifactStore.ts`

- [ ] **Step 1: 提取 artifact 持久化逻辑**

```typescript
/**
 * Wasm artifact persistence — 将收集的 Wasm 模块写入文件系统。
 */
import fs from 'node:fs';
import path from 'node:path';
import type {WasmModuleRecord} from './WasmTypes.js';

export class WasmArtifactStore {
  constructor(private baseDir: string) {}

  async persistArtifacts(
    modules: WasmModuleRecord[],
    bytesByModuleId: Map<string, Uint8Array>,
    task?: {outputDir: string},
  ): Promise<string[]> {
    // 复制 persistArtifacts 方法体
  }
}
```

---

### Task 5.5: 更新 WasmCollector 门面

**Files:**

- Modify: `src/modules/wasm/WasmCollector.ts`

- [ ] **Step 1: 导入策略模块，初始化子模块**

```typescript
import {buildPreloadScript} from './WasmPreloadScript.js';
import {WasmBinaryRegistry} from './WasmBinaryRegistry.js';
import {WasmArtifactStore} from './WasmArtifactStore.js';

export class WasmCollector {
  private readonly binaryRegistry = new WasmBinaryRegistry();
  private artifactStore?: WasmArtifactStore;
  private readonly runtimeEvents: WasmRuntimeEvent[] = [];
  // 保留 pageController, analyzer, runtimeInspector
  // 删除 modulesById, moduleIdsByHash, bytesByModuleId (已在 BinaryRegistry)
}
```

- [ ] **Step 2: 更新 collect 方法中的引用**

将 `this.modulesById` 改为 `this.binaryRegistry.modulesById` 等。将 `this.registerBinary(...)` 改为 `this.binaryRegistry.registerBinary(...)`。

- [ ] **Step 3: 更新 getter 方法为委托**

```typescript
getModules(): WasmModuleRecord[] {
  return this.binaryRegistry.getModules();
}
// getModuleById, getModuleBytes 同理
```

- [ ] **Step 4: 删除已提取的方法体**

---

### Task 5.6: 运行验证并提交

- [ ] **Step 1: 构建 + 类型检查 + 测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 确认文件大小**

```bash
wc -l src/modules/wasm/WasmCollector.ts
wc -l src/modules/wasm/WasmPreloadScript.ts
wc -l src/modules/wasm/WasmBinaryRegistry.ts
wc -l src/modules/wasm/WasmArtifactStore.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/modules/wasm/WasmCollector.ts src/modules/wasm/WasmPreloadScript.ts src/modules/wasm/WasmBinaryRegistry.ts src/modules/wasm/WasmArtifactStore.ts
git commit -m "refactor(wasm): split WasmCollector into PreloadScript + BinaryRegistry + ArtifactStore

Extract buildPreloadScript template literal (~500 lines) and binary management
into separate modules. WasmCollector remains as coordination facade."
```

---

## Phase 6：CodeCollector.ts 拆分（最终阶段，最复杂）

CodeCollector 是最大的一个（1547 行），`collect` 方法 386 行需要解构为 4 个阶段。

### Task 6.1: 基线验证 + 详细分析 `collect` 方法

- [ ] **Step 1: 运行基线测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 分析 `collect` 方法的 4 个阶段**

在 `src/modules/collector/CodeCollector.ts` 中找到 `async collect(options)` 方法，识别以下 4 个逻辑段：

1. **collectInlineScripts**：遍历 `page.scripts()` 或 `page.evaluate` 获取内联 `<script>` 标签
2. **collectExternalScripts**：处理 CDP 网络响应中的外部脚本文件
3. **collectDynamicScripts**：等待动态加载完成后调用 `waitForDynamicScripts`
4. **collectWorkers**：收集 Service Worker / Web Worker 脚本

记录每个逻辑段的起止行号，以及它们共享的局部变量（`collectedFiles`, `totalSize` 等）。

- [ ] **Step 3: 确认以下待提取的子职责域**

| 提取到                | 职责                    | 状态/方法                                                                                                                                                       |
| --------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CollectedFileRegistry | 文件缓存管理            | `collectedFilesCache` Map, `buildFileMetadata`, `hasReachedFileLimit`, `evictOldestFileIfNeeded`, `cleanupCollectedUrls`, `clearFileCache`, `getFileCacheStats` |
| CdpNetworkMonitor     | CDP 会话 + 网络响应抓取 | `cdpSession`, `cdpListeners`, CDP 绑定/解绑逻辑                                                                                                                 |
| DynamicScriptWatcher  | 动态脚本等待            | `waitForDynamicScripts`                                                                                                                                         |

---

### Task 6.2: 创建 CollectedFileRegistry.ts

**Files:**

- Create: `src/modules/collector/CollectedFileRegistry.ts`

- [ ] **Step 1: 提取文件缓存管理逻辑**

```typescript
import type {CodeFile} from './types.js'; // 验证正确导入路径

export class CollectedFileRegistry {
  readonly collectedFilesCache = new Map<string, CodeFile>();
  private collectedUrls = new Set<string>();
  private readonly MAX_COLLECTED_URLS: number;
  private readonly MAX_FILES_CACHE_SIZE: number;

  constructor(maxUrls: number = 10000, maxCacheSize: number = 10000) {
    this.MAX_COLLECTED_URLS = maxUrls;
    this.MAX_FILES_CACHE_SIZE = maxCacheSize;
  }

  has(url: string): boolean {
    return this.collectedFilesCache.has(url) || this.collectedUrls.has(url);
  }

  addFile(url: string, file: CodeFile): void {
    this.evictOldestIfNeeded();
    this.collectedFilesCache.set(url, file);
    this.collectedUrls.add(url);
    this.cleanupCollectedUrls();
  }

  buildFileMetadata(/* ... */): Record<string, unknown> | undefined {
    // 复制 buildFileMetadata 方法体
  }

  hasReachedFileLimit(currentCount: number): boolean {
    // 复制 hasReachedFileLimit 方法体
  }

  clear(): void {
    this.collectedFilesCache.clear();
    this.collectedUrls.clear();
  }

  getStats(): {cacheSize: number; urlCount: number} {
    return {
      cacheSize: this.collectedFilesCache.size,
      urlCount: this.collectedUrls.size,
    };
  }

  private evictOldestIfNeeded(): void {
    // 复制 evictOldestFileIfNeeded 方法体
  }

  private cleanupCollectedUrls(): void {
    // 复制 cleanupCollectedUrls 方法体
  }
}
```

---

### Task 6.3: 创建 CdpNetworkMonitor.ts

**Files:**

- Create: `src/modules/collector/CdpNetworkMonitor.ts`

- [ ] **Step 1: 提取 CDP 网络监听逻辑**

```typescript
import type {CDPSession} from 'playwright';
import {logger} from '../../utils/logger.js';
import type {CodeCollector} from './CodeCollector.js'; // 验证是否需要前向引用

export class CdpNetworkMonitor {
  private cdpSession: CDPSession | null = null;
  private cdpListeners: {
    targetChanged?: () => void;
    responseReceived?: (params: any) => void;
    loadingFinished?: (params: any) => void;
  } = {};

  async attach(
    cdpSession: CDPSession,
    onResponseReceived: (params: any) => void,
  ): Promise<void> {
    this.cdpSession = cdpSession;
    await cdpSession.send('Network.enable');
    // 复制 CDP 事件绑定逻辑（Target.targetInfoChanged, Network.responseReceived, Network.loadingFinished）
  }

  async detach(): Promise<void> {
    if (this.cdpSession) {
      // 复制 CDP 事件解绑逻辑
      this.cdpSession = null;
    }
  }

  isActive(): boolean {
    return this.cdpSession !== null;
  }

  getSession(): CDPSession | null {
    return this.cdpSession;
  }
}
```

**注意**：CDP 事件绑定中的回调函数引用了 CodeCollector 的方法（如 `captureNetworkResponse`）。在提取后，这些回调通过构造函数参数传入，而非直接引用 `this`。

---

### Task 6.4: 创建 DynamicScriptWatcher.ts

**Files:**

- Create: `src/modules/collector/DynamicScriptWatcher.ts`

- [ ] **Step 1: 提取动态脚本等待逻辑**

```typescript
import type {Page} from 'playwright';

export class DynamicScriptWatcher {
  async waitForStability(page: Page, waitMs?: number): Promise<void> {
    // 复制 waitForDynamicScripts 方法体
    // 此方法使用 Playwright 的 waitForNetworkIdle 或基于时间的等待
    if (waitMs && waitMs <= 0) return;
    if (typeof (page as any).waitForNetworkIdle === 'function') {
      // ... use network idle
    }
    // ... fallback time-based wait
  }
}
```

---

### Task 6.5: 解构 `collect` 方法 + 更新门面

**Files:**

- Modify: `src/modules/collector/CodeCollector.ts`

- [ ] **Step 1: 导入策略模块，初始化子模块**

```typescript
import {CollectedFileRegistry} from './CollectedFileRegistry.js';
import {CdpNetworkMonitor} from './CdpNetworkMonitor.js';
import {DynamicScriptWatcher} from './DynamicScriptWatcher.js';
```

在构造函数中初始化：

```typescript
export class CodeCollector {
  private readonly fileRegistry: CollectedFileRegistry;
  private readonly cdpMonitor: CdpNetworkMonitor;
  private readonly scriptWatcher: DynamicScriptWatcher;
  // 保留 config, browserManager, cache, smartCollector, compressor, getActivePage, setPageResolver

  constructor(config: BrowserManagerConfig, browserManager: BrowserManager) {
    this.fileRegistry = new CollectedFileRegistry(
      config.maxCollectedUrls,
      config.maxFilesCacheSize,
    );
    this.cdpMonitor = new CdpNetworkMonitor();
    this.scriptWatcher = new DynamicScriptWatcher();
    // ... existing init
  }
}
```

- [ ] **Step 2: 将 `collect` 拆分为 4 个阶段方法**

从 `collect` 方法体中提取 4 个阶段为私有方法：

```typescript
async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
  const page = this.pageResolver?.();
  if (!page) {
    return { files: [], totalSize: 0, error: 'NO_PAGE_CONTEXT' };
  }

  const startTime = Date.now();
  let files: CodeFile[] = [];

  files = files.concat(await this.collectInlineScripts(page, options));
  files = files.concat(await this.collectExternalScripts(page, options));
  files = files.concat(await this.collectDynamicScripts(page, options));
  files = files.concat(await this.collectWorkers(page, options));

  const duration = Date.now() - startTime;
  logger.info(`Collected ${files.length} scripts in ${duration}ms`);
  return { files, totalSize: files.reduce((s, f) => s + f.size, 0), duration };
}

private async collectInlineScripts(page: Page, options: CollectCodeOptions): Promise<CodeFile[]> {
  // 提取 collect 方法中收集内联脚本的逻辑段
}

private async collectExternalScripts(page: Page, options: CollectCodeOptions): Promise<CodeFile[]> {
  // 提取收集外部脚本的逻辑段，委托 cdpMonitor
}

private async collectDynamicScripts(page: Page, options: CollectCodeOptions): Promise<CodeFile[]> {
  // 委托 scriptWatcher.waitForStability + 收集
}

private async collectWorkers(page: Page, options: CollectCodeOptions): Promise<CodeFile[]> {
  // 提取收集 Worker 脚本的逻辑段
}
```

**关键约束**：

- `collect` 方法变为编排逻辑，≤100 行
- 每个阶段方法 ≤100 行
- 原始 collect 中的错误处理（try-catch、重试、超时）必须在各阶段方法中完整保留

- [ ] **Step 3: 删除已提取的方法体**

从 CodeCollector 类中删除所有已移到策略文件的方法（`buildFileMetadata`, `hasReachedFileLimit`, `evictOldestFileIfNeeded`, `waitForDynamicScripts` 等）。

- [ ] **Step 4: 将引用 `this.collectedFilesCache` / `this.collectedUrls` 的地方改为 `this.fileRegistry.collectedFilesCache` 等**

- [ ] **Step 5: 确认门面行数**

```bash
wc -l src/modules/collector/CodeCollector.ts
```

预期 ≤450 行。

---

### Task 6.6: 添加策略文件的单元测试

**Files:**

- Create: `tests/unit/modules/collector/CollectedFileRegistry.test.ts`
- Create: `tests/unit/modules/collector/CdpNetworkMonitor.test.ts`
- Create: `tests/unit/modules/collector/DynamicScriptWatcher.test.ts`

- [ ] **Step 1: 编写 CollectedFileRegistry 测试**

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';
import {CollectedFileRegistry} from '../../../src/modules/collector/CollectedFileRegistry.js';

describe('CollectedFileRegistry', () => {
  it('adds and checks files', () => {
    const registry = new CollectedFileRegistry(100, 100);
    assert.strictEqual(registry.has('test.js'), false);
    registry.addFile('test.js', {
      url: 'test.js',
      content: 'code',
      size: 4,
      type: 'script',
    } as any);
    assert.strictEqual(registry.has('test.js'), true);
  });

  it('enforces FIFO eviction', () => {
    const registry = new CollectedFileRegistry(100, 2);
    registry.addFile('1.js', {url: '1.js'} as any);
    registry.addFile('2.js', {url: '2.js'} as any);
    registry.addFile('3.js', {url: '3.js'} as any);
    assert.strictEqual(registry.has('1.js'), false); // evicted
    assert.strictEqual(registry.has('3.js'), true);
  });

  it('clear resets state', () => {
    const registry = new CollectedFileRegistry(100, 100);
    registry.addFile('test.js', {url: 'test.js'} as any);
    registry.clear();
    assert.strictEqual(registry.has('test.js'), false);
  });
});
```

- [ ] **Step 2: 编写 CdpNetworkMonitor 测试**（mock CDPSession）

- [ ] **Step 3: 编写 DynamicScriptWatcher 测试**

---

### Task 6.7: 运行最终验证并提交

- [ ] **Step 1: 构建 + 类型检查 + 全部单元测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

确认全部通过。CodeCollector 的测试（包含 collect、getActivePage 等）无回归。

- [ ] **Step 2: 确认最终文件大小**

```bash
wc -l src/modules/collector/CodeCollector.ts
wc -l src/modules/collector/CollectedFileRegistry.ts
wc -l src/modules/collector/CdpNetworkMonitor.ts
wc -l src/modules/collector/DynamicScriptWatcher.ts
```

- [ ] **Step 3: 格式检查**

```bash
npm run check-format
npm run format
```

- [ ] **Step 4: 提交**

```bash
git add src/modules/collector/CodeCollector.ts src/modules/collector/CollectedFileRegistry.ts src/modules/collector/CdpNetworkMonitor.ts src/modules/collector/DynamicScriptWatcher.ts tests/unit/modules/collector/CollectedFileRegistry.test.ts tests/unit/modules/collector/CdpNetworkMonitor.test.ts tests/unit/modules/collector/DynamicScriptWatcher.test.ts
git commit -m "refactor(collector): split CodeCollector into FileRegistry + CdpMonitor + ScriptWatcher

Extract file caching, CDP network monitoring, and dynamic script waiting
into separate strategy modules. Decompose 386-line collect() into 4-phase
orchestration method. CodeCollector remains as thin facade."
```

---

## 最终验证

所有 6 个 Phase 完成后，运行全量验证：

- [ ] `npm run build && npm run typecheck` — 无错误
- [ ] `npm run test:unit` — 全部通过
- [ ] `npm run check-format` — 无格式问题
- [ ] `wc -l` 检查每个文件 ≤450（门面）或 ≤500（策略）
- [ ] Git log 确认 6 个独立 commit 在提交树上
