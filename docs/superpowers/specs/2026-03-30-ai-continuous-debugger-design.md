# AI Continuous Debugger 设计文档

**日期**: 2026-03-30
**状态**: 草稿
**作者**: Claude Code
**参考**: AI_JS_DEBUGGER 项目分析报告

---

## 1. 概述

### 1.1 目标

实现 AI 辅助的连续调试循环功能，让 AI 能够自动分析断点上下文并决定下一步调试策略，减少手动干预。

### 1.2 范围

本设计涵盖两个核心功能：
1. **XHR 断点 → JS 断点两阶段工作流**
2. **AI 连续调试循环**

### 1.3 术语定义

| 术语 | 定义 |
|------|------|
| CDP | Chrome DevTools Protocol |
| XHR | XMLHttpRequest (包括 Fetch API) |
| AI 调试循环 | 等待断点 → 收集信息 → AI 分析 → 执行决策的自动化循环 |
| 调用帧 (Call Frame) | 函数调用栈中的一个帧，包含局部变量和作用域 |

---

## 2. 架构设计

### 2.1 系统组件

```
┌─────────────────────────────────────────────────────────────┐
│                    AIContinuousDebugger                      │
│  (新增模块 - 封装 AI 调试循环核心逻辑)                        │
├─────────────────────────────────────────────────────────────┤
│  - isRunning: boolean                                        │
│  - abortController: AbortController | null                   │
│  - maxIterations: number                                     │
│  - timeoutMs: number                                         │
│  - aiProvider: string                                        │
│                                                              │
│  + start(config: ContinuousDebugConfig): Promise<void>       │
│  + stop(): Promise<void>                                     │
│  + getStatus(): ContinuousDebugStatus                        │
│                                                              │
│  - analyzeAndDecide(debugInfo: DebugInfo): Promise<Decision> │
│  - executeDecision(decision: Decision): Promise<void>        │
│  - collectDebugInfo(): Promise<DebugInfo>                    │
│  - recordIteration(info: DebugInfo, decision: Decision): void│
└─────────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐        ┌─────────────────┐
│ DebuggerManager │        │   AIService     │
│ (现有模块)       │        │  (现有模块)      │
├─────────────────┤        ├─────────────────┤
│ - onBreakpoint  │        │ - chat()        │
│   Hit()         │        │ - 多提供商支持   │
│ - stepInto()    │        │ - 指数退避重试  │
│ - stepOver()    │        │ - 超时控制      │
│ - stepOut()     │        └─────────────────┘
│ - resume()      │
│ - getPausedState│
│ - getScopeVars  │
└─────────────────┘
         ▲
         │
┌─────────────────┐
│ XHRBreakpoint   │
│ Manager         │
│ (现有模块)       │
├─────────────────┤
│ - setXHR()      │
│ - removeXHR()   │
└─────────────────┘
```

### 2.2 模块依赖关系

- `AIContinuousDebugger` 依赖于：
  - `DebuggerManager` (获取调试状态、执行控制)
  - `AIService` (AI 分析决策)
  - `CodeCollector` (获取当前页面和 CDP 会话)
- **不**引入新的 CDP 会话，复用现有的共享会话

---

## 3. 数据结构设计

### 3.1 配置对象

```typescript
interface ContinuousDebugConfig {
  /** 可选：调试开始前导航到的目标 URL */
  targetUrl?: string;

  /** 可选：XHR 断点 URL 模式列表 */
  xhrBreakPatterns?: string[];

  /** 最大迭代次数 (默认 50) */
  maxIterations?: number;

  /** 超时时间毫秒 (默认 300000 = 5 分钟) */
  timeoutMs?: number;

  /** AI 提供商 (默认使用 AIService 配置) */
  aiProvider?: 'openai' | 'anthropic' | 'gemini';

  /** 模型名称 (可选) */
  model?: string;

  /** 系统提示词覆盖 (可选) */
  systemPrompt?: string;
}
```

### 3.2 调试信息

```typescript
interface DebugInfo {
  /** 断点位置 */
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
    url: string;
  };

  /** 调用栈 */
  callStack: CallFrame[];

  /** 作用域变量 */
  scopeVariables: ScopeVariable[];

  /** 控制台消息 (可选，最近 N 条) */
  consoleMessages: ConsoleMessage[];

  /** 网络请求 (可选，最近 N 条) */
  networkRequests: NetworkRequest[];

  /** 断点命中次数 */
  hitCount: number;
}

interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  url: string;
  scopeChain: Scope[];
}

interface ScopeVariable {
  name: string;
  value: any;
  type: string;
  scope: string;
  objectId?: string;
}
```

### 3.3 AI 决策

```typescript
interface Decision {
  /** 决策动作 */
  action: 'step_into' | 'step_over' | 'step_out' | 'resume' | 'stop';

  /** 决策理由 */
  reason: string;

  /** 置信度 (0-1) */
  confidence: number;

  /** 可选：下一步建议 */
  nextSuggestion?: string;
}
```

### 3.4 状态枚举

```typescript
enum ContinuousDebugStatus {
  IDLE = 'idle',
  WAITING_XHR = 'waiting_xhr',
  WAITING_BREAKPOINT = 'waiting_breakpoint',
  ANALYZING = 'analyzing',
  EXECUTING = 'executing',
  STOPPED = 'stopped',
  TIMEOUT = 'timeout',
  ERROR = 'error',
}

interface DebugSessionStats {
  iterations: number;
  decisions: Record<string, number>;
  totalTimeMs: number;
  avgAiLatencyMs: number;
  errors: string[];
}
```

---

## 4. 核心流程

### 4.1 XHR → JS 断点两阶段工作流

```
阶段 1: XHR 断点
┌─────────────────────────────────────┐
│ 1. 设置 XHR 断点 (urlPattern)          │
│ 2. 等待 Debugger.paused 事件         │
│ 3. 捕获调用栈 (callFrames)           │
│ 4. 识别堆栈顶层用户代码位置          │
└─────────────────────────────────────┘
                 │
                 ▼
阶段 2: JS 断点
┌─────────────────────────────────────┐
│ 5. 在顶层位置设置 JS 断点               │
│ 6. 移除 XHR 断点 (可选)                │
│ 7. 恢复执行                           │
│ 8. 等待 JS 断点触发 → 进入 AI 调试循环   │
└─────────────────────────────────────┘
```

**实现伪代码**:

```typescript
async function xhrToJsBreakpoint(urlPattern: string): Promise<{
  xhrBreakpointSet: boolean;
  jsBreakpointSet: boolean;
  callStack: CallFrame[];
  targetScript: { scriptId: string; lineNumber: number; };
}> {
  // 阶段 1: 设置 XHR 断点并等待
  await xhrManager.setXHRBreakpoint(urlPattern);
  const pausedState = await debugger.waitForPaused();

  // 获取调用栈
  const callStack = pausedState.callFrames;

  // 阶段 2: 识别顶层用户代码位置
  // 策略：从栈顶向下找，跳过 vendor/CDN 脚本
  let targetFrame = findUserCodeFrame(callStack);

  // 设置 JS 断点
  const breakpoint = await debugger.setBreakpoint({
    scriptId: targetFrame.location.scriptId,
    lineNumber: targetFrame.location.lineNumber,
  });

  // 移除 XHR 断点
  await xhrManager.removeXHRBreakpoint(urlPattern);

  return {
    xhrBreakpointSet: true,
    jsBreakpointSet: true,
    callStack,
    targetScript: {
      scriptId: targetFrame.location.scriptId,
      lineNumber: targetFrame.location.lineNumber,
    },
  };
}
```

### 4.2 AI 连续调试循环

```
┌─────────────────────────────────────────────────────────────┐
│                    Continuous Debug Loop                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  1. Wait for Breakpoint │
             │  (Debugger.paused)      │
             └────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  2. Collect Debug Info  │
             │  - Location             │
             │  - Call Stack           │
             │  - Scope Variables      │
             │  - Console Messages     │
             └────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  3. AI Analyze & Decide │
             │  - Build prompt         │
             │  - Call LLM             │
             │  - Parse response       │
             └────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  4. Execute Decision    │
             │  - step_into            │
             │  - step_over            │
             │  - step_out             │
             │  - resume               │
             │  - stop                 │
             └────────────────────────┘
                          │
                          ▼
             ┌────────────────────────┐
             │  5. Check Exit Condition│
             │  - maxIterations?       │
             │  - timeout?             │
             │  - user stop?           │
             └────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            │ No                        │ Yes
            ▼                           ▼
    (loop back to 1)           ┌─────────────────┐
                               │  Generate Report │
                               └─────────────────┘
```

**实现伪代码**:

```typescript
async function continuousDebug(config: ContinuousDebugConfig): Promise<void> {
  this.abortController = new AbortController();
  const startTime = Date.now();
  let iterations = 0;
  const stats: DebugSessionStats = { /* ... */ };

  try {
    while (iterations < config.maxIterations!) {
      // 检查超时
      if (Date.now() - startTime > config.timeoutMs!) {
        break;
      }

      // 检查用户中止
      if (this.abortController.signal.aborted) {
        break;
      }

      // 等待断点
      const pausedState = await this.debugger.waitForPaused();

      // 收集调试信息
      const debugInfo = await this.collectDebugInfo(pausedState);

      // AI 分析决策
      const decision = await this.analyzeAndDecide(debugInfo);

      // 记录迭代
      this.recordIteration(debugInfo, decision);
      stats.decisions[decision.action]++;

      // 执行决策
      await this.executeDecision(decision);

      iterations++;
    }
  } catch (error) {
    // 记录错误
    stats.errors.push(error.message);
    throw error;
  } finally {
    // 生成报告
    this.generateReport(stats);
  }
}
```

---

## 5. AI 决策提示词设计

### 5.1 系统提示词

```
你是一个专业的 JavaScript 逆向工程助手。你的任务是分析调试器暂停状态，决定下一步调试策略。

可用的调试动作：
- step_into: 进入当前行调用的函数内部
- step_over: 执行当前行，停在下一行（不进入函数）
- step_out: 执行完当前函数剩余部分，停在调用者
- resume: 继续执行直到下一个断点
- stop: 结束调试会话

分析策略：
1. 优先深入业务逻辑代码，跳过框架/库代码
2. 在关键数据转换处暂停
3. 避免在循环中无限跟踪
4. 当栈深度过深时考虑 step_out

请以 JSON 格式返回决策：
{
  "action": "step_into|step_over|step_out|resume|stop",
  "reason": "决策理由",
  "confidence": 0.0-1.0,
  "nextSuggestion": "可选的下一步建议"
}
```

### 5.2 用户提示词模板

```
## 当前调试状态

**断点位置**: {url}:{lineNumber}:{columnNumber}
**函数名**: {functionName}
**已迭代次数**: {iterations}

## 调用栈 (Top 5)

{callStackFrames}

## 作用域变量

{scopeVariables}

## 最近控制台消息

{consoleMessages}

请分析当前状态并决定下一步调试动作。
```

---

## 6. 与现有模块集成

### 6.1 DebuggerManager 扩展

需要在 `DebuggerManager` 中添加：

```typescript
// 新增：断点命中时自动获取作用域变量的选项
interface GetScopeVariablesOptions {
  callFrameId?: string;
  includeObjectProperties?: boolean;
  maxDepth?: number;
  skipErrors?: boolean;
  autoExpandTopFrame?: boolean; // 新增：自动展开顶层帧的所有作用域
}

// 新增：快速导出暂停状态快照
exportPausedSnapshot(): PausedSnapshot;
```

### 6.2 AIService 使用

```typescript
// 使用现有的 AIService
const aiService = new AIService(config);

const decision = await aiService.chat({
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserPrompt(debugInfo) },
  ],
  temperature: 0.1, // 低温度确保决策一致性
  response_format: { type: 'json_object' }, // 强制 JSON 响应
});

// 解析 JSON 响应
const parsedDecision = JSON.parse(decision.content) as Decision;
```

### 6.3 MCP 工具接口

在 `src/tools/debugger.ts` 中新增：

```typescript
/**
 * 启动 AI 连续调试循环
 */
export const startContinuousDebugging = defineTool({
  name: 'start_continuous_debugging',
  description: '启动 AI 辅助的连续调试循环。设置 XHR 断点（可选），然后自动分析每个断点并决定下一步。',
  schema: {
    targetUrl: zod.string().optional(),
    xhrBreakPatterns: zod.array(zod.string()).optional(),
    maxIterations: zod.number().int().optional().default(50),
    timeoutMs: zod.number().int().optional().default(300000),
    aiProvider: zod.enum(['openai', 'anthropic', 'gemini']).optional(),
  },
  handler: async (request, response, context) => {
    const debugger_ = new AIContinuousDebugger(
      context.debuggerContext,
      context.aiService
    );
    await debugger_.start(request.params);
    response.appendResponseLine('AI 连续调试已启动...');
  },
});

/**
 * 停止 AI 连续调试循环
 */
export const stopContinuousDebugging = defineTool({
  name: 'stop_continuous_debugging',
  description: '停止正在运行的 AI 连续调试循环。',
  schema: {},
  handler: async (request, response, context) => {
    // 获取当前运行的调试器实例并停止
    context.debuggerContext.stopContinuousDebugging();
    response.appendResponseLine('AI 连续调试已停止。');
  },
});

/**
 * XHR → JS 断点两阶段工作流
 */
export const xhrToJsBreakpoint = defineTool({
  name: 'xhr_to_js_breakpoint',
  description: '两阶段断点工作流：先通过 XHR 断点捕获调用栈，然后在顶层用户代码位置设置 JS 断点。',
  schema: {
    urlPattern: zod.string().describe('XHR 断点 URL 模式'),
    maxDepth: zod.number().int().optional().default(5),
  },
  handler: async (request, response, context) => {
    const result = await context.debuggerContext.xhrToJsBreakpoint(
      request.params.urlPattern,
      request.params.maxDepth
    );
    response.appendResponseLine(JSON.stringify(result, null, 2));
  },
});
```

---

## 7. 错误处理

### 7.1 预期错误场景

| 场景 | 处理策略 |
|------|----------|
| AI 响应超时 | 重试 2 次后使用默认决策 `step_over` |
| AI 响应格式无效 | 记录错误，使用上一步相同决策 |
| 断点命中过于频繁 | 检测到循环时自动切换到 `resume` |
| CDP 会话断开 | 尝试重新连接，失败则停止循环 |
| 页面导航 | 等待新页面加载后恢复调试 |

### 7.2 重试逻辑

```typescript
async function analyzeWithRetry(
  debugInfo: DebugInfo,
  maxRetries = 2
): Promise<Decision> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries + 1; i++) {
    try {
      return await this.analyzeAndDecide(debugInfo);
    } catch (error) {
      lastError = error as Error;
      logger.warn(`AI analysis attempt ${i + 1} failed:`, error);
      await sleep(1000 * Math.pow(2, i)); // 指数退避
    }
  }

  // 所有重试失败，返回默认决策
  logger.error('AI analysis failed after retries, using default decision');
  return {
    action: 'step_over',
    reason: 'Default decision after AI failure',
    confidence: 0.5,
  };
}
```

---

## 8. 测试计划

### 8.1 单元测试

```typescript
describe('AIContinuousDebugger', () => {
  describe('analyzeAndDecide', () => {
    it('should return step_into for function call on current line', async () => {
      // TODO
    });

    it('should return step_out when stack depth > threshold', async () => {
      // TODO
    });
  });

  describe('xhrToJsBreakpoint', () => {
    it('should set XHR breakpoint and capture call stack', async () => {
      // TODO
    });

    it('should identify top user code frame correctly', async () => {
      // TODO
    });
  });
});
```

### 8.2 集成测试

1. 设置 XHR 断点并触发网络请求
2. 验证 AI 调试循环能够正常启动和停止
3. 验证决策执行后调试状态变化符合预期

### 8.3 E2E 测试

使用真实网站进行端到端测试：
1. 导航到目标页面
2. 启动 AI 连续调试
3. 验证能够跟踪到业务逻辑代码

---

## 9. 实现里程碑

### Phase 1: XHR 两阶段工作流 (1-2 天)
- [ ] 实现 `xhrToJsBreakpoint` 核心函数
- [ ] 添加 `findUserCodeFrame` 辅助函数
- [ ] 编写单元测试
- [ ] 集成到 MCP 工具

### Phase 2: AI 连续调试循环核心 (3-4 天)
- [ ] 创建 `AIContinuousDebugger.ts` 模块
- [ ] 实现 `analyzeAndDecide` AI 分析逻辑
- [ ] 实现 `executeDecision` 执行逻辑
- [ ] 集成到 `DebuggerManager.onBreakpointHit`
- [ ] 编写提示词和响应解析

### Phase 3: MCP 工具封装 (1 天)
- [ ] 添加 `start_continuous_debugging` 工具
- [ ] 添加 `stop_continuous_debugging` 工具
- [ ] 添加 `get_ai_debug_status` 工具

### Phase 4: 测试和文档 (1-2 天)
- [ ] 编写集成测试
- [ ] 更新 README 文档
- [ ] 添加使用示例

---

## 10. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| AI 决策延迟高 (2-5 秒/次) | 调试体验差 | 中 | 支持流式响应；允许设置自动跳过超时阈值 |
| CDP 状态不同步 | 调试失败 | 低 | 定期同步页面状态；异常时自动重连 |
| 作用域数据爆炸 | Token 超限 | 中 | 分层展开：先第一层，AI 请求时再深入 |
| XHR 断点误触发 | 调试流程被打断 | 中 | 支持更精确的 URL 模式匹配（正则） |
| 循环断点 | 无限调试循环 | 中 | 检测相同位置命中次数，自动 resume |

---

## 11. 验收标准

1. **功能完整性**
   - [ ] XHR 断点 → JS 断点工作流正常工作
   - [ ] AI 连续调试循环能够启动/停止
   - [ ] AI 决策能够正确执行

2. **性能指标**
   - [ ] 单次迭代平均时间 < 5 秒
   - [ ] 支持至少 50 次连续迭代
   - [ ] 内存占用稳定，无明显泄漏

3. **用户体验**
   - [ ] 提供清晰的状态反馈
   - [ ] 支持随时中断
   - [ ] 错误信息友好可理解

4. **代码质量**
   - [ ] 单元测试覆盖率 > 80%
   - [ ] TypeScript 类型完整
   - [ ] 通过 lint 检查

---

## 12. 参考资源

- AI_JS_DEBUGGER 项目分析：`D:\ai-llm\tool\AI_JS_DEBUGGER\PROJECT_ANALYSIS_REPORT.md`
- CDP Debugger 域文档：https://chromedevtools.github.io/devtools-protocol/tot/Debugger/
- 现有代码：
  - `src/modules/debugger/DebuggerManager.ts`
  - `src/modules/debugger/XHRBreakpointManager.ts`
  - `src/tools/debugger.ts`
  - `src/services/AIService.ts`
