# JSReverser-CLI 四方向修复设计

日期：2026-06-18
状态：Draft
来源：graphify 知识图谱分析（235 节点、314 边、18 社区）

## 背景

graphify 对当前项目做了全量扫描，发现 4 类问题：

1. **P0 工具崩溃**：`collect_code` 和 `search_in_scripts` 在 collector 未就绪时抛原始异常
2. **P0 Hook 注入缺陷**：`inject_hook` 没有区分执行上下文（content-script vs main world），persistent hook 跨导航丢失
3. **P1 工作流定义冗余**：6 阶段工作流在 3 个文档里各自定义，存在不一致
4. **P2 文档盲区**：84 个组件节点只有 ≤1 条文档连接

本次修复分 4 个 Phase，按优先级递降实施。

---

## Phase 1：工具崩溃修复（P0）

### 问题描述

`collect_code` 崩溃信息：`Cannot read properties of undefined (reading 'collect')`
`search_in_scripts` 崩溃信息：`Cannot read properties of undefined (reading 'getFilesByPattern')`

根因：`CodeCollector` 的 `collect()` 和 `getFilesByPattern()` 在 `pageResolver` 未绑定（即没有选中页面）时，内部访问 `page.url` 或 CDP session 抛出原始 `TypeError`。工具层虽然 catch 了，但返回的是不可诊断的原始错误。

### 修复方案

**双层防御：模块层 + 工具层。**

#### 1.1 模块层：CodeCollector 内部防御

文件：`src/modules/collector/CodeCollector.ts`

在 `collect()` 方法入口添加 pageResolver 就绪检查：

```typescript
async collect(options: CollectCodeOptions): Promise<CollectCodeResult> {
  const page = this.pageResolver?.();
  if (!page) {
    return {
      files: [],
      totalSize: 0,
      error: 'NO_PAGE_CONTEXT',
      message: '页面上下文未就绪。请先调用 select_page 或 new_page 选择一个页面。',
    };
  }
  // ... existing logic
}
```

在 `getFilesByPattern()` 方法入口添加缓存就绪检查：

```typescript
getFilesByPattern(pattern: string, limit?: number, maxTotalSize?: number) {
  if (this.collectedFilesCache.size === 0 && this.cache.isEmpty()) {
    return {
      files: [],
      totalSize: 0,
      matched: 0,
      returned: 0,
      truncated: false,
      warning: '脚本缓存为空。请先调用 collect_code 收集脚本后再搜索。',
    };
  }
  // ... existing logic with try-catch around RegExp construction
  try {
    const regex = new RegExp(pattern);
    // ... existing search
  } catch (e) {
    return {
      files: [],
      totalSize: 0,
      matched: 0,
      returned: 0,
      truncated: false,
      error: 'INVALID_PATTERN',
      message: `无效的正则表达式: ${pattern}`,
    };
  }
}
```

#### 1.2 工具层：结构化错误响应

文件：`src/tools/collector/collectCode.ts` 和 `src/tools/collector/searchInScripts.ts`

在 catch 块中区分错误类型，给出可操作的建议：

```typescript
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const isNoPage = errorMsg.includes('NO_PAGE_CONTEXT') || errorMsg.includes('pageResolver');
  const suggestion = isNoPage
    ? '请先调用 select_page 或 new_page 选择目标页面，然后重试。'
    : '请检查浏览器连接状态（调用 check_browser_health）后重试。';

  response.setStructuredContent({
    success: false,
    message: `代码收集失败：${errorMsg}`,
    suggestion,
    tooltype: 'collect_code',
    data: {},
  });
}
```

### 涉及文件

- `src/modules/collector/CodeCollector.ts` — 添加前置检查
- `src/tools/collector/collectCode.ts` — 改进错误响应
- `src/tools/collector/searchInScripts.ts` — 改进错误响应
- `src/modules/collector/types.ts` — 如有需要添加 error 字段到返回类型

### 验收标准

- [ ] 未选页面时调用 `collect_code` 返回 `success: false` + 明确建议，不抛原始异常
- [ ] 脚本缓存为空时调用 `search_in_scripts` 返回空结果 + warning，不崩溃
- [ ] 正则表达式语法错误时返回 `INVALID_PATTERN` 错误，不抛 `SyntaxError`
- [ ] 正常页面上两个工具行为不变
- [ ] 对应单元测试覆盖上述 3 个边界场景

---

## Phase 2：Hook 注入执行上下文修复（P0）

### 问题描述

当前 `inject_hook` 只用 `frame.evaluate(script)` 注入，运行在 frame 的默认执行上下文。问题：

1. **无 world 选择**：无法指定 hook 运行在 main world 还是 isolated world
2. **持久化跨导航丢失**：`persistent=true` 使用 `page.addInitScript()` 注册，但只在 main world 生效。如果页面有 content-script 隔离策略，hook 可能在新 document 里丢上下文
3. **状态报告缺失**：注入成功后没有反馈 hook 实际运行在哪个 world

### 修复方案

#### 2.1 添加 world 参数

文件：`src/tools/hook/InjectHook.ts`

在 schema 中新增 `world` 参数：

```typescript
schema: {
  hookId: zod.string(),
  script: zod.string(),
  persistent: zod.boolean().optional(),
  world: zod.enum(['main', 'isolated']).optional().describe(
    '执行上下文。main（默认）= 页面 JS 可直接访问的上下文；isolated = 隔离上下文，' +
    '适合不需要访问页面变量的监控 hook。'
  ),
},
```

handler 中根据 world 参数选择注入方式：

```typescript
const world = request.params.world ?? 'main';

if (world === 'isolated') {
  // 当前代码库无 isolated world 评估能力，需新增。
  // 方案 A：通过 CDP Page.createIsolatedWorld + Runtime.evaluate
  // 方案 B：通过 Playwright frame.evaluate 的 world option（若版本支持）
  // 建议先用 CDP 方案，因为 CDP session 已在 DebuggerContext 中管理。
  const isolatedContext = await createIsolatedWorldContext(frame);
  await isolatedContext.evaluate(script);
} else {
  await frame.evaluate(script);
}
```

#### 2.2 修复持久化跨导航

对 `persistent=true` 的 hook，除了 `addInitScript`，还需在导航事件中重新挂载：

```typescript
if (persistent) {
  // 1. addInitScript 确保新 document 自动挂载
  await addInit.call(selectedPage, script);

  // 2. 监听 framenavigated 事件，验证 hook 是否仍在
  selectedPage.on('framenavigated', async (frame: Frame) => {
    if (frame === selectedPage.mainFrame()) {
      // 检查 hook 是否存在，不存在则重新注入
      const exists = await frame
        .evaluate(
          `(hookId) => typeof window.__hookStore !== 'undefined'`,
          hookId,
        )
        .catch(() => false);
      if (!exists) {
        await frame.evaluate(script).catch(() => {});
      }
    }
  });

  persistentHookRegistry.set(hookId, {
    script,
    registeredAt: Date.now(),
    world,
  });
}
```

#### 2.3 返回结构化状态

响应中添加 world 信息和持久化状态：

```typescript
response.setStructuredContent({
  success: true,
  message: `Hook ${hookId} injected (${world} world${result.persisted ? ', persistent' : ''})`,
  tooltype: 'inject_hook',
  data: {
    ...result,
    world,
    persistentStrategy: result.persisted
      ? 'addInitScript + framenavigated'
      : 'evaluate-once',
  },
});
```

### 涉及文件

- `src/tools/hook/InjectHook.ts` — 添加 world 参数 + 修复持久化
- `src/tools/hook/types.ts` — 更新类型定义
- `src/worker/ToolAdapter.ts` — 如有 isolated world 评估能力需要对接

### 验收标准

- [ ] `inject_hook` 支持 `world: 'main' | 'isolated'` 参数
- [ ] `persistent=true` 的 hook 在页面导航后仍然生效（通过 framenavigated 重挂载验证）
- [ ] 返回值包含 `world` 和 `persistentStrategy` 字段
- [ ] 向后兼容：不传 world 时默认 `main`，行为与当前一致
- [ ] 对应单元测试覆盖 world 选择和持久化验证

---

## Phase 3：工作流定义统一（P1）

### 问题描述

当前 6 阶段逆向工作流在多处定义：

| 文件                                                        | 定义                                                                  | 角色                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `docs/reference/reverse-workflow.md`                        | 6 阶段（Observe → Capture → Rebuild → Patch → PureExtraction → Port） | 模型执行协议，最详细           |
| `docs/guides/full-usage-guide.md` §7                        | 6 阶段（同上）                                                        | 人类使用指南，有额外示例       |
| `skills/jsreverser-playbook/references/automation-entry.md` | 3 阶段（观察 → 采样 → 补环境）                                        | 自动化入口简化版               |
| `agent/crawler-reverse-agent.md`                            | 8 步操作序列（Step 0-7）                                              | Agent 操作手册，不是工作流定义 |

不一致点：

- `full-usage-guide.md` §7 重复了 `reverse-workflow.md` 的全部内容但格式不同
- `automation-entry.md` 的 3 阶段与 6 阶段的映射关系未声明
- `crawler-reverse-agent.md` 的 8 步看起来是独立的操作序列，但与 6 阶段的对应关系不明确

### 修复方案

**以 `reverse-workflow.md` 的 6 阶段为唯一权威定义。**

#### 3.1 full-usage-guide.md §7 改为引用

删除 §7.2 阶段详解的重复内容，改为：

```markdown
## 7. 完整逆向工作流

### 7.1 阶段总览

1. Observe（观察）
2. Capture（采样）
3. Rebuild（复现）
4. Patch（补环境）
5. PureExtraction（纯算法提纯）
6. Port（迁移）

详细的阶段定义、完成判据和禁止事项，见 [Reverse Workflow 协议](../reference/reverse-workflow.md)。

### 7.2 快速参考（从完整协议精简）

[保留精简版的表格或要点，但标注 "完整定义见 reverse-workflow.md"]
```

#### 3.2 automation-entry.md 添加映射声明

在文件开头添加：

```markdown
> 这是 [6 阶段逆向工作流](../../docs/reference/reverse-workflow.md) 的自动化简化版。
> 3 阶段映射：观察 = Phase 1 Observe，采样 = Phase 2 Capture，补环境 = Phase 3-4 Rebuild+Patch。
```

#### 3.3 crawler-reverse-agent.md 添加映射

在 Step 描述中添加与 6 阶段的对应关系注释：

```markdown
<!-- 对应 reverse-workflow.md Phase 1: Observe -->

**Step 1：目标侦察**
...

<!-- 对应 reverse-workflow.md Phase 2: Capture -->

**Step 3：Hook 与采样**
...
```

### 涉及文件

- `docs/reference/reverse-workflow.md` — 不变（已是权威源）
- `docs/guides/full-usage-guide.md` — §7 精简为引用
- `skills/jsreverser-playbook/references/automation-entry.md` — 添加映射声明
- `agent/crawler-reverse-agent.md` — 添加阶段映射注释

### 验收标准

- [ ] `reverse-workflow.md` 是 6 阶段工作流的唯一完整定义
- [ ] 其他文档通过引用或映射指向它，不再重复定义
- [ ] 搜索 "Observe" "Capture" "Rebuild" 时不会找到多处矛盾定义

---

## Phase 4：高价值孤立节点文档补全（P2）

### 问题描述

知识图谱发现 84 个节点只有 ≤1 条连接。这些组件在代码中有关联（import、调用、数据流），但文档没有反映。优先处理 15-20 个高价值节点。

### 高价值节点清单

以下节点按影响面（被引用次数 × 功能重要性）排序：

| 节点                  | 源文件                                      | 当前状态 | 应连接目标                                                        |
| --------------------- | ------------------------------------------- | -------- | ----------------------------------------------------------------- |
| EventBus              | `src/utils/EventBus.ts`                     | 0 连接   | RuntimeServices, HookManager, ConsoleServer                       |
| ToolAdapter           | `src/worker/ToolAdapter.ts`                 | 0 连接   | ToolExecutionPipeline, ToolContext, 所有工具定义                  |
| StealthScripts2025    | `src/modules/stealth/StealthScripts2025.ts` | 0 连接   | Anti-Detection Layering System, CloakBrowser, BrowserManager      |
| MINIMAL_STEALTH_ARGS  | `src/browser/stealth-args.ts`               | 0 连接   | BrowserManager, Anti-Detection Layering System, stealth-args 文档 |
| AI Service Layer      | `src/services/AIService.ts`                 | 0 连接   | LLMService, AnthropicProvider, GeminiProvider, OpenAIProvider     |
| RuntimeServices       | `src/runtime/RuntimeServices.ts`            | 0 连接   | Runtime (runtime.ts), 所有 lazy 加载的服务                        |
| BrowserManager        | `src/browser/browser.ts`                    | 1 连接   | SessionManager, CloakBrowser, 所有需要浏览器的工具                |
| HookStore             | `src/modules/hook/HookStore.ts`             | 0 连接   | HookManager, ConsoleServer, InjectHook                            |
| CodeCache             | `src/modules/collector/CodeCache.ts`        | 0 连接   | CodeCollector, SmartCodeCollector, UnifiedCacheManager            |
| PageController        | `src/modules/collector/PageController.ts`   | 0 连接   | RuntimeServices, CodeCollector, DOMInspector                      |
| ReverseTaskStore      | `src/reverse/ReverseTaskStore.ts`           | 0 连接   | 所有 reverse task 工具, Runtime                                   |
| WsHub                 | `src/web/ws/WsHub.ts`                       | 0 连接   | ConsoleServer, RestRouter, 所有 WebSocket 工具                    |
| ToolRegistry          | `src/tools/registry/ToolRegistry.ts`        | 0 连接   | 所有工具定义, ToolDefinition, CLI 工具分发                        |
| ToolExecutionPipeline | `src/worker/ToolExecutionPipeline.ts`       | 0 连接   | ToolAdapter, ToolContext, ToolResponse                            |
| HookCodeBuilder       | `src/modules/hook/HookCodeBuilder.ts`       | 0 连接   | HookManager, HookTypeRegistry, create_hook 工具                   |

### 补全策略

**对每个高价值节点：**

1. **在源文件 JSDoc 中添加 `@see` 交叉引用**（指向关键关联组件）
2. **在 `docs/reference/` 或 `skills/jsreverser-playbook/references/` 中的现有文档添加链接**
3. **不创建新文档文件** — 只补连接，不补独立页面

具体操作：

- 在每个源文件的模块级 JSDoc 中，添加 `@see` 标签列出关键依赖方
- 在 `AGENTS.md` 的 Architecture Notes 中添加这些组件的一句话描述和文件路径
- 在 `tool-reference.md` 中为工具注册链路添加一段说明

### 涉及文件

- 15 个源文件的 JSDoc 注释
- `AGENTS.md` — Architecture Notes 补全
- `docs/reference/tool-reference.md` — 工具注册链路说明
- `docs/reference/reverse-workflow.md` — 补全与 Runtime 组件的关联

### 验收标准

- [ ] 15 个高价值节点每个至少有 2 条文档交叉引用
- [ ] `AGENTS.md` Architecture Notes 覆盖所有核心运行时组件
- [ ] graphify `--update` 后孤立节点数量从 84 降低到 ≤60

---

## 实施顺序

| Phase            | 类型 | 预估工作量     | 风险                                    |
| ---------------- | ---- | -------------- | --------------------------------------- |
| 1. 工具崩溃修复  | 代码 | 小（4 文件）   | 低 — 纯防御性添加                       |
| 2. Hook 注入修复 | 代码 | 中（3 文件）   | 中 — persistent hook 重挂载需要集成测试 |
| 3. 工作流统一    | 文档 | 小（4 文件）   | 低 — 只改文档不改行为                   |
| 4. 孤立节点补全  | 文档 | 中（~20 文件） | 低 — 只加注释和链接                     |

建议按 1 → 2 → 3 → 4 顺序实施。Phase 1 和 2 可以独立合并；Phase 3 和 4 可合并为一个 PR。
