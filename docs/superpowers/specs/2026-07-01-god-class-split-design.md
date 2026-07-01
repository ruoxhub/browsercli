# God Class 拆分设计

日期：2026-07-01
状态：Draft
来源：GitNexus 知识图谱分析（14,533 符号、28,712 关系、300 执行流程）

## 背景

项目已完成两轮 GitNexus 驱动的重构：

1. **架构重构**（`2026-06-18-architecture-refactor-design.md`）：死代码清理、循环依赖打断、5 个上帝文件拆分（Deobfuscator/WasmAnalyzer/resolver/ToolContext/WasmRuntimeInspector）、高扇入接口 `@stable` 标注。
2. **四方向修复**（`2026-06-18-four-fix-directions-design.md`）：工具崩溃防护、Hook 注入 world 参数、工作流定义统一、孤立节点文档补全。

两轮 spec 均已全部实施完成（见 commit `346c0d6`..`cec2a53`）。ToolContext.ts 拆分生效（方法数从 61 降至 18）。

新一轮 GitNexus 分析发现 **6 个 god class 仍然存在**，均未被前两轮覆盖。这些类行数 747–1547，方法数 42–171，是当前最大的可维护性负债。

## 目标

按"门面 + 策略模块"模式拆分 6 个 god class，每个策略文件 ≤500 行、每个门面 ≤450 行，保持公共 API 完全向后兼容。

## 约束

- **纯拆分**：不改公共 API、不提取 `getActivePage`、不重组目录结构、不处理 logger 耦合等相邻问题
- **门面 + 策略**：原类保留为瘦门面，私有逻辑提取到同目录下独立文件作为 collaborator
- **每类独立提交**：可独立回退，按依赖与风险递进顺序执行
- **向后兼容**：所有调用方代码不动

## 策略选择

评估了 3 种执行方案：

| 方案 | 顺序 | 选择 |
|------|------|------|
| A. 风险递进 + 依赖优先 | CodeAnalyzer → PageController → DebuggerManager → AdvancedDeobfuscator → WasmCollector → CodeCollector | **采用** |
| B. 价值优先 | 最大文件先拆，收益前置但风险高 | 第一刀啃最硬骨头，模式未验证 |
| C. 模块域分组 | 按 analyzer/collector/debugger/deobfuscator 分组提交 | 回退粒度粗，与上一轮节奏不一致 |

方案 A 与上一轮"自底向上、风险递进"策略一致，PageController 在 WasmCollector 之前（依赖关系），最复杂的 CodeCollector 留到最后。

---

## Phase 1：CodeAnalyzer.ts 拆分

### 现状

文件：`src/modules/analyzer/CodeAnalyzer.ts`（747 行）

已拆出 3 个兄弟文件（`CodeAnalyzerDataFlow.ts`、`SecurityCodeAnalyzer.ts`、`QualityAnalyzer.ts`），但本体仍含 5 个私有 AST 分析方法。

### 拆分方案

| 目标文件 | 提取内容 | 预估行数 |
|---|---|---|
| `src/modules/analyzer/CodeAnalyzerStructure.ts` | `analyzeStructure`、`analyzeModules`、`buildCallGraph`、`calculateComplexity` —— 提取为纯函数，接受 `ast` 参数 | ~250 |
| 保留 `src/modules/analyzer/CodeAnalyzer.ts` | `understand`（入口）、`aiAnalyze`、`detectTechStack`、`extractBusinessLogic`、`parseCodeAst`、`stripHtmlWrappers` | ~400 |

**理由**：4 个结构分析方法是纯 AST 遍历，无 AI 依赖，天然可提取为独立函数集合。`parseCodeAst` 带 lastParseResult 缓存，与入口强相关，保留在门面。

### 涉及文件

- 新建：`src/modules/analyzer/CodeAnalyzerStructure.ts`
- 新建：`tests/unit/modules/CodeAnalyzerStructure.test.ts`
- 修改：`src/modules/analyzer/CodeAnalyzer.ts` —— 移除 4 个方法，改为调用新模块
- 修改：`src/modules/analyzer/index.ts` —— 如有 re-export 需求

### 验收标准

- [ ] `CodeAnalyzer.ts` ≤ 450 行
- [ ] `CodeAnalyzerStructure.ts` ≤ 500 行
- [ ] `CodeAnalyzer` 公共 API（`understand` 等）签名不变
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归
- [ ] 新增 `CodeAnalyzerStructure` 单元测试覆盖 AST 遍历分支

### 风险

- **低**：提取的是纯函数，无状态依赖
- **回退**：`git revert`

---

## Phase 2：PageController.ts 拆分

### 现状

文件：`src/modules/collector/PageController.ts`（993 行）

43 个薄封装方法，按 Playwright 操作域分组。`WasmCollector` 依赖此类，故先拆。

### 拆分方案

| 目标文件 | 提取方法 | 预估行数 |
|---|---|---|
| `src/modules/collector/PageNavigation.ts` | `navigate`、`reload`、`goBack`、`goForward`、`waitForNavigation` —— 提取为接受 `Page` 参数的纯函数 | ~180 |
| `src/modules/collector/PageInteraction.ts` | `click`、`clickAt`、`setFiles`、`type`、`select`、`hover`、`scroll`、`scrollBy`、`waitForSelector` | ~300 |
| `src/modules/collector/PageInfo.ts` | `getURL`、`getTitle`、`getContent`、`screenshot`、`evaluate`、storage 相关方法 | ~250 |
| 保留 `src/modules/collector/PageController.ts` | 构造、`pageResolver` 委托、对各策略模块的薄分发 | ~250 |

**理由**：方法已是薄封装，提取为纯函数后门面仅做一行委托。保持 PageController 的公共方法签名不变，WasmCollector 等调用方无需改动。

### 涉及文件

- 新建：`src/modules/collector/PageNavigation.ts`、`PageInteraction.ts`、`PageInfo.ts`
- 新建：对应 3 个单元测试文件
- 修改：`src/modules/collector/PageController.ts` —— 改为门面委托

### 验收标准

- [ ] `PageController.ts` ≤ 300 行
- [ ] 每个策略文件 ≤ 500 行
- [ ] PageController 公共方法签名不变
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归
- [ ] WasmCollector 无需同步改动

### 风险

- **低-中**：方法多但都是薄封装，提取直接
- **回退**：`git revert`

---

## Phase 3：DebuggerManager.ts 拆分

### 现状

文件：`src/modules/debugger/DebuggerManager.ts`（1019 行）

已有 4 个 sub-manager（Watch/XHR/Event/Blackbox），但断点管理和执行控制仍在本体。

### 拆分方案

| 目标文件 | 提取方法 + 状态 | 预估行数 |
|---|---|---|
| `src/modules/debugger/BreakpointManager.ts` | `setBreakpointByUrl`、`setBreakpoint`、`removeBreakpoint`、`listBreakpoints`、`getBreakpoint`、`clearAllBreakpoints`、`setPauseOnExceptions` + `breakpoints` Map + `breakpointResolvedListener` | ~350 |
| `src/modules/debugger/ExecutionController.ts` | `pause`、`resume`、`stepInto`、`stepOver`、`stepOut` + `pausedState`、`pausedResolvers`、`pausedListener`、`resumedListener` | ~300 |
| 保留 `src/modules/debugger/DebuggerManager.ts` | CDP session 管理（`init`/`enable`/`disable`/`requireSession`/`getCDPSession`）、sub-manager 访问器、事件分发协调 | ~350 |

**理由**：断点管理和执行控制是两个独立 CDP 子域，各有独立状态。提取后 DebuggerManager 聚焦 session 生命周期与 sub-manager 编排。sub-manager 的访问器方法（`getWatchManager` 等）保留在门面。

### 涉及文件

- 新建：`src/modules/debugger/BreakpointManager.ts`、`ExecutionController.ts`
- 新建：对应 2 个单元测试文件
- 修改：`src/modules/debugger/DebuggerManager.ts` —— 移除断点与执行方法，委托给新类
- 修改：`src/modules/debugger/index.ts` —— 如有 re-export 需求

### 验收标准

- [ ] `DebuggerManager.ts` ≤ 450 行
- [ ] 每个策略文件 ≤ 500 行
- [ ] DebuggerManager 公共 API 不变
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归

### 风险

- **中**：断点和执行控制有 CDP 事件监听器交互，需确保监听器注册/解绑正确迁移
- **回退**：`git revert`

---

## Phase 4：AdvancedDeobfuscator.ts 拆分

### 现状

文件：`src/modules/deobfuscator/AdvancedDeobfuscator.ts`（1463 行）

7 种混淆技术，每种有 detect + decode/deobfuscate 方法对。VM 保护最大（含 5 个子方法）。

### 拆分方案

| 目标文件 | 提取方法 | 预估行数 |
|---|---|---|
| `src/modules/deobfuscator/InvisibleUnicodeDeobfuscator.ts` | `detectInvisibleUnicode`、`decodeInvisibleUnicode` | ~120 |
| `src/modules/deobfuscator/VMProtectionDeobfuscator.ts` | `detectVMProtection`、`countVMInstructions`、`deobfuscateVM`、`analyzeVMStructure`、`extractVMComponents`、`buildVMDeobfuscationPrompt`、`simplifyVMCode` | ~450 |
| `src/modules/deobfuscator/ControlFlowDeobfuscator.ts` | `detectControlFlowFlattening` + 对应 deobfuscate 方法 | ~150 |
| `src/modules/deobfuscator/StringArrayDeobfuscator.ts` | `detectStringArrayRotation` + 对应 deobfuscate 方法 | ~150 |
| `src/modules/deobfuscator/DeadCodeDeobfuscator.ts` | `detectDeadCodeInjection` + 对应 deobfuscate 方法 | ~120 |
| `src/modules/deobfuscator/OpaquePredicateDeobfuscator.ts` | `detectOpaquePredicates` + 对应 deobfuscate 方法 | ~120 |
| 保留 `src/modules/deobfuscator/AdvancedDeobfuscator.ts` | `deobfuscate`（入口编排）、`extractCodeFromLLMResponse`、`isValidJavaScript`、LLM 辅助调用 | ~350 |

**理由**：与上一轮 `Deobfuscator.ts` 拆分完全同构——按混淆技术切分，每技术独立文件。VM 保护最大（~450 行），若实施时发现超 500 行，可在该 Phase 内进一步拆 `analyzeVMStructure` + `extractVMComponents` 到 `VMStructureAnalyzer.ts`。

### 涉及文件

- 新建：6 个策略文件
- 新建：对应单元测试文件
- 修改：`src/modules/deobfuscator/AdvancedDeobfuscator.ts` —— 精简为门面
- 修改：`src/modules/deobfuscator/index.ts` —— 更新 re-export

### 验收标准

- [ ] `AdvancedDeobfuscator.ts` ≤ 450 行
- [ ] 每个策略文件 ≤ 500 行
- [ ] AdvancedDeobfuscator 公共 API（`deobfuscate`）签名不变
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归
- [ ] 每个技术策略文件有对应单元测试

### 风险

- **中**：VM 保护逻辑复杂，LLM 辅助调用需正确传递
- **回退**：`git revert`

---

## Phase 5：WasmCollector.ts 拆分

### 现状

文件：`src/modules/wasm/WasmCollector.ts`（1477 行）

`buildPreloadScript`（566–1060+ 行）是巨型模板字面量，占文件过半。依赖 `PageController`（Phase 2 已拆）。

### 拆分方案

| 目标文件 | 提取内容 | 预估行数 |
|---|---|---|
| `src/modules/wasm/WasmPreloadScript.ts` | `buildPreloadScript` 的完整模板字面量 + 相关纯辅助函数（`normalizeSource`、`trackBuffer`、`recordEvent` 等） | ~500 |
| `src/modules/wasm/WasmArtifactStore.ts` | `persistArtifacts`、`applyExportCallCounts` + artifact 路径管理 | ~200 |
| `src/modules/wasm/WasmBinaryRegistry.ts` | `modulesById`/`moduleIdsByHash`/`bytesByModuleId` Map + `registerBinary`、`getModules`、`getModuleById`、`getModuleBytes` | ~250 |
| 保留 `src/modules/wasm/WasmCollector.ts` | `collect`（协调）、`captureNetworkResponse`、`readRuntimeCaptureState`、`getRuntimeEvents` | ~400 |

**理由**：preload script 是纯字符串生成，与收集逻辑无关；binary registry 是独立状态管理；artifact 持久化是 IO 操作。三者分离后 WasmCollector 聚焦收集协调。

### 涉及文件

- 新建：3 个策略文件
- 新建：对应单元测试文件
- 修改：`src/modules/wasm/WasmCollector.ts` —— 改为门面协调

### 验收标准

- [ ] `WasmCollector.ts` ≤ 450 行
- [ ] 每个策略文件 ≤ 500 行
- [ ] WasmCollector 公共 API 不变
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归

### 风险

- **中**：preload script 的模板字面量提取需确保字符串内容完全一致（无转义问题）
- **回退**：`git revert`

---

## Phase 6：CodeCollector.ts 拆分

### 现状

文件：`src/modules/collector/CodeCollector.ts`（1547 行）

最大最复杂。`collect` 方法 386 行，CDP 监听、缓存、文件注册混在一起。`getActivePage` 被 55 处外部调用（本 spec 不提取，尊重"纯拆分"边界）。

### 拆分方案

| 目标文件 | 提取方法 + 状态 | 预估行数 |
|---|---|---|
| `src/modules/collector/CollectedFileRegistry.ts` | `collectedFilesCache`、`collectedUrls`、`buildFileMetadata`、`hasReachedFileLimit`、`evictOldestFileIfNeeded`、`cleanupCollectedUrls`、`clearFileCache`、`getFileCacheStats` | ~300 |
| `src/modules/collector/CdpNetworkMonitor.ts` | `cdpSession`、`cdpListeners`、CDP 事件绑定/解绑、网络响应抓取相关逻辑 | ~350 |
| `src/modules/collector/DynamicScriptWatcher.ts` | `waitForDynamicScripts`、网络空闲等待逻辑 | ~150 |
| 保留 `src/modules/collector/CodeCollector.ts` | `collect`（解构为编排方法）、`init`/`close`、`getActivePage`、`setPageResolver`、`getAllStats`、`getCache`/`getCompressor` | ~450 |

### `collect` 方法解构

当前 `collect` 方法 386 行，拆为 4 个阶段调用，每个阶段 ≤100 行，作为 CodeCollector 的私有方法（需访问 `CollectedFileRegistry` 和 `CdpNetworkMonitor`，故保留在门面上，各阶段内部委托策略模块）：

- `collectInlineScripts` —— 收集内联脚本，委托 `CollectedFileRegistry` 注册
- `collectExternalScripts` —— 收集外部脚本文件，委托 `CdpNetworkMonitor` 抓取
- `collectDynamicScripts` —— 委托 `DynamicScriptWatcher` 等待并收集动态脚本
- `collectWorkers` —— 收集 Service Worker / Web Worker

`collect` 方法本身变为阶段编排：参数校验 → 各阶段调用 → 结果合并。

**理由**：尊重"纯拆分"边界——`getActivePage` 不动，只拆内部职责。文件注册和 CDP 监听是独立状态域。`collect` 解构是使门面行数达标（≤450）的必要操作。

### 涉及文件

- 新建：3 个策略文件
- 新建：对应单元测试文件
- 修改：`src/modules/collector/CodeCollector.ts` —— 移除策略方法，解构 `collect`
- 修改：`src/modules/collector/index.ts` —— 如有 re-export 需求

### 验收标准

- [ ] `CodeCollector.ts` ≤ 450 行
- [ ] 每个策略文件 ≤ 500 行
- [ ] `collect` 方法 ≤ 100 行（编排逻辑）
- [ ] CodeCollector 公共 API 不变（含 `getActivePage`）
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归
- [ ] 新增策略模块单元测试

### 风险

- **中-高**：`collect` 方法解构涉及控制流重组，需确保收集顺序与错误处理不变
- **回退**：`git revert`

---

## 实施顺序总览

| Phase | 目标文件 | 当前行数 | 策略文件数 | 风险 | 依赖 |
|-------|---------|---------|-----------|------|------|
| 1 | CodeAnalyzer.ts | 747 | 1 | 低 | 无 |
| 2 | PageController.ts | 993 | 3 | 低-中 | 无 |
| 3 | DebuggerManager.ts | 1019 | 2 | 中 | 无 |
| 4 | AdvancedDeobfuscator.ts | 1463 | 6 | 中 | 无 |
| 5 | WasmCollector.ts | 1477 | 3 | 中 | Phase 2（PageController） |
| 6 | CodeCollector.ts | 1547 | 3 | 中-高 | 无 |

顺序：1 → 2 → 3 → 4 → 5 → 6。Phase 5 依赖 Phase 2（WasmCollector 使用 PageController）。每个 Phase 独立 commit。

## 成功标准

- [ ] 6 个 god class 均拆分到 ≤450 行
- [ ] 16 个策略文件均 ≤500 行
- [ ] 所有公共 API 签名不变，调用方代码零改动
- [ ] `npm run typecheck` 通过
- [ ] `npm run test:unit` 全部通过，无回归
- [ ] 每个策略文件有对应单元测试
- [ ] GitNexus 重分析后 6 个原 god class 的方法数显著下降
