# Context 级持久 Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `inject_hook(persistent=true)` 与 `inject_preload_script` 收敛到同一个 BrowserContext 级注册表，使现有 Frame 尽力即时生效、未来导航和新页面自动继承，并让幂等、冲突、生命周期和不可删除语义与真实浏览器状态一致。

**Architecture:** 新建 `PersistentHookRegistry` 深模块，由共享 `HookManager` 唯一持有；注册表以 `WeakMap<BrowserContext, Map<hookId, entry>>` 隔离状态，先调用原生 `BrowserContext.addInitScript()`，成功后登记，再按模式回填当前 Frame。三个工具只做参数转换和结果格式化，不再各自维护 Map 或 Page fallback。

**Tech Stack:** TypeScript ESM、Patchright `BrowserContext`/`Page`/`Frame`、Node.js `crypto`/`node:test`、Zod。

## Global Constraints

- 本计划是三阶段交付的第 3 阶段；开始前必须完成 [Target 级脚本观测计划](./2026-08-12-target-script-observation.md) 和 [稳定 pageId 计划](./2026-08-12-stable-page-id.md) 的完成门槛。
- 规范来源是 [浏览器运行时基础能力设计](../specs/2026-08-12-browser-runtime-foundations-design.md)。
- 持久 Hook 的唯一生命周期是当前 `BrowserContext`：不跨 Context、不跨 worker 进程、不注入 Worker Target。
- 不提供运行时单条删除或覆盖。相同 ID 不同脚本必须拒绝；清除方式只能是关闭或重建 Context。
- `persistent=false` 保持只 evaluate 当前选中 Frame 的旧行为。
- `persistent=true` 要求真实 BrowserContext；`addInitScript` 失败时整个注册失败，不降级成单次 evaluate。
- `inject_preload_script` 只接受 BrowserContext，使用 `future-only`；不再回退到 selected Page。
- `world='isolated'` 继续被 schema 接受，但真实执行 world 是 `main`，响应必须明确 warning。
- 注册表不保存完整脚本副本，只保存 SHA-256、UTF-8 字节数和最多 200 个字符的 preview。
- 不额外包裹用户脚本，不注入全局幂等标记；持久脚本本身必须能承受导航竞态下极小概率的重复执行。
- 不新增 timer、debounce、导航 heartbeat、自动 attach 或依赖。
- 删除 `HookHeartbeat` 前必须以最终源码再次确认生产调用方为零。
- 工作区已有用户改动。每次提交只暂存本计划列出的文件，不格式化、还原或提交无关文件。

---

## File Map

### 新建源码

- `src/modules/hook/PersistentHookRegistry.ts`：Context 级注册、幂等冲突、close cleanup、Frame 回填与只读列表。

### 新建测试

- `tests/unit/modules/hook/PersistentHookRegistry.test.ts`
- `tests/integration/persistentHooks.integration.test.ts`

### 修改现有源码

- `src/modules/hook/HookManager.ts`：持有并暴露唯一 `PersistentHookRegistry`。
- `src/modules/hook/index.ts`：导出 registry 公共类型与 preload ID helper。
- `src/worker/ToolContext.ts`：暴露共享 registry getter。
- `src/tools/ToolDefinition.ts`：内部 Context 增加 BrowserContext 与 registry getter。
- `src/worker/DefineToolContextFactory.ts`：映射上述方法。
- `src/tools/hook/InjectHook.ts`：移除模块级 Map，persistent 分支委托 registry；list 按当前 Context 查询。
- `src/tools/hook/types.ts`：扩展请求结果字段，保留旧兼容字段。
- `src/tools/script/script.ts`：`inject_preload_script` 委托同一 registry，不再 Context/Page fallback。

### 修改现有测试

- `tests/unit/tools/hook/InjectHook.test.ts`
- `tests/unit/tools/hook/InjectHook.world.test.ts`
- `tests/unit/tools/script-eval-callback.test.ts`
- `tests/unit/modules/HookManager.test.ts`

### 删除

- `src/modules/hook/HookHeartbeat.ts`
- `tests/unit/modules/HookHeartbeat.test.ts`

### 明确不改

- `HookStore`、`HookCodeBuilder`、`HookTypeRegistry` 的职责
- BrowserManager 启动路径
- Worker Target 注入
- 新增 `remove_persistent_hook` 工具
- `new_page.preloadHook` 的单 Page、goto 前注入语义

---

### Task 1: 用 TDD 建立 PersistentHookRegistry 深模块

**Files:**

- Create: `src/modules/hook/PersistentHookRegistry.ts`
- Create: `tests/unit/modules/hook/PersistentHookRegistry.test.ts`

**Interfaces:**

```typescript
export interface PersistentHookEntry {
  hookId: string;
  scriptHash: string;
  scriptSize: number;
  scriptPreview: string;
  registeredAt: number;
  source: 'inject_hook' | 'inject_preload_script';
  requestedWorld: 'main' | 'isolated';
  effectiveWorld: 'main';
  applyMode: 'existing-and-future' | 'future-only';
}

export interface RegisterPersistentHookRequest {
  context: BrowserContext;
  hookId: string;
  script: string;
  source: PersistentHookEntry['source'];
  requestedWorld: PersistentHookEntry['requestedWorld'];
  applyMode: PersistentHookEntry['applyMode'];
}

export interface RegisterPersistentHookResult {
  entry: PersistentHookEntry;
  registered: boolean;
  idempotent: boolean;
  appliedFrames: number;
  failedFrames: Array<{
    frameUrl: string;
    reason: string;
  }>;
  partial: boolean;
  warnings: string[];
}

export function hashPersistentHookScript(script: string): string;
export function createPreloadHookId(script: string): string;

export class PersistentHookRegistry {
  register(
    request: RegisterPersistentHookRequest,
  ): Promise<RegisterPersistentHookResult>;
  list(context: BrowserContext): PersistentHookEntry[];
}
```

- [ ] **Step 1: 建立可控 Context/Page/Frame fake**

fake Context 必须支持：

- `isClosed()` 可切换。
- `once('close', listener)` 保存 listener。
- `addInitScript(script)` 记录调用或注入错误，并返回可调用 `dispose()` 的 fake Disposable；
  测试失败回滚和 Context close 清理时可验证句柄不会暴露给工具响应。
- `pages()` 返回 Page snapshot。
- `closeForTest()` 触发 close listener。

fake Page 支持 `isClosed()`、`frames()`；fake Frame 支持 `url()`、`evaluate(script)`。所有动作写入一个 `events: string[]`，用于断言注册顺序。

- [ ] **Step 2: 先写注册时序和 apply mode 失败测试**

覆盖：

- `existing-and-future` 的第一个事件是 `context:addInitScript`，之后才出现任何 `frame:evaluate`。
- 多 Page、多 Frame 全部回填并统计 `appliedFrames`。
- 已关闭 Page 不进入回填 snapshot。
- 单 Frame evaluate 失败不回滚 init script，返回 `partial=true` 与精确 frameUrl/reason。
- `future-only` 只调用 `addInitScript`，`appliedFrames=0`。
- `addInitScript` 失败时不登记、不回填、不返回成功。
- Context 已关闭时在 `addInitScript` 前失败。
- Context 在 addInit 成功后关闭时不遗留可见 entry，并返回可恢复连接错误。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/hook/PersistentHookRegistry.test.js
```

Expected: 编译失败，因为模块尚不存在。

- [ ] **Step 3: 实现无完整脚本副本的 entry**

hash 和 preload ID：

```typescript
export function hashPersistentHookScript(script: string): string {
  return createHash('sha256').update(script).digest('hex');
}

export function createPreloadHookId(script: string): string {
  return `preload-${hashPersistentHookScript(script)}`;
}
```

preview 按 Unicode code point 计算，最多 200 个字符；截断时使用 199 个字符加一个省略号，且不为长脚本构造完整字符数组：

```typescript
function createScriptPreview(script: string): string {
  const characters: string[] = [];
  for (const character of script) {
    if (characters.length === 200) {
      return `${characters.slice(0, 199).join('')}…`;
    }
    characters.push(character);
  }
  return characters.join('');
}
```

entry 的 `scriptSize` 使用 `Buffer.byteLength(script, 'utf8')`。Map 中不得出现 `script` 字段。

- [ ] **Step 4: 实现 Context 隔离和 close cleanup**

状态限定为：

```typescript
private readonly entriesByContext = new WeakMap<
  BrowserContext,
  Map<string, PersistentHookEntry>
>();
private readonly observedContexts = new WeakSet<BrowserContext>();
private readonly inFlightByContext = new WeakMap<
  BrowserContext,
  Map<string, {scriptHash: string; promise: Promise<RegisterPersistentHookResult>}>
>();
private readonly disposablesByContext = new WeakMap<
  BrowserContext,
  Map<string, {dispose(): Promise<void>}>
>();
```

首次看到 Context 时创建空 Map，并只注册一次；close 时先摘除 entries、in-flight reservation，
再 best-effort dispose 所有已返回的私有句柄（清理失败只记 warning，不阻止其他清理）：

```typescript
context.once('close', () => {
  this.entriesByContext.delete(context);
  this.inFlightByContext.delete(context);
  const handles = this.disposablesByContext.get(context);
  this.disposablesByContext.delete(context);
  void Promise.allSettled(
    [...(handles?.values() ?? [])].map(handle => handle.dispose()),
  );
});
```

`list(closedContext)` 返回空数组；`list` 返回 entry 浅拷贝，外部不得修改内部对象。

- [ ] **Step 5: 先写幂等、冲突与隔离失败测试**

覆盖：

- 同 Context、同 ID、同 hash：第二次 `registered=false`、`idempotent=true`，不重复 addInit 或 evaluate。
- 同 Context、同 ID、不同 hash：在 addInit 前抛 `VALIDATION`，提示新 hookId 或重建 Context。
- 不同 ID、相同脚本允许。
- 不同 Context、相同 ID 完全隔离。
- Context close 后 `list` 为空。
- close 后新 Context 可重新使用同 ID。
- `createPreloadHookId` 对相同脚本稳定，对不同脚本不同。
- requested isolated 的 entry 仍是 `effectiveWorld:'main'`，warnings 明确说明限制。
- emoji 等多字节脚本的 `scriptSize` 使用 UTF-8 字节数，preview 不超过 200 个 Unicode code point。
- entry 与 `list()` 结果都不存在完整 `script` 字段。
- 同 Context/同 hookId 的并发同脚本请求合并为一次 `addInitScript` 和一次回填；并发不同
  脚本在任何浏览器副作用前拒绝；首个注册失败后允许后续重试。

- [ ] **Step 6: 实现严格注册顺序和竞态检查**

`register` 顺序不可调整：

1. trim 校验 hookId 与 script 非空。
2. `context.isClosed()` 校验。
3. 计算 hash/entry 候选。
4. 获取当前 Context Map，并做幂等/冲突检查；同时以 `(context, hookId)` 保存 in-flight
   reservation。已有相同 hash 的 reservation 直接复用其 Promise，不重复副作用；已有不同
   hash 或 reservation 中 hash 不同则立即拒绝。
5. `await context.addInitScript(script)`，保存返回的 Disposable 句柄供 Context 清理（不暴露给工具）。
6. 若 await 返回时 Context 已关闭，立即 best-effort `dispose()` 该 late handle，再抛可恢复错误；
   否则把句柄放入 `disposablesByContext`，再检查 WeakMap 中仍是同一个 Map。
7. `entries.set(hookId, entry)`。
8. `future-only` 直接返回。
9. 对 `context.pages()` 的当前 snapshot，枚举未关闭 Page 的 Frame snapshot并逐个 best-effort evaluate。
10. 若 Context 在回填中关闭，抛可恢复错误；close listener 已确保 entry 不再可见。
11. finally 清理 reservation；失败时不得留下 entry 或不可见的 reservation。

不要并行 `Promise.all` 全部 Frame：顺序执行便于稳定汇报，Frame 数量来自用户显式 Context，首期不新增并发抽象。

- [ ] **Step 7: 运行 registry 测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/hook/PersistentHookRegistry.test.js
```

Expected: PASS。

- [ ] **Step 8: 提交 Task 1**

```powershell
git add src/modules/hook/PersistentHookRegistry.ts tests/unit/modules/hook/PersistentHookRegistry.test.ts
git commit -m "feat(hook): add context persistent hook registry"
```

---

### Task 2: 让 HookManager 和内部工具 Context 共享同一个 registry

**Files:**

- Modify: `src/modules/hook/HookManager.ts`
- Modify: `src/modules/hook/index.ts`
- Modify: `src/worker/ToolContext.ts`
- Modify: `src/tools/ToolDefinition.ts`
- Modify: `src/worker/DefineToolContextFactory.ts`
- Modify: `tests/unit/modules/HookManager.test.ts`

**Interfaces:**

- Adds: `HookManager.getPersistentHookRegistry()`。
- Adds: `ToolContextProvider.getPersistentHookRegistry()`。
- Adds internally to `Context`: `getBrowserContext()`、`getPersistentHookRegistry()`。

- [ ] **Step 1: 先写唯一所有者失败测试**

在 `HookManager.test.ts` 增加：

```typescript
it('returns one persistent registry per HookManager', () => {
  const manager = new HookManager();

  assert.equal(
    manager.getPersistentHookRegistry(),
    manager.getPersistentHookRegistry(),
  );
  assert.notEqual(
    manager.getPersistentHookRegistry(),
    new HookManager().getPersistentHookRegistry(),
  );
});
```

Expected: 编译失败，因为 getter 尚不存在。

- [ ] **Step 2: 在 HookManager 直接持有 registry**

增加：

```typescript
private readonly persistentHookRegistry = new PersistentHookRegistry();

getPersistentHookRegistry(): PersistentHookRegistry {
  return this.persistentHookRegistry;
}
```

不要把 registry 放入新的 Runtime 字段；现有共享 `runtime.hookManager` 已是正确所有者。

- [ ] **Step 3: 从 hook index 导出窄 API**

导出 `PersistentHookRegistry`、两个 helper 和三个 interface type（Entry/Request/Result）。不要导出内部 WeakMap 或任何 remove 方法。

- [ ] **Step 4: 给 ToolContextProvider 添加一行委托**

```typescript
getPersistentHookRegistry(): PersistentHookRegistry {
  return this.hookManager.getPersistentHookRegistry();
}
```

`getContext()` 已存在，继续作为 BrowserContext 的真实来源。

- [ ] **Step 5: 扩展工具 Context 与 factory**

`ToolDefinition.Context` 增加：

```typescript
getBrowserContext(): BrowserContext | null;
getPersistentHookRegistry(): PersistentHookRegistry;
```

factory 映射：

```typescript
getBrowserContext: () => provider.getContext(),
getPersistentHookRegistry: () => provider.getPersistentHookRegistry(),
```

不要让工具通过模块级 singleton 或重新 `new PersistentHookRegistry()`。

- [ ] **Step 6: 运行聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/HookManager.test.js build/tests/unit/worker/ToolContextProvider.test.js
```

Expected: PASS。

- [ ] **Step 7: 提交 Task 2**

```powershell
git add src/modules/hook/HookManager.ts src/modules/hook/index.ts src/worker/ToolContext.ts src/tools/ToolDefinition.ts src/worker/DefineToolContextFactory.ts tests/unit/modules/HookManager.test.ts
git commit -m "refactor(hook): share persistent registry via context"
```

---

### Task 3: 收敛 inject_hook 与 list_persistent_hooks

**Files:**

- Modify: `src/tools/hook/InjectHook.ts`
- Modify: `src/tools/hook/types.ts`
- Modify: `tests/unit/tools/hook/InjectHook.test.ts`
- Modify: `tests/unit/tools/hook/InjectHook.world.test.ts`

**Interfaces:**

`InjectHookData` 保留：`hookId`、`persisted`、`ranOnCurrentFrame`、`world`、`persistentStrategy`；增量增加：

```typescript
requestedWorld: 'main' | 'isolated';
effectiveWorld: 'main';
applyMode?: 'existing-and-future';
registered?: boolean;
idempotent?: boolean;
appliedFrames?: number;
failedFrames?: RegisterPersistentHookResult['failedFrames'];
partial?: boolean;
warnings?: string[];
```

兼容约束：`inject_hook` 上述旧字段继续返回；`list_persistent_hooks` 保留 ISO 字符串
`registeredAt` 与旧 `world` 字段，新 registry 元数据仅增量添加。删除或重命名旧字段必须先
更新客户端契约测试，不得默默改变响应形状。

- [ ] **Step 1: 重写现有测试，使其针对 Context registry 行为**

删除测试对 `getPersistentHookRegistry()` 模块级 Map 的依赖。mock Context 提供：

- `getBrowserContext()`。
- `getPersistentHookRegistry()`。
- 非持久分支所需的 `getSelectedFrame()`。

覆盖：

- `persistent=false` 只 evaluate 当前 selected Frame，不调用 registry。
- `persistent=true` 不直接调用 Page.addInitScript，而是以 `existing-and-future` 委托 registry。
- 没有 BrowserContext 时持久注册明确失败，不 evaluate、不降级。
- registry/addInit 失败时 `persisted=false`，当前 Frame 不被单次 evaluate。
- 幂等结果仍 `persisted=true` 且 `idempotent=true`。
- partial/failedFrames/warnings 原样传到工具 data。
- 同 ID 不同脚本冲突成为失败响应。
- isolated 请求返回 `requestedWorld:'isolated'`、`effectiveWorld:'main'` 和 warning。
- `list_persistent_hooks` 只列当前 Context；没有 Context 时失败。
- list 不返回完整脚本，每项 `removable:false`，并说明重建 Context 才能清除。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/hook/InjectHook.test.js build/tests/unit/tools/hook/InjectHook.world.test.js
```

Expected: 旧实现相关断言失败。

- [ ] **Step 2: 删除 InjectHook 模块级 Map 和伪删除说明**

删除：

- `persistentHookRegistry` 常量。
- `getPersistentHookRegistry()` export。
- 关于不存在的 `remove_persistent_hook` 注释。
- Page-only 迁移注释和静默降级 warning。

模块不得再持有跨调用状态。

- [ ] **Step 3: 实现清晰的两分支 handler**

非持久分支：

1. 获取 selected Frame。
2. `await frame.evaluate(script)` 一次。
3. 返回 `persistentStrategy:'evaluate-once'`、`persisted:false`、`ranOnCurrentFrame:true`。
4. world isolated 时仍返回 effective main warning，因为 Frame.evaluate 不创建 isolated world。

持久分支：

1. 获取 BrowserContext；缺失或关闭立即失败。
2. 获取共享 registry。
3. 调用：

```typescript
await registry.register({
  context: browserContext,
  hookId,
  script,
  source: 'inject_hook',
  requestedWorld: world,
  applyMode: 'existing-and-future',
});
```

4. 不再额外 evaluate selected Frame，避免和 registry 回填重复。
5. 保留兼容字段 `persistentStrategy:'addInitScript'`。
6. `ranOnCurrentFrame` 在持久分支作为兼容指示，设为 `appliedFrames > 0`；精确范围由新增 `appliedFrames`/`failedFrames` 表达。

- [ ] **Step 4: 实现 Context-local list**

handler 必须接收第三个 `context` 参数，调用：

```typescript
const browserContext = context.getBrowserContext();
const entries = context.getPersistentHookRegistry().list(browserContext);
```

响应每项包含 hookId、scriptHash、scriptSize、scriptPreview、registeredAt ISO、旧 `world`（值为 requestedWorld）、source、requestedWorld、effectiveWorld、applyMode、`removable:false`。顶层 data 增加：

```typescript
{
  hooks,
  count: hooks.length,
  removable: false,
  clearBy: 'close-or-recreate-browser-context',
}
```

- [ ] **Step 5: 运行 Hook 工具测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/hook/PersistentHookRegistry.test.js build/tests/unit/tools/hook/InjectHook.test.js build/tests/unit/tools/hook/InjectHook.world.test.js
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 3**

```powershell
git add src/tools/hook/InjectHook.ts src/tools/hook/types.ts tests/unit/tools/hook/InjectHook.test.ts tests/unit/tools/hook/InjectHook.world.test.ts
git commit -m "fix(hook): persist hooks at browser context scope"
```

---

### Task 4: 让 inject_preload_script 使用同一 registry

**Files:**

- Modify: `src/tools/script/script.ts`
- Modify: `tests/unit/tools/script-eval-callback.test.ts`

**Interfaces:**

- `inject_preload_script` 内部 registration ID：`preload-<sha256>`。
- apply mode：`future-only`。
- 不再 selected Page fallback。

- [ ] **Step 1: 先改 preload 测试为新契约**

覆盖：

- BrowserContext 存在时用 `createPreloadHookId(script)` 生成稳定 ID。
- request source 是 `inject_preload_script`、requested world 是 main、apply mode 是 future-only。
- 同脚本重复提交由 registry 返回幂等成功。
- 不同脚本产生不同 registration ID。
- 只有 selected Page、没有 BrowserContext 时失败，且 Page.addInitScript 不被调用。
- 空脚本继续失败。
- registry/addInit 失败返回失败，不回退 Page。
- 成功 data 返回 registrationId、registered、idempotent、effectiveWorld、applyMode。

更新测试 helper：第三个 handler 参数传入包含 `getBrowserContext()` 和 `getPersistentHookRegistry()` 的内部工具 Context；不再临时替换 `getRuntime().contextProvider` 来测试 preload。

Run:

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/script-eval-callback.test.js
```

Expected: Page fallback 的旧断言失败。

- [ ] **Step 2: 删除隐式 target 选择**

从 handler 删除：

```typescript
const target = context ?? selectedPage ?? null;
```

以及对 Page `addInitScript`、`pageClosed` 的分支。保留 script/preset 互斥解析和空值校验。

- [ ] **Step 3: 委托共享 registry**

handler 改为接收 `toolContext`：

```typescript
const browserContext = toolContext.getBrowserContext();
if (!browserContext || browserContext.isClosed()) {
  // structured failure and return
}

const registrationId = createPreloadHookId(script);
const result = await toolContext.getPersistentHookRegistry().register({
  context: browserContext,
  hookId: registrationId,
  script,
  source: 'inject_preload_script',
  requestedWorld: 'main',
  applyMode: 'future-only',
});
```

成功 message 明确“future documents in current BrowserContext”；data 返回 entry 的安全元数据，不返回 script。

- [ ] **Step 4: 运行 script 与 Hook 聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/tools/script-eval-callback.test.js build/tests/unit/tools/hook/InjectHook.test.js build/tests/unit/modules/hook/PersistentHookRegistry.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交 Task 4**

```powershell
git add src/tools/script/script.ts tests/unit/tools/script-eval-callback.test.ts
git commit -m "refactor(script): register preload scripts by context"
```

---

### Task 5: 删除闲置 HookHeartbeat 并增加真实 Chromium 生命周期门禁

**Files:**

- Delete: `src/modules/hook/HookHeartbeat.ts`
- Delete: `tests/unit/modules/HookHeartbeat.test.ts`
- Create: `tests/integration/persistentHooks.integration.test.ts`

**Interfaces:**

- Gate: `RUN_BROWSER_TESTS === 'true'`。
- Uses: 公共 `PersistentHookRegistry` 与 Patchright `chromium`。

- [ ] **Step 1: 再次审计 Heartbeat 生产调用方**

```powershell
rg -n "HookHeartbeat" src tests --glob '!tests/unit/modules/HookHeartbeat.test.ts' --glob '!src/modules/hook/HookHeartbeat.ts'
```

Expected: 无输出并以 exit code 1 结束。若出现任何生产调用方，停止删除，先回到设计评审；不得把它静默改接新 registry。

- [ ] **Step 2: 删除两个闲置文件**

使用 `apply_patch` 删除源文件和专属单元测试。不得新增替代 timer、navigation listener 或 heartbeat 类。

- [ ] **Step 3: 写真实 Chromium 生命周期集成测试**

suite 使用：

```typescript
const runBrowserTests = process.env.RUN_BROWSER_TESTS === 'true';

describe(
  'PersistentHookRegistry Chromium integration',
  {
    skip: !runBrowserTests,
  },
  () => {
    // tests
  },
);
```

启动临时 Chromium Browser 与 Context，使用以下幂等、可观测脚本：

```javascript
globalThis.__persistentHookRuns = (globalThis.__persistentHookRuns ?? 0) + 1;
```

测试必须覆盖：

- 注册前已经打开的 Page 经 backfill 后值为 1。
- Page reload 后新 document 自动得到值 1。
- 注册后 `context.newPage()` 的新 Page 自动得到值 1。
- 注册后创建并导航的 iframe 新 document 自动得到值 1。
- 同 ID 同脚本再次注册不使当前 document 递增。
- close Context 后 registry.list(oldContext) 为空。
- 新建 Context/Page 不继承旧脚本，值为 undefined。

所有 browser/context/page cleanup 放入 `after` 或 try/finally；测试失败也不得遗留浏览器进程。

- [ ] **Step 4: 运行真实 Chromium 门禁**

```powershell
$env:RUN_BROWSER_TESTS = 'true'
try {
  npm run build:dev
  node --require ./build/tests/setup.js --test build/tests/integration/persistentHooks.integration.test.js
} finally {
  Remove-Item Env:RUN_BROWSER_TESTS -ErrorAction SilentlyContinue
}
```

Expected: PASS，且 suite 不处于 skipped。若本机缺少浏览器，明确记录阻塞，不得把 skip 当作完成。

删除源文件后、最终 glob 测试前必须执行仓库 clean 脚本（若存在）再 build，确认
`build/src/modules/hook/HookHeartbeat.js` 与对应测试产物不存在；不得手改 build 目录。

- [ ] **Step 5: 提交 Task 5**

```powershell
git add src/modules/hook/HookHeartbeat.ts tests/unit/modules/HookHeartbeat.test.ts tests/integration/persistentHooks.integration.test.ts
git commit -m "test(hook): verify context lifecycle persistence"
```

---

### Task 6: 阶段 3 最终 diff 验证与伪能力审计

**Files:**

- Verify only; no planned source changes.

- [ ] **Step 1: 确认没有平行状态或伪删除能力**

```powershell
rg -n "persistentHookRegistry|getPersistentHookRegistry" src/tools/hook src/tools/script src/modules/hook src/worker
rg -n "remove_persistent_hook|HookHeartbeat" src docs --glob '!docs/superpowers/**'
rg -n "setTimeout|debounce|framenavigated|load" src/modules/hook/PersistentHookRegistry.ts
```

Expected:

- registry 实例只由 `HookManager` 持有；工具仅通过 Context getter 获取。
- 第二条无输出。
- 第三条无 heartbeat/timer/navigation listener；字符串若只存在于用户脚本数据或无关注释，人工确认后记录。

- [ ] **Step 2: 检查安全响应和 Context 隔离**

```powershell
rg -n "script:" src/modules/hook/PersistentHookRegistry.ts src/tools/hook/InjectHook.ts src/tools/script/script.ts
```

Expected: `script` 只出现在注册 request/局部调用参数；`PersistentHookEntry`、list response 和 preload response 不返回完整脚本。

- [ ] **Step 3: 运行聚焦测试**

```powershell
npm run build:dev
node --require ./build/tests/setup.js --test build/tests/unit/modules/hook/PersistentHookRegistry.test.js build/tests/unit/modules/HookManager.test.js build/tests/unit/tools/hook/InjectHook.test.js build/tests/unit/tools/hook/InjectHook.world.test.js build/tests/unit/tools/script-eval-callback.test.js
```

Expected: PASS。

- [ ] **Step 4: 运行最终项目检查**

```powershell
npm run clean
npm run typecheck
npm run test:unit
npm run test:integration
npm run check-format
```

同时重跑阶段 2 的 `BrowserContextProvider`、`BrowserConnectionManager`、page identity、
`listNetworkRequests` 与 `clearNetworkRequests` 聚焦测试，避免共同修改的 Context 接线回归。

Expected: 全部 PASS，且结果来自最后一次代码修改之后。

- [ ] **Step 5: 重跑真实浏览器门禁**

```powershell
$env:RUN_BROWSER_TESTS = 'true'
try {
  npm run build:dev
  node --require ./build/tests/setup.js --test build/tests/integration/browserTargetInspector.integration.test.js build/tests/integration/persistentHooks.integration.test.js
} finally {
  Remove-Item Env:RUN_BROWSER_TESTS -ErrorAction SilentlyContinue
}
```

Expected: 两个阶段的真实 Chromium 门禁都 PASS 且未 skipped。

- [ ] **Step 6: 检查最终工作区边界**

```powershell
git diff --check
git status --short
```

Expected: 无 whitespace error；三阶段任务文件没有未提交修改，用户原有脏文件保持原状。

## 阶段 3 完成门槛

- `inject_hook(persistent=true)` 对当前 Context 现存 Frame 尽力即时生效，对未来导航和新 Page 自动生效。
- `inject_preload_script` 使用相同 registry 和稳定内部 ID，只作用未来文档。
- 相同 ID/脚本幂等，相同 ID/不同脚本在浏览器副作用前拒绝。
- Context 关闭后条目不可见，新 Context 不继承旧 Hook。
- isolated 请求不伪装成功，明确报告 effective main world。
- 工具不再宣称或模拟运行时删除；`HookHeartbeat` 和专属测试已删除。
- 未引入 Puppeteer、Worker Hook、后台监听或新的浏览器启动注入。
