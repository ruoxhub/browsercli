# JSReverser-CLI 架构重构设计

日期：2026-06-18
状态：Draft
来源：GitNexus 知识图谱分析（14,386 符号、28,573 关系、299 执行流程）

## 背景

GitNexus 对当前项目做了全量代码智能分析，发现 4 类架构问题：

1. **死代码**：40+ 个函数无调用者，增加认知噪音
2. **循环依赖**：6 对文件存在双向 import（其中 2 组为真实运行时循环）
3. **上帝文件**：5 个文件超过 580 行，最大 1853 行，单文件承载过多职责
4. **高扇入瓶颈**：`defineTool`（102 调用方）、`getRuntime`（57 调用方）签名变更影响面极大

## 目标

系统性消除上述 4 类问题，提升代码可维护性和改动安全性。

## 约束

- 允许调整一切接口（包括 MCP 工具参数和 CLI 命令），但优先保持向后兼容
- 采用自底向上、按风险递进的策略：低风险先行，为后续高风险重构降低复杂度
- 每个 Phase 独立可提交、可测试、可回退

## 策略选择

评估了 3 种方案：

| 方案                           | 描述                            | 选择                                |
| ------------------------------ | ------------------------------- | ----------------------------------- |
| A. 自底向上，风险递进          | 死代码→循环依赖→上帝文件→高扇入 | **采用**                            |
| B. 自顶向下，架构优先          | 先定义模块边界图再统一重构      | 前期成本过高，项目活跃迭代中        |
| C. Hub-first，先拆 ToolContext | 直击耦合最严重的单点            | 单次改动影响面过大（12 个依赖文件） |

方案 A 与项目近期的小步重构节奏一致（最近 10 个 commit 均为局部重构），且每阶段产出独立可交付成果。

---

## Phase 1：死代码清理

### 问题描述

GitNexus 发现 40+ 个无调用者的函数。经交叉验证，大部分为误报（CLI 命令通过 commander 动态注册、局部变量被误识别为函数），但确认存在 6 个真实死导出。

### 确认的死导出

| 文件                                 | 死导出                     | 验证方式                   |
| ------------------------------------ | -------------------------- | -------------------------- |
| `src/formatters/consoleFormatter.ts` | `formatConsoleEventShort`  | 全项目 grep 仅在本文件出现 |
| `src/formatters/networkFormatter.ts` | `getFormattedHeaderValue`  | 同上                       |
| `src/formatters/networkFormatter.ts` | `getFormattedResponseBody` | 同上                       |
| `src/formatters/networkFormatter.ts` | `getFormattedRequestBody`  | 同上                       |
| `src/cli/tools-meta.ts`              | `getToolArgSpecs`          | 同上                       |
| `src/cli/tools-meta.ts`              | `loadToolMeta`             | 同上                       |

### 确认的误报

| 函数                                           | 实际状态                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- |
| CLI 命令（configCommand, listToolsCommand 等） | 通过 `src/cli/index.ts` re-export，被 `app.ts` 注册到 commander |
| `createWorkerContext`                          | 被 `bin/js-reverse.ts` 导入                                     |
| `resolveAutoConnectTarget`                     | 被 `src/browser/index.ts` re-export                             |
| `ensureBrowserConnected/Launched`              | 被 `src/browser/index.ts` re-export                             |
| `callFrames`, `timer`, `found` 等              | 局部变量，GitNexus 误识别为独立函数                             |

### 需要进一步确认的候选

- `src/browser/SessionManager.ts` → `remainingTags`（可能是内部闭包变量）
- `src/config/schema.ts` → `GlobalConfigSchema`, `AIConfigSchema`, `booleanSchema`, `errorMap`（可能是 Zod schema 被同文件其他 schema 引用但 GitNexus 未识别为 CALLS）

### 修复方案

1. 删除 6 个确认的死导出函数
2. 对"需要进一步确认"的候选做逐文件 grep 验证：真死的删除，误报的跳过
3. `npm run typecheck` — 如果有其他地方引用会立刻报错
4. `npm run test:unit` — 确认无回归

### 涉及文件

- `src/formatters/consoleFormatter.ts` — 删除 `formatConsoleEventShort`
- `src/formatters/networkFormatter.ts` — 删除 3 个死导出函数
- `src/cli/tools-meta.ts` — 删除 `getToolArgSpecs`, `loadToolMeta`
- 可能追加：`src/browser/SessionManager.ts`, `src/config/schema.ts`

### 验收标准

- [ ] 确认的死导出全部删除
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过
- [ ] 无回归

### 风险

- **极低**：删除未被引用的导出不影响运行时行为
- **回退**：`git revert`

---

## Phase 2：打断循环依赖

### 问题描述

GitNexus 发现 6 对文件存在双向 import。经分析，其中 4 对是纯 type-only import（TypeScript 编译后擦除，无运行时风险），2 对是混合循环（一方值导入 + 另一方类型导入），有真实的运行时影响。

### 循环依赖分类

| 组  | 文件 A              | 文件 B                | A→B 类型                       | B→A 类型                    | 严重度           |
| --- | ------------------- | --------------------- | ------------------------------ | --------------------------- | ---------------- |
| 2   | IntelligentAnalyzer | PatternDetector       | **值**（detect 函数）          | 类型（Analyzer 接口）       | **需修复**       |
| 4   | ToolContext         | ToolExecutionPipeline | **值**（wrapFrameWithTimeout） | 类型（ToolContextProvider） | **需修复**       |
| 1   | DebuggerManager     | RuntimeInspector      | 类型                           | 类型                        | 低，不修         |
| 3   | ToolContext         | runtime               | 类型                           | 无直接导入                  | 低，不修         |
| 5   | tool-search-engine  | tools-meta            | 类型                           | 值                          | 低，单向值，不修 |
| 6   | WebSocketCollector  | types.ts (network)    | 类型                           | 类型                        | 低，不修         |

### 修复方案

#### 2.1 IntelligentAnalyzer ↔ PatternDetector

**当前**：

- `IntelligentAnalyzer.ts` 值导入 `detectAntiDebugPatterns`, `detectEncryptionPatterns`, `detectSignaturePatterns` 从 `PatternDetector.ts`
- `PatternDetector.ts` 类型导入 `AnalyzerConsoleMessage`, `AnalyzerNetworkRequest` 等从 `IntelligentAnalyzer.ts`

**修复**：将 `PatternDetector.ts` 中被 IntelligentAnalyzer 消费的 detect 函数提取到独立文件 `src/modules/analyzer/PatternDetectorFunctions.ts`。IntelligentAnalyzer 改为从新文件导入。PatternDetector.ts 保留为门面类，可选 re-export。

#### 2.2 ToolContext ↔ ToolExecutionPipeline

**当前**：

- `ToolContext.ts` 值导入 `wrapFrameWithTimeout` 从 `ToolExecutionPipeline.ts`
- `ToolExecutionPipeline.ts` 类型导入 `DefineToolContextFactory`, `ToolContextProvider` 从 `ToolContext.ts`

**修复**：将 `wrapFrameWithTimeout` 提取到 `src/worker/timeoutUtils.ts`（纯工具函数，不属于执行管线）。ToolContext 改为从新文件导入。

### 涉及文件

- 新建：`src/modules/analyzer/PatternDetectorFunctions.ts`
- 新建：`src/worker/timeoutUtils.ts`
- 修改：`src/modules/analyzer/IntelligentAnalyzer.ts` — 更新 import 路径
- 修改：`src/modules/analyzer/PatternDetector.ts` — 移除提取的函数
- 修改：`src/worker/ToolContext.ts` — 更新 import 路径
- 修改：`src/worker/ToolExecutionPipeline.ts` — 移除提取的函数

### 验收标准

- [ ] 组 2 和组 4 的循环依赖被消除
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过
- [ ] 无回归

### 风险

- **低-中**：纯搬移操作，不改逻辑
- **回退**：`git revert`

---

## Phase 3：上帝文件拆分

### 问题描述

5 个文件承载了过多职责，行数和符号数远超合理范围：

| 文件                                       | 行数 | 符号数    | 核心问题                     |
| ------------------------------------------ | ---- | --------- | ---------------------------- |
| `src/modules/deobfuscator/Deobfuscator.ts` | 1853 | ~18       | 多种去混淆策略混合在一个类中 |
| `src/modules/wasm/WasmAnalyzer.ts`         | 1051 | ~25       | 静态分析和运行时检查混合     |
| `src/config/resolver.ts`                   | 879  | ~30       | 所有配置域的解析逻辑集中     |
| `src/modules/wasm/WasmRuntimeInspector.ts` | 842  | ~24       | 与 WasmAnalyzer 职责边界模糊 |
| `src/worker/ToolContext.ts`                | 586  | 98 (3 类) | 3 个不同职责的类共存一个文件 |

### 修复方案

按 3d → 3a → 3c → 3b 顺序执行（从最简单到最复杂）：

#### Phase 3d：ToolContext.ts 拆分

当前包含 3 个类，天然适合按类拆分：

| 类                         | 预估行数 | 职责                                         | 拆出到                                   |
| -------------------------- | -------- | -------------------------------------------- | ---------------------------------------- |
| `ServiceLocator`           | ~100 行  | 延迟服务工厂（getCollector, getAnalyzer 等） | `src/worker/ServiceLocator.ts`           |
| `ToolContextProvider`      | ~350 行  | 浏览器/页面/网络/调试器状态管理              | 保留在 `src/worker/ToolContext.ts`       |
| `DefineToolContextFactory` | ~80 行   | 创建 MCP Context 对象供工具使用              | `src/worker/DefineToolContextFactory.ts` |

注意：此拆分与 Phase 2 的循环依赖修复有关联。必须先完成 Phase 2（提取 wrapFrameWithTimeout）再开始 3d。

#### Phase 3a：Deobfuscator.ts 拆分

**推荐策略**：

- 按去混淆策略类型拆分为独立文件，每个策略一个文件
- `Deobfuscator.ts` 保留为门面类（facade），协调各子策略的调用顺序
- 每个子策略文件不超过 400 行
- 具体拆分边界需要在实施时通读 1853 行源码后确定。预计的拆分维度包括：字符串解密策略、控制流平坦化恢复、死代码消除、AST 优化/简化、packer 解包等。最终以实施计划为准

#### Phase 3c：resolver.ts 拆分

**推荐策略**：

- 按配置域拆分：`browserResolver.ts`（浏览器相关）、`aiResolver.ts`（AI/LLM 相关）、`networkResolver.ts`（网络代理相关）
- `resolver.ts` 保留为统一入口，re-export 各子解析器的公共函数
- 提取共享的配置验证逻辑到 `configValidation.ts`（如果需要）

#### Phase 3b：WasmAnalyzer.ts + WasmRuntimeInspector.ts 拆分

**推荐策略**：

- 提取共享的 Wasm 类型和辅助函数到 `WasmAnalysisUtils.ts`
- WasmAnalyzer 聚焦静态分析（二进制解析、控制流图构建）
- WasmRuntimeInspector 聚焦运行时检查（内存检查、函数调用追踪）
- 确保两者之间只有单向依赖：`WasmRuntimeInspector` → `WasmAnalyzer`

### 涉及文件

**Phase 3d：**

- 新建：`src/worker/ServiceLocator.ts`
- 新建：`src/worker/DefineToolContextFactory.ts`
- 修改：`src/worker/ToolContext.ts` — 移除拆出的类
- 修改：所有 import ToolContext 中 ServiceLocator/DefineToolContextFactory 的文件

**Phase 3a：**

- 新建：2-4 个子策略文件（在 `src/modules/deobfuscator/` 下）
- 修改：`src/modules/deobfuscator/Deobfuscator.ts` — 精简为门面
- 修改：`src/modules/deobfuscator/index.ts` — 更新 re-export

**Phase 3c：**

- 新建：`src/config/browserResolver.ts`, `src/config/aiResolver.ts`, `src/config/networkResolver.ts`
- 修改：`src/config/resolver.ts` — 精简为统一入口

**Phase 3b：**

- 新建：`src/modules/wasm/WasmAnalysisUtils.ts`
- 修改：`src/modules/wasm/WasmAnalyzer.ts` — 聚焦静态分析
- 修改：`src/modules/wasm/WasmRuntimeInspector.ts` — 聚焦运行时检查

### 验收标准

- [ ] 每个拆分后的文件不超过 500 行
- [ ] 每个拆分后的文件只承载单一职责
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过
- [ ] 无回归

### 风险

- **中**：大文件拆分涉及大量 import 路径更新
- **回退**：每个子阶段独立提交，可逐个 revert

---

## Phase 4：高扇入接口稳定化

### 问题描述

| 函数            | 调用者数 | 所在文件                      |
| --------------- | -------- | ----------------------------- |
| `defineTool`    | 102      | `src/tools/ToolDefinition.ts` |
| `getRuntime`    | 57       | `src/runtime.ts`              |
| `safeStringify` | 16       | `src/utils/safeJson.ts`       |
| `getEnvValue`   | 11       | `src/config/resolver.ts`      |

这些是全局瓶颈——任何签名变更会影响数十到上百处调用方。

### 修复方案

不做代码层面的抽象（那会引入不必要的间接层），而是通过接口冻结 + 文档标注确保稳定性。

#### 4.1 defineTool 签名冻结

在 `src/tools/ToolDefinition.ts` 顶部添加 JSDoc `@stable` 标注：

```typescript
/**
 * @stable 此函数被 102 个工具文件调用。修改签名前必须运行 impact 分析。
 * 扩展参数时使用可选属性或 Partial<>，不要修改必选参数。
 */
```

#### 4.2 Runtime 接口标注

在 `src/runtime.ts` 的 `Runtime` 接口和 `getRuntime` 函数上添加 `@stable` 标注。

后续新增服务时，通过 `RuntimeServices` lazy getter 暴露，而不是直接加到 Runtime 接口。

#### 4.3 AGENTS.md 更新

在 Architecture Notes 中新增"高扇入接口"小节，列出所有 `@stable` 标注的函数。

#### 4.4 Phase 1-3 后的扇入重评估

Phase 1-3 完成后，重新运行 GitNexus 分析，对比前后扇入变化。如果 defineTool 或 getRuntime 的调用者数量因拆分而变化，重新评估是否需要额外措施。

### 涉及文件

- `src/tools/ToolDefinition.ts` — 添加 `@stable` JSDoc
- `src/runtime.ts` — 添加 `@stable` JSDoc
- `AGENTS.md` — Architecture Notes 新增高扇入标注

### 验收标准

- [ ] defineTool 和 getRuntime 有 `@stable` 标注
- [ ] AGENTS.md 包含高扇入接口列表
- [ ] GitNexus 重分析后扇入数据已记录

### 风险

- **极低**：纯文档和标注变更
- **回退**：直接 revert

---

## 实施顺序总览

| Phase                 | 类型 | 预估影响文件数 | 风险  | 依赖      |
| --------------------- | ---- | -------------- | ----- | --------- |
| 1. 死代码清理         | 代码 | 3-5            | 极低  | 无        |
| 2. 循环依赖           | 代码 | 6              | 低-中 | 无        |
| 3d. ToolContext 拆分  | 代码 | 5+             | 中    | Phase 2   |
| 3a. Deobfuscator 拆分 | 代码 | 4+             | 中    | 无        |
| 3c. resolver 拆分     | 代码 | 4+             | 中    | 无        |
| 3b. Wasm 模块拆分     | 代码 | 3+             | 中    | 无        |
| 4. 高扇入稳定化       | 文档 | 3              | 极低  | Phase 1-3 |

建议提交顺序：1 → 2 → 3d → (3a, 3c, 3b 互不依赖，可任意顺序) → 4。每个 Phase 独立 commit。

## 成功标准

- [ ] 所有确认的死导出已清除
- [ ] 2 组真实运行时循环依赖已消除
- [ ] 5 个上帝文件均拆分到 500 行以内
- [ ] defineTool 和 getRuntime 有 @stable 标注
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过
- [ ] 无回归
