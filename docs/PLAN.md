# JSReverser-CLI 架构改进实施规划

> 参考来源：jshookmcp 项目结构分析（`D:\ai-llm\MCP\jshookmcp\PROJECT_ANALYSIS.md`）
> 生成日期：2026-05-19
> 当前分支：new

---

## 背景与目标

通过对比 jshookmcp（389 工具 / 38 域 / 微内核架构）与当前项目，识别出 7 个可借鉴的架构改进点。本文档将这些改进项拆解为可执行的任务，按优先级排序，每个任务包含具体文件变更和验收标准。

**不改变的内容**：
- 现有工具的行为和 API 接口
- RPC/Sekiro 协议层
- 浏览器管理逻辑
- 测试文件（除非专门针对测试框架迁移）

---

## 改进项总览

| 优先级 | 改进项 | 预估工时 | 风险 |
|--------|--------|----------|------|
| P0 | 错误分类体系扩展 | 半天 | 低 |
| P0 | 工具 Manifest 契约 + 构建时自动发现 | 2-3天 | 中 |
| P1 | config.ts 拆分 | 半天 | 低 |
| P1 | Vitest 迁移 | 1-2天 | 中 |
| P2 | EventBus 轻量实现 | 1天 | 低 |
| P2 | 工具执行管道中间件 | 1天 | 中 |
| P3 | CLI 层冗余清理 | 半天 | 低 |

---

## Phase 1：P0 — 错误分类体系扩展

### 目标
将现有的 5 个错误码（`src/utils/errors.ts`）扩展为 7 类分层错误体系，与 jshookmcp 的 ToolError 模式对齐，让 AI 客户端能根据错误类型做出不同响应。

### 现状
```typescript
// src/utils/errors.ts — 当前只有 5 个扁平错误码
export const ErrorCodes = {
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  BROWSER_ERROR: 'BROWSER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
```

### 目标状态
```typescript
// 7 类错误码，每类有明确的 AI 响应建议
export const ErrorCodes = {
  PREREQUISITE: 'PREREQUISITE',   // 前置条件未满足（如浏览器未连接）
  VALIDATION: 'VALIDATION',       // 参数校验失败
  NOT_FOUND: 'NOT_FOUND',         // 工具/资源未找到
  TIMEOUT: 'TIMEOUT',             // 操作超时
  CONNECTION: 'CONNECTION',       // 浏览器/CDP 连接失败
  RUNTIME: 'RUNTIME',             // 通用运行时错误
  PERMISSION: 'PERMISSION',       // 权限拒绝
} as const;
```

### 任务清单

#### Task 1.1：扩展 ErrorCodes 并添加 ToolError 基类
**文件**：`src/utils/errors.ts`

变更内容：
1. 将现有 5 个错误码替换为 7 个新错误码
2. 添加向后兼容别名（旧码 → 新码映射）
3. 新增 `ToolError` 类，继承 `Error`，携带 `code`、`context`、`recoverable` 字段
4. 新增 `createToolError(code, message, context?)` 工厂函数

```typescript
export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
    public readonly recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function createToolError(
  code: ToolErrorCode,
  message: string,
  context?: Record<string, unknown>,
): ToolError {
  return new ToolError(code, message, context);
}
```

**验收**：`src/utils/errors.ts` 编译通过，现有测试 `tests/unit/utils/errors.test.ts` 不破坏。

#### Task 1.2：更新 ToolAdapter 使用新错误码
**文件**：`src/worker/ToolAdapter.ts`

变更内容：
- `reject(errMsg)` 改为在 catch 块中识别错误类型并使用对应错误码
- 浏览器未连接 → `CONNECTION`
- 参数校验失败 → `VALIDATION`
- handler 未找到 → `NOT_FOUND`
- 其他 → `RUNTIME`

**验收**：`tests/unit/worker/ToolAdapter.test.ts` 通过。

#### Task 1.3：更新 CDPErrorMapper 使用新错误码
**文件**：`src/browser/CDPErrorMapper.ts`

变更内容：
- CDP 连接错误 → `CONNECTION`
- CDP 超时 → `TIMEOUT`

**验收**：`tests/unit/browser/CDPErrorMapper.test.ts` 通过。

---

## Phase 2：P0 — 工具 Manifest 契约 + 构建时自动发现

### 目标
引入 `DomainManifest` 契约，让每个工具目录自我描述，通过构建时脚本自动生成工具索引，替代手动维护的 `TOOL_REGISTRY` 数组。

### 现状
```typescript
// src/cli/tools-meta.ts — 手动维护的注册表，每新增工具需手动添加
const TOOL_REGISTRY: ToolRegistryEntry[] = [
  {modulePath: './pipeline/examples.js', handlerName: 'analyzePipeline'},
  {modulePath: './workflow/observeFlow.js', handlerName: 'observeFlow'},
  // ... 手动维护 ~60+ 条目
];
```

### 目标状态
```
src/tools/
├── workflow/
│   ├── manifest.ts          ← 新增：域 manifest
│   ├── observeFlow.ts
│   └── autoHook.ts
├── hook/
│   ├── manifest.ts          ← 新增：域 manifest
│   └── ...
└── generated-tools-index.ts ← 构建时生成，不手动编辑
```

### 任务清单

#### Task 2.1：定义 DomainManifest 接口
**文件**：`src/tools/manifest.ts`（新建）

```typescript
export interface ToolEntry {
  modulePath: string;   // 相对于 src/tools/ 的路径
  handlerName: string;  // 导出名
}

export interface DomainManifest {
  name: string;
  description: string;
  tools: ToolEntry[];
}
```

**验收**：文件创建，TypeScript 编译通过。

#### Task 2.2：为现有工具目录创建 manifest.ts
为以下目录各创建一个 `manifest.ts`（按工具数量从少到多逐步迁移）：

优先迁移（工具数 ≤ 5）：
- `src/tools/pipeline/manifest.ts`
- `src/tools/screenshot/manifest.ts`
- `src/tools/emulation/manifest.ts`
- `src/tools/dialog/manifest.ts`
- `src/tools/frames/manifest.ts`
- `src/tools/performance/manifest.ts`
- `src/tools/page/manifest.ts`

次优先迁移（工具数 6-15）：
- `src/tools/workflow/manifest.ts`
- `src/tools/navigation/manifest.ts`
- `src/tools/input/manifest.ts`
- `src/tools/dom/manifest.ts`
- `src/tools/console/manifest.ts`
- `src/tools/script/manifest.ts`
- `src/tools/network/manifest.ts`

最后迁移（工具数 > 15）：
- `src/tools/hook/manifest.ts`
- `src/tools/debugger/manifest.ts`
- `src/tools/analyzer/manifest.ts`
- `src/tools/collector/manifest.ts`
- `src/tools/crypto/manifest.ts`
- `src/tools/wasm/manifest.ts`
- `src/tools/stealth/manifest.ts`
- `src/tools/rebuild/manifest.ts`
- `src/tools/reverse/manifest.ts`（如存在）
- `src/tools/vue/manifest.ts`
- `src/tools/vjstools/manifest.ts`
- `src/tools/anti-debug/manifest.ts`
- `src/tools/site-experience/manifest.ts`
- `src/tools/extensions/manifest.ts`

**验收**：所有 manifest.ts 文件创建，工具条目与 `TOOL_REGISTRY` 中对应条目一致。

#### Task 2.3：创建构建时索引生成脚本
**文件**：`scripts/generate-tools-index.ts`（新建）

功能：
1. 扫描 `src/tools/*/manifest.ts`
2. 聚合所有 `ToolEntry`
3. 生成 `src/tools/generated-tools-index.ts`（包含 `GENERATED_TOOL_REGISTRY`）

```typescript
// 生成的文件格式
export const GENERATED_TOOL_REGISTRY = [
  // pipeline
  {modulePath: './pipeline/examples.js', handlerName: 'analyzePipeline'},
  // workflow
  {modulePath: './workflow/observeFlow.js', handlerName: 'observeFlow'},
  // ...
] as const;
```

**验收**：运行 `node --experimental-strip-types scripts/generate-tools-index.ts` 生成文件，内容与现有 `TOOL_REGISTRY` 一致。

#### Task 2.4：将 generate-tools-index 集成到 build 脚本
**文件**：`package.json`

变更：在 `build` 脚本中，在 `swc` 编译之前先运行 `generate-tools-index`：
```json
"build": "node --experimental-strip-types scripts/generate-tools-index.ts && swc src tests -d build --extensions .ts && node --experimental-strip-types scripts/post-build.ts"
```

**验收**：`npm run build` 成功，生成的索引文件被编译进 `build/`。

#### Task 2.5：更新 tools-meta.ts 使用生成的索引
**文件**：`src/cli/tools-meta.ts`

变更：将 `TOOL_REGISTRY` 替换为从 `generated-tools-index.ts` 导入的 `GENERATED_TOOL_REGISTRY`，保留原有的动态加载逻辑不变。

**验收**：`npm run test:quick` 通过，工具数量与迁移前一致。

---

## Phase 3：P1 — config.ts 拆分

### 目标
将 24KB 的 `src/config.ts` 拆分为职责单一的三个文件。

### 现状
`src/config.ts`（24KB）混合了：
- 配置常量默认值
- Zod schema 定义
- 配置合并逻辑（CLI > env > 文件 > 默认值）

### 目标状态
```
src/config/
├── constants.ts    ← 所有默认值常量
├── schema.ts       ← Zod schema 定义
├── resolver.ts     ← 合并逻辑
└── index.ts        ← 重导出，保持向后兼容
```

### 任务清单

#### Task 3.1：创建 src/config/ 目录结构
**文件**：`src/config/constants.ts`、`src/config/schema.ts`、`src/config/resolver.ts`、`src/config/index.ts`

变更：
1. 从 `src/config.ts` 提取常量到 `constants.ts`
2. 从 `src/config.ts` 提取 Zod schema 到 `schema.ts`
3. 从 `src/config.ts` 提取合并逻辑到 `resolver.ts`
4. `src/config/index.ts` 重导出所有公开 API
5. `src/config.ts` 改为只重导出 `src/config/index.ts`（保持向后兼容）

**验收**：`npm run typecheck` 通过，`tests/unit/utils/config.test.ts` 通过。

---

## Phase 4：P1 — Vitest 迁移

### 目标
将测试框架从 Node.js 内置 `--test` runner 迁移到 Vitest，消除"先 build 再测试"的开发摩擦。

### 现状
- 测试需要先 `npm run build`，再 `node --test build/tests/**/*.test.js`
- 无 watch 模式
- 覆盖率工具：c8

### 目标状态
- `vitest run` 直接运行 TypeScript 源文件，无需预构建
- `vitest watch` 支持热重载
- 3 个测试项目组：`pure`（纯工具）、`browser`（浏览器相关）、`integration`（集成测试）
- 覆盖率工具：Vitest 内置 V8

### 任务清单

#### Task 4.1：安装 Vitest 依赖
```bash
npm install --save-dev vitest @vitest/coverage-v8
```

**验收**：`package.json` 中出现 vitest 依赖。

#### Task 4.2：创建 vitest.config.ts
**文件**：`vitest.config.ts`（新建）

```typescript
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        name: 'pure',
        include: [
          'tests/unit/utils/**/*.test.ts',
          'tests/unit/modules/**/*.test.ts',
          'tests/unit/functions/**/*.test.ts',
          'tests/property/**/*.test.ts',
        ],
      },
      {
        name: 'browser',
        include: [
          'tests/unit/browser/**/*.test.ts',
          'tests/unit/tools/**/*.test.ts',
          'tests/unit/worker/**/*.test.ts',
          'tests/unit/services/**/*.test.ts',
        ],
      },
      {
        name: 'integration',
        include: ['tests/integration/**/*.test.ts'],
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
});
```

**验收**：`npx vitest run --project pure` 能运行纯工具测试。

#### Task 4.3：更新 package.json 测试脚本
**文件**：`package.json`

新增脚本（保留旧脚本作为备用）：
```json
"test:vitest": "vitest run",
"test:vitest:pure": "vitest run --project pure",
"test:vitest:browser": "vitest run --project browser",
"test:vitest:watch": "vitest watch",
"coverage:vitest": "vitest run --coverage"
```

**验收**：`npm run test:vitest:pure` 通过。

#### Task 4.4：修复 Vitest 兼容性问题
Node.js `--test` runner 的 API（`test()`、`describe()`、`it()`、`assert`）与 Vitest 不同。需要：
1. 检查 `tests/setup.ts` 是否需要调整
2. 将 `node:test` 的 `test/describe/it` 替换为 Vitest 的对应 API（如有差异）
3. 将 `assert` 替换为 `expect`（如有差异）

**验收**：`npm run test:vitest:pure` 全部通过，无跳过。

---

## Phase 5：P2 — EventBus 轻量实现

### 目标
引入类型安全的 EventBus，解耦模块间的直接调用依赖，为未来的域间通信提供基础设施。

### 任务清单

#### Task 5.1：创建 EventBus
**文件**：`src/utils/EventBus.ts`（新建）

```typescript
type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus<TMap extends Record<string, unknown>> {
  private handlers = new Map<keyof TMap, Set<EventHandler<unknown>>>();

  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    this.handlers.get(event)?.forEach(h => h(payload));
  }
}
```

#### Task 5.2：定义项目事件类型
**文件**：`src/types/events.ts`（新建）

```typescript
export interface AppEventMap {
  'browser:launched': {url: string; mode: string};
  'browser:closed': {reason: string};
  'hook:injected': {hookId: string; target: string; url: string};
  'hook:triggered': {hookId: string; data: unknown};
  'network:captured': {requestId: string; url: string; method: string};
  'debugger:paused': {reason: string; scriptId: string};
  'debugger:resumed': Record<string, never>;
  'tool:called': {name: string; durationMs: number; success: boolean};
  'tool:error': {name: string; code: string; message: string};
}
```

#### Task 5.3：在 Runtime 中集成 EventBus
**文件**：`src/runtime.ts`

变更：在 `Runtime` 对象中添加 `eventBus: EventBus<AppEventMap>` 字段，供各模块使用。

**验收**：`npm run typecheck` 通过。

---

## Phase 6：P2 — 工具执行管道中间件

### 目标
在 `ToolAdapter.wrapTool()` 中引入统一的执行管道，添加 Token 预算跟踪和工具调用事件发布。

### 任务清单

#### Task 6.1：在 ToolAdapter 中添加执行管道
**文件**：`src/worker/ToolAdapter.ts`

在现有 `wrapTool()` 方法的 try-catch 中，在 `resolve()` 之前添加：
1. Token 预算记录（调用 `TokenBudgetManager`，如已存在）
2. 发布 `tool:called` 事件到 EventBus
3. 大响应检测（响应 JSON 超过 512KB 时记录警告日志）

**验收**：`tests/unit/worker/ToolAdapter.test.ts` 通过，工具调用日志包含 duration 信息（已有）。

---

## Phase 7：P3 — CLI 层冗余清理

### 目标
删除 `src/cli.ts`（8KB 的旧 CLI 入口），将所有 CLI 逻辑统一到 `src/cli/` 目录。

### 现状
- `src/cli.ts`：旧的 yargs 配置，定义了 `cliOptions`
- `src/cli/`：新的 CLI 实现，包含 `app.ts`、`args-parser.ts` 等

### 任务清单

#### Task 7.1：检查 src/cli.ts 的引用
运行：`grep -r "from '../cli.js'" src/ tests/`

如果 `src/cli.ts` 中的 `cliOptions` 被其他文件引用，先将其迁移到 `src/cli/args-parser.ts` 或 `src/cli/types.ts`。

#### Task 7.2：删除 src/cli.ts
确认无引用后删除文件，更新所有 import 路径。

**验收**：`npm run typecheck` 通过，`npm run test:quick` 通过。

---

## 执行顺序与依赖关系

```
Phase 1 (错误体系)
    ↓
Phase 2 (Manifest 契约)  ←→  Phase 3 (config 拆分)  [可并行]
    ↓
Phase 4 (Vitest 迁移)
    ↓
Phase 5 (EventBus)
    ↓
Phase 6 (执行管道)
    ↓
Phase 7 (CLI 清理)
```

Phase 1 和 Phase 3 可以独立进行，互不依赖。
Phase 2 依赖 Phase 1（使用新错误码）。
Phase 5 依赖 Phase 1（事件中携带错误码）。
Phase 6 依赖 Phase 5（使用 EventBus）。

---

## 验收总标准

每个 Phase 完成后必须满足：
1. `npm run typecheck` — 零 TypeScript 错误
2. `npm run build` — 构建成功
3. `npm run test:quick` — 快速测试通过（unit/tools + unit/services + unit/utils）
4. 不破坏现有工具的行为（工具名、参数、返回格式不变）

---

## 风险与注意事项

1. **Phase 2 风险**：`TOOL_REGISTRY` 手动维护了 60+ 条目，迁移时需逐一核对，避免遗漏。建议迁移后运行 `npm run test:quick` 验证工具数量一致。

2. **Phase 4 风险**：Node.js `--test` 和 Vitest 的 API 有差异（`assert` vs `expect`，`test()` 的 `todo` 标记等）。建议先迁移 `pure` 项目组，验证通过后再迁移 `browser` 组。

3. **Phase 6 注意**：`TokenBudgetManager` 已存在于 `src/utils/TokenBudgetManager.ts`，直接复用即可，无需重新实现。

---

*本文档由 Claude Code 基于 jshookmcp 架构分析生成，2026-05-19*
