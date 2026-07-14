# God Class 拆分实施计划（Part 1：Phase 1–3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按门面+策略模块模式拆分 CodeAnalyzer、PageController、DebuggerManager 三个 god class。

**Architecture:** 每个 god class 提取私有逻辑到同目录下独立 collaborator 文件，原类保留为瘦门面。公共 API 完全向后兼容，调用方零改动。每个 class 独立 commit。

**Tech Stack:** TypeScript ESM, node:test, @babel/parser, Playwright

**Spec:** `docs/superpowers/specs/2026-07-01-god-class-split-design.md`

## Global Constraints

- 每个策略文件 ≤500 行，每个门面 ≤450 行
- 公共 API 签名不变，调用方代码不动
- 每类独立 commit，可独立回退
- 新增策略文件补对应单元测试（`tests/unit/` 镜像）
- `npm run typecheck` 通过，`npm run test:unit` 无回归

---

## Phase 1：CodeAnalyzer.ts 拆分

### Task 1.1: 阅读现有代码，判断拆分边界

**Files:**

- Read: `src/modules/analyzer/CodeAnalyzer.ts` (747 lines)

行级别的拆分边界已经明确（见 spec），执行前只需确认最新代码与 spec 一致。

- [ ] **Step 1: 确认待提取的 4 个方法范围**

在 `src/modules/analyzer/CodeAnalyzer.ts` 中确认以下方法的起止行：

- `analyzeStructure`（L203–L350）
- `analyzeModules`（L352–L386）
- `buildCallGraph`（L388–L449）
- `calculateComplexity`（L451–L492）

- [ ] **Step 2: 确认被提取方法的依赖**

这些方法使用了以下外部依赖（需在新文件中 import）：

- `traverse` from `@babel/traverse`
- `type * as t` from `@babel/types`
- `FunctionInfo`, `ClassInfo`, `CallGraph`, `CodeStructure` from `../../types/index.js`

- [ ] **Step 3: 运行基线测试建立可回退状态**

```bash
npm run build && npm run typecheck && npm run test:unit
```

确认全部通过。如有失败则停止，先修复基线。

---

### Task 1.2: 创建 CodeAnalyzerStructure.ts 策略文件

**Files:**

- Create: `src/modules/analyzer/CodeAnalyzerStructure.ts`

**Interfaces:**

- Produces: 4 个具名导出函数（`analyzeStructure`, `analyzeModules`, `buildCallGraph`, `calculateComplexity`）
- 签名与现有私有方法一致，但不再通过 `this` 访问任何属性

- [ ] **Step 1: 创建新文件，包含必要的 import**

```typescript
/**
 * CodeAnalyzer 结构分析策略模块。
 * 提取自 CodeAnalyzer.ts 的 AST 遍历与分析逻辑。
 */

import traverseImport from '@babel/traverse';
const traverse =
  (traverseImport as unknown as {default?: typeof traverseImport}).default ??
  traverseImport;
import type * as t from '@babel/types';

import type {
  FunctionInfo,
  ClassInfo,
  CallGraph,
  CodeStructure,
} from '../../types/index.js';
```

- [ ] **Step 2: 复制 `analyzeModules`（纯函数，无 this 引用）**

从 `CodeAnalyzer.ts` L352–L386 复制 `analyzeModules` 方法，改为导出函数（移除 `private` 关键字）：

```typescript
export function analyzeModules(
  code: string,
  ast: t.File | null,
): CodeStructure['modules'] {
  const modules: CodeStructure['modules'] = [];
  if (ast) {
    const imports: string[] = [];
    const exports: string[] = [];
    traverse(ast, {
      ImportDeclaration(path) {
        imports.push(path.node.source.value);
      },
      ExportNamedDeclaration(path) {
        if (path.node.source) {
          exports.push(path.node.source.value);
        }
      },
      ExportDefaultDeclaration() {
        exports.push('default');
      },
    });
    if (imports.length > 0 || exports.length > 0) {
      modules.push({name: 'current', imports, exports});
    }
  }
  return modules;
}
```

- [ ] **Step 3: 复制 `calculateComplexity`（纯函数，无 this 引用）**

从 `CodeAnalyzer.ts` L451–L492 复制，改为导出函数：

```typescript
export function calculateComplexity(path: unknown): number {
  let complexity = 1;
  const anyPath = path as any;
  if (anyPath.traverse) {
    anyPath.traverse({
      IfStatement() {
        complexity++;
      },
      SwitchCase() {
        complexity++;
      },
      ForStatement() {
        complexity++;
      },
      WhileStatement() {
        complexity++;
      },
      DoWhileStatement() {
        complexity++;
      },
      ConditionalExpression() {
        complexity++;
      },
      LogicalExpression(logicalPath: any) {
        if (
          logicalPath.node.operator === '&&' ||
          logicalPath.node.operator === '||'
        ) {
          complexity++;
        }
      },
      CatchClause() {
        complexity++;
      },
    });
  }
  return complexity;
}
```

- [ ] **Step 4: 复制 `buildCallGraph`（改为调用本地函数）**

从 `CodeAnalyzer.ts` L388–L449 复制，改为导出函数。此函数调用了 `this.parseCodeAst(code, ...)` —— 将 `ast` 参数声明改为必传（由调用方传入解析好的 ast）：

```typescript
export function buildCallGraph(
  functions: FunctionInfo[],
  ast: t.File | null,
): CallGraph {
  const nodes: CallGraph['nodes'] = functions.map(fn => ({
    id: fn.name,
    name: fn.name,
    type: 'function' as const,
  }));
  const edges: CallGraph['edges'] = [];
  if (ast) {
    let currentFunction = '';
    traverse(ast, {
      FunctionDeclaration(path) {
        currentFunction = path.node.id?.name || '';
      },
      FunctionExpression(path) {
        const parent = path.parent;
        if (
          parent.type === 'VariableDeclarator' &&
          parent.id.type === 'Identifier'
        ) {
          currentFunction = parent.id.name;
        }
      },
      CallExpression(path) {
        if (currentFunction) {
          const callee = path.node.callee;
          let calledFunction = '';
          if (callee.type === 'Identifier') {
            calledFunction = callee.name;
          } else if (
            callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier'
          ) {
            calledFunction = callee.property.name;
          }
          if (
            calledFunction &&
            functions.some(f => f.name === calledFunction)
          ) {
            edges.push({from: currentFunction, to: calledFunction});
          }
        }
      },
    });
  }
  return {nodes, edges};
}
```

**注意**：原始签名是 `buildCallGraph(functions, code, ast)` 且会 fallback 调用 `this.parseCodeAst`。改为 `buildCallGraph(functions, ast)` —— caller 需保证传入有效的 ast。CodeAnalyzer 门面在调用前负责解析。

- [ ] **Step 5: 复制 `analyzeStructure`（改为调用本地函数、接受 calculateComplexity 回调）**

从 `CodeAnalyzer.ts` L203–L350 复制。关键改动：

1. 移除 `this.analyzeModules(this)` 和 `this.buildCallGraph(this)`
2. 改为调用同文件的 `analyzeModules` 和 `buildCallGraph` 函数
3. AST 参数改为必传（由调用方传入）
4. `self.calculateComplexity` 改为直接用 `calculateComplexity`（闭包无 this 问题）

```typescript
export async function analyzeStructure(
  code: string,
  ast: t.File | null,
): Promise<CodeStructure> {
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];

  if (ast) {
    traverse(ast, {
      FunctionDeclaration(path) {
        const node = path.node;
        functions.push({
          name: node.id?.name || 'anonymous',
          params: node.params.map(p =>
            p.type === 'Identifier' ? p.name : 'unknown',
          ),
          location: {
            file: 'current',
            line: node.loc?.start.line || 0,
            column: node.loc?.start.column,
          },
          complexity: calculateComplexity(path),
        });
      },
      // ... [完整复制 FunctionExpression, ArrowFunctionExpression, ClassDeclaration 的 visitor 代码]
      // FunctionExpression visitor (L234–L263)
      // ArrowFunctionExpression visitor (L265–L289)
      // ClassDeclaration visitor (L291–L337)
    });
  }

  const modules = analyzeModules(code, ast);
  const callGraph = buildCallGraph(functions, ast);

  return {functions, classes, modules, callGraph};
}
```

**警告**：`analyzeStructure` 中的 AST visitor 代码较长（~130 行 traverse 回调）。从 CodeAnalyzer.ts L217–L338 精确复制。

---

### Task 1.3: 更新 CodeAnalyzer 门面

**Files:**

- Modify: `src/modules/analyzer/CodeAnalyzer.ts`

**Interfaces:**

- Consumes: `analyzeStructure`, `analyzeModules`, `buildCallGraph`, `calculateComplexity` from `./CodeAnalyzerStructure.js`

- [ ] **Step 1: 添加 import**

在现有 import 之后添加：

```typescript
import {
  analyzeStructure,
  analyzeModules,
  buildCallGraph,
  calculateComplexity,
} from './CodeAnalyzerStructure.js';
```

- [ ] **Step 2: 删除 4 个私有方法**

删除 CodeAnalyzer 类中的以下方法（L203–L492）：

- `analyzeStructure`（L203–L350）
- `analyzeModules`（L352–L386）
- `buildCallGraph`（L388–L449）
- `calculateComplexity`（L451–L492）

- [ ] **Step 3: 更新 `understand` 方法中的调用**

`understand()` 方法（L137–L199）中调用 `this.analyzeStructure(code, ast)`，改为调用导入的函数：

```typescript
// 原：const structure = await this.analyzeStructure(code, ast);
const structure = await analyzeStructure(code, ast);
```

- [ ] **Step 4: 验证门面行数**

```bash
wc -l src/modules/analyzer/CodeAnalyzer.ts
```

确认 ≤ 450 行。如果超限，检查是否有遗漏的删除。

---

### Task 1.4: 添加 CodeAnalyzerStructure 单元测试

**Files:**

- Create: `tests/unit/modules/analyzer/CodeAnalyzerStructure.test.ts`

- [ ] **Step 1: 编写测试文件框架**

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';
import * as parser from '@babel/parser';
import {
  analyzeStructure,
  calculateComplexity,
  buildCallGraph,
} from '../../../src/modules/analyzer/CodeAnalyzerStructure.js';
```

- [ ] **Step 2: 编写 `calculateComplexity` 的测试用例（4 个场景）**

```typescript
describe('calculateComplexity', () => {
  it('returns 1 for empty function', () => {
    const code = `function empty() {}`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let result = 1;
    require('@babel/traverse').default(ast, {
      FunctionDeclaration(path: any) {
        result = calculateComplexity(path);
      },
    });
    assert.strictEqual(result, 1);
  });

  it('increments for if statements', () => {
    const code = `function f() { if (true) { return 1; } }`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let result = 1;
    require('@babel/traverse').default(ast, {
      FunctionDeclaration(path: any) {
        result = calculateComplexity(path);
      },
    });
    assert.strictEqual(result, 2);
  });

  it('increments for for/while loops', () => {
    const code = `function f() { for (let i = 0; i < 10; i++) { if (i > 5) break; } }`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let result = 1;
    require('@babel/traverse').default(ast, {
      FunctionDeclaration(path: any) {
        result = calculateComplexity(path);
      },
    });
    assert.strictEqual(result, 3);
  });

  it('increments for switch/catch/conditional', () => {
    const code = `function f(x) { switch(x) { case 1: return 'a'; default: return 'b'; } }`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    let result = 1;
    require('@babel/traverse').default(ast, {
      FunctionDeclaration(path: any) {
        result = calculateComplexity(path);
      },
    });
    assert.strictEqual(result, 2);
  });
});
```

- [ ] **Step 3: 编写 `buildCallGraph` 的测试用例**

```typescript
describe('buildCallGraph', () => {
  it('detects direct function calls', () => {
    const code = `function a() {} function b() { a(); }`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    const functions = [
      {
        name: 'a',
        params: [],
        location: {file: 'test', line: 1, column: 0},
        complexity: 1,
      },
      {
        name: 'b',
        params: [],
        location: {file: 'test', line: 1, column: 0},
        complexity: 1,
      },
    ];
    const graph = buildCallGraph(functions, ast);
    assert.ok(graph.edges.some(e => e.from === 'b' && e.to === 'a'));
  });
});
```

- [ ] **Step 4: 编写 `analyzeStructure` 的冒烟测试**

```typescript
describe('analyzeStructure', () => {
  it('returns structure for simple code', async () => {
    const code = `function foo(x) { return x; }`;
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
    const result = await analyzeStructure(code, ast);
    assert.ok(Array.isArray(result.functions));
    assert.ok(result.functions.some(f => f.name === 'foo'));
  });
});
```

---

### Task 1.5: 运行验证并提交

- [ ] **Step 1: 构建并运行类型检查**

```bash
npm run build
npm run typecheck
```

预期：通过（无 import 错误或类型错误）。

- [ ] **Step 2: 运行全部单元测试**

```bash
npm run test:unit
```

预期：全部通过，无回归。CodeAnalyzerStructure.test.ts 中的新测试也应通过。

- [ ] **Step 3: 格式检查**

```bash
npm run check-format
```

- [ ] **Step 4: 确认文件大小**

```bash
wc -l src/modules/analyzer/CodeAnalyzer.ts
wc -l src/modules/analyzer/CodeAnalyzerStructure.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/modules/analyzer/CodeAnalyzer.ts src/modules/analyzer/CodeAnalyzerStructure.ts tests/unit/modules/analyzer/CodeAnalyzerStructure.test.ts
git commit -m "refactor(analyzer): split CodeAnalyzer structure analysis into CodeAnalyzerStructure.ts

Extract analyzeStructure, analyzeModules, buildCallGraph, calculateComplexity
to separate strategy module. CodeAnalyzer remains as facade with understand()
and AI-assisted analysis methods."
```

---

## Phase 2：PageController.ts 拆分

### Task 2.1: 阅读现有代码，熟悉方法分组

**Files:**

- Read: `src/modules/collector/PageController.ts` (993 lines)

- [ ] **Step 1: 运行基线测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 确认 43 个方法的分组**

PageController 的所有方法都通过 `this.collector.getActivePage()` 获取页面，然后代理 Playwright 操作。分组如下：

| 策略文件        | 方法                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PageNavigation  | navigate, reload, goBack, goForward, waitForNavigation                                                                                                     |
| PageInteraction | click, clickAt, setFiles, type, select, hover, scroll, scrollBy, waitForSelector                                                                           |
| PageInfo        | getURL, getTitle, getContent, screenshot, evaluate + storage 方法（setLocalStorage, clearLocalStorage, setSessionStorage, etc.）+ pressKey + emulateDevice |

- [ ] **Step 3: 记录方法的公共签名，确保提取后不改动**

每个方法的签名在代码中已有定义。提取为纯函数后，原 PageController 公共方法签名不变。

---

### Task 2.2: 创建 PageNavigation.ts

**Files:**

- Create: `src/modules/collector/PageNavigation.ts`

- [ ] **Step 1: 创建文件，复制导航方法**

从 PageController.ts 提取以下方法并改为导出函数，接受 `page: Page` 作为第一个参数，而非通过 `this.collector.getActivePage()`：

```typescript
import type {Page} from 'playwright';
import {logger} from '../../utils/logger.js';
import type {NavigationOptions} from './PageController.js';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;

export async function navigate(
  page: Page,
  url: string,
  options?: NavigationOptions,
): Promise<{url: string; title: string; loadTime: number}> {
  const startTime = Date.now();
  await page.goto(url, {
    waitUntil: options?.waitUntil || 'networkidle',
    timeout: options?.timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  const loadTime = Date.now() - startTime;
  const title = await page.title();
  const currentUrl = page.url();
  logger.info(`Navigated to: ${url}`);
  return {url: currentUrl, title, loadTime};
}

export async function reload(
  page: Page,
  options?: NavigationOptions,
): Promise<void> {
  await page.reload({
    waitUntil: options?.waitUntil || 'networkidle',
    timeout: options?.timeout || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
}

export async function goBack(page: Page): Promise<void> {
  await page.goBack({timeout: DEFAULT_NAVIGATION_TIMEOUT_MS});
}

export async function goForward(page: Page): Promise<void> {
  await page.goForward({timeout: DEFAULT_NAVIGATION_TIMEOUT_MS});
}

export async function waitForNavigation(
  page: Page,
  timeout?: number,
): Promise<void> {
  await page.waitForLoadState('networkidle', {
    timeout: timeout ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
}
```

**注意**：上述代码需与 PageController.ts 中对应方法体完全一致。如果原始方法有任何额外逻辑（如错误处理、日志、回调），必须一并保留。

---

### Task 2.3: 创建 PageInteraction.ts

**Files:**

- Create: `src/modules/collector/PageInteraction.ts`

- [ ] **Step 1: 复制交互类方法，改为接受 page 参数的导出函数**

```typescript
import type {Page, Frame, ElementHandle} from 'playwright';
import {logger} from '../../utils/logger.js';
import type {
  ClickOptions,
  TypeOptions,
  ScrollOptions,
} from './PageController.js';
import type {CodeCollector} from './CodeCollector.js';

export async function click(
  page: Page,
  selector: string,
  options?: ClickOptions,
): Promise<void> {
  /* 复制 click 方法体 */
}

export async function clickAt(
  page: Page,
  selector: string,
): Promise<{
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  /* 复制 clickAt 方法体 */
}

export async function setFiles(
  page: Page,
  collector: CodeCollector,
  selector: string,
  filePaths: string[],
): Promise<void> {
  /* 复制 setFiles 方法体 */
}

export async function type(
  page: Page,
  selector: string,
  text: string,
  options?: TypeOptions,
): Promise<void> {
  /* 复制 type 方法体 */
}

export async function select(
  page: Page,
  selector: string,
  ...values: string[]
): Promise<void> {
  /* 复制 select 方法体 */
}

export async function hover(page: Page, selector: string): Promise<void> {
  /* 复制 hover 方法体 */
}

export async function scroll(
  page: Page,
  options: ScrollOptions,
): Promise<void> {
  /* 复制 scroll 方法体 */
}

export async function scrollBy(
  page: Page,
  direction: 'up' | 'down' | 'top' | 'bottom',
  pixels?: number,
): Promise<void> {
  /* 复制 scrollBy 方法体 */
}

export async function waitForSelector(
  page: Page,
  selector: string,
  timeout?: number,
): Promise<{
  text: string;
  visible: boolean;
  attributes: Record<string, string>;
} | null> {
  /* 复制 waitForSelector 方法体 */
}
```

**注意**：此步骤需要从 PageController.ts 中精确复制 9 个方法的完整方法体。每个方法体的原始行数和逻辑保持一致。`setFiles` 额外需要 `Collector` 参数（原方法通过 `cdpSession` 做 CDP 调用）。

---

### Task 2.4: 创建 PageInfo.ts

**Files:**

- Create: `src/modules/collector/PageInfo.ts`

- [ ] **Step 1: 复制页面信息和 storage 方法**

```typescript
import type {Page} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import type {ScreenshotOptions} from './PageController.js';

export async function getURL(page: Page): Promise<string> {
  /* 复制 getURL 方法体 */
}

export async function getTitle(page: Page): Promise<string> {
  /* 复制 getTitle 方法体 */
}

export async function getContent(page: Page): Promise<string> {
  /* 复制 getContent 方法体 */
}

export async function screenshot(
  page: Page,
  options?: ScreenshotOptions,
): Promise<Buffer> {
  /* 复制 screenshot 方法体 */
}

export async function evaluate<T>(page: Page, code: string): Promise<T> {
  /* 复制 evaluate 方法体 */
}

// storage 方法（setLocalStorage, clearLocalStorage, setSessionStorage, setCookie, clearCookies, pressKey, emulateDevice 等）
```

**注意**：此步骤需要从 PageController.ts 中精确复制约 8-12 个方法的完整方法体。

---

### Task 2.5: 更新 PageController 门面

**Files:**

- Modify: `src/modules/collector/PageController.ts`

- [ ] **Step 1: 添加 import**

```typescript
import * as PageNavigation from './PageNavigation.js';
import * as PageInteraction from './PageInteraction.js';
import * as PageInfo from './PageInfo.js';
```

- [ ] **Step 2: 将每个方法的实现替换为委托调用**

对于每个公共方法，例如 `navigate`：

```typescript
async navigate(
  url: string,
  options?: NavigationOptions,
): Promise<{ url: string; title: string; loadTime: number }> {
  const page = await this.collector.getActivePage();
  return PageNavigation.navigate(page, url, options);
}
```

所有 43 个方法都照此模式替换。方法的 JSDoc 注释和签名保持不变，仅将方法体改为一行委托。

- [ ] **Step 3: 删除不再需要的方法体代码**

删除原始方法体（已复制到策略文件中）。

- [ ] **Step 4: 验证门面行数**

```bash
wc -l src/modules/collector/PageController.ts
```

预期 ≤300 行。

---

### Task 2.6: 添加策略文件的单元测试

**Files:**

- Create: `tests/unit/modules/collector/PageNavigation.test.ts`
- Create: `tests/unit/modules/collector/PageInteraction.test.ts`
- Create: `tests/unit/modules/collector/PageInfo.test.ts`

- [ ] **Step 1: 编写 PageNavigation 测试**

由于 PageController 的方法是对 Playwright `Page` 的薄封装，测试可以使用 mock `Page` 对象：

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  navigate,
  reload,
} from '../../../src/modules/collector/PageNavigation.js';

describe('PageNavigation', () => {
  it('navigate returns url, title, and loadTime', async () => {
    let calledUrl = '';
    let calledOptions: any = {};
    const mockPage = {
      async goto(url: string, opts: any) {
        calledUrl = url;
        calledOptions = opts;
      },
      async title() {
        return 'Mock Title';
      },
      url() {
        return 'https://example.com';
      },
    } as any;

    const result = await navigate(mockPage, 'https://example.com');
    assert.strictEqual(result.url, 'https://example.com');
    assert.strictEqual(result.title, 'Mock Title');
    assert.ok(result.loadTime >= 0);
    assert.strictEqual(calledUrl, 'https://example.com');
  });
});
```

- [ ] **Step 2: 编写 PageInteraction 测试（每个主要方法 1 个用例）**

Mock `Page` 的 `click`, `type`, `hover` 等方法，验证参数正确传递。

- [ ] **Step 3: 编写 PageInfo 测试**

Mock `Page` 的 `url()`, `title()`, `content()`, `screenshot()` 等方法。

---

### Task 2.7: 运行验证并提交

- [ ] **Step 1: 构建 + 类型检查 + 单元测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 格式检查**

```bash
npm run check-format
```

- [ ] **Step 3: 确认 WasmCollector 不受影响**

```bash
npm run test:unit -- --test-name-pattern="WasmCollector"
```

- [ ] **Step 4: 确认文件大小**

```bash
wc -l src/modules/collector/PageController.ts
wc -l src/modules/collector/PageNavigation.ts
wc -l src/modules/collector/PageInteraction.ts
wc -l src/modules/collector/PageInfo.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/modules/collector/PageController.ts src/modules/collector/PageNavigation.ts src/modules/collector/PageInteraction.ts src/modules/collector/PageInfo.ts tests/unit/modules/collector/PageNavigation.test.ts tests/unit/modules/collector/PageInteraction.test.ts tests/unit/modules/collector/PageInfo.test.ts
git commit -m "refactor(collector): split PageController by domain (navigation/interaction/info)

Extract 43 methods into PageNavigation, PageInteraction, PageInfo strategy modules.
PageController remains as thin facade delegating to collaborators.
Public API unchanged, WasmCollector consumers unaffected."
```

---

## Phase 3：DebuggerManager.ts 拆分

### Task 3.1: 阅读代码，确认断点和执行的边界

**Files:**

- Read: `src/modules/debugger/DebuggerManager.ts` (1019 lines)

- [ ] **Step 1: 运行基线测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 找出待提取的方法**

列出所有断点管理方法和执行控制方法：

**断点管理**（提取到 BreakpointManager）：

- `setBreakpointByUrl`, `setBreakpoint`, `removeBreakpoint`, `listBreakpoints`, `getBreakpoint`, `clearAllBreakpoints`, `setPauseOnExceptions`
- 状态：`breakpoints` Map, `pauseOnExceptionsState`, `breakpointResolvedListener`

**执行控制**（提取到 ExecutionController）：

- `pause`, `resume`, `stepInto`, `stepOver`, `stepOut`
- 状态：`pausedState`, `pausedResolvers`, `pausedListener`, `resumedListener`

**保留**（DebuggerManager 本体）：

- CDP session 管理：`init`, `enable`, `disable`, `requireSession`, `getCDPSession`, `setAsyncCallStackDepth`
- Sub-manager 访问器：`getWatchManager`, `getXHRManager`, `getEventManager`, `getBlackboxManager`
- `constructScopeChain`, `toScopeVariableScopeType`（工具方法）
- `initAdvancedFeatures`

---

### Task 3.2: 创建 BreakpointManager.ts

**Files:**

- Create: `src/modules/debugger/BreakpointManager.ts`

- [ ] **Step 1: 创建文件，定义类**

```typescript
import type { CDPSession } from 'playwright';
import { logger } from '../../utils/logger.js';
import type { BreakpointInfo } from './types.js'; // 验证实际类型导入路径

export class BreakpointManager {
  private breakpoints = new Map<string, BreakpointInfo>();
  private pauseOnExceptionsState: 'none' | 'uncaught' | 'all' = 'none';
  private breakpointResolvedListener: ((params: any) => void) | null = null;

  constructor(private getCDPSession: () => CDPSession) {}

  getCDPSessionAccessor(): () => CDPSession {
    return this.getCDPSession;
  }
```

- [ ] **Step 2: 复制断点方法**

从 DebuggerManager.ts 复制以下方法的完整实现：

- `setBreakpointByUrl`
- `setBreakpoint`
- `removeBreakpoint`
- `listBreakpoints`
- `getBreakpoint`
- `clearAllBreakpoints`
- `setPauseOnExceptions`

将方法中的 `this.cdpSession` 改为 `this.getCDPSession()`（因为 session 引用可能变化，用 accessor 更安全）。

保持方法签名不变，保留所有参数校验和错误处理逻辑。

---

### Task 3.3: 创建 ExecutionController.ts

**Files:**

- Create: `src/modules/debugger/ExecutionController.ts`

- [ ] **Step 1: 创建文件，定义类**

```typescript
import type { CDPSession } from 'playwright';
import type { PausedState, BreakpointHitCallback } from './types.js'; // 验证实际导入路径

export class ExecutionController {
  private pausedState: PausedState | null = null;
  private pausedResolvers: Array<(state: PausedState) => void> = [];
  private breakpointHitCallbacks = new Set<BreakpointHitCallback>();
  private pausedListener: ((params: any) => void) | null = null;
  private resumedListener: (() => void) | null = null;

  constructor(private getCDPSession: () => CDPSession) {}
```

- [ ] **Step 2: 复制执行控制方法**

从 DebuggerManager.ts 复制：

- `pause`
- `resume`
- `stepInto`
- `stepOver`
- `stepOut`
- 以及 paused 监听器的绑定/解绑逻辑

将 `this.cdpSession` 改为 `this.getCDPSession()`。

---

### Task 3.4: 更新 DebuggerManager 门面

**Files:**

- Modify: `src/modules/debugger/DebuggerManager.ts`

- [ ] **Step 1: 添加 import 和实例化**

```typescript
import { BreakpointManager } from './BreakpointManager.js';
import { ExecutionController } from './ExecutionController.js';

export class DebuggerManager {
  private cdpSession: CDPSession | null = null;
  private enabled = false;

  private breakpointManager: BreakpointManager;
  private executionController: ExecutionController;

  // 保留现有的 sub-manager 引用
  private _watchManager: WatchExpressionManager | null = null;
  private _xhrManager: XHRBreakpointManager | null = null;
  private _eventManager: EventBreakpointManager | null = null;
  private _blackboxManager: BlackboxManager | null = null;

  constructor(private collector: CodeCollector) {
    this.breakpointManager = new BreakpointManager(() => this.requireSession());
    this.executionController = new ExecutionController(() => this.requireSession());
  }
```

- [ ] **Step 2: 将断点方法改为委托**

```typescript
async setBreakpointByUrl(params: { ... }): Promise<string> {
  return this.breakpointManager.setBreakpointByUrl(params);
}
```

所有断点方法（7 个）改为一行委托。

- [ ] **Step 3: 将执行控制方法改为委托**

```typescript
async pause(): Promise<void> {
  return this.executionController.pause();
}
```

所有执行控制方法（5 个）改为一行委托。

- [ ] **Step 4: 删除已提取的私有属性和方法**

将 `breakpoints` Map, `pauseOnExceptionsState`, `pausedState`, `pausedResolvers` 等相关属性从 DebuggerManager 中删除（已在 strategy 类中）。

**注意**：`init`/`enable`/`disable` 方法中如果有对断点或执行状态的初始化/清理，改为调用 breakpointManager/executionController 的对应方法（如果需要新增 init/cleanup 方法的话）。

---

### Task 3.5: 添加 BreakpointManager 单元测试

**Files:**

- Create: `tests/unit/modules/debugger/BreakpointManager.test.ts`
- Create: `tests/unit/modules/debugger/ExecutionController.test.ts`

- [ ] **Step 1: 编写 BreakpointManager 测试**

Mock `CDPSession` 的 `send` 方法验证参数传递：

```typescript
import {describe, it} from 'node:test';
import assert from 'node:assert';
import {BreakpointManager} from '../../../src/modules/debugger/BreakpointManager.js';

describe('BreakpointManager', () => {
  it('setBreakpointByUrl validates and calls CDP', async () => {
    let sentMethod = '';
    let sentParams: any = {};
    const mockSession = {
      async send(method: string, params: any) {
        sentMethod = method;
        sentParams = params;
        return {breakpointId: 'bp-1', locations: []};
      },
    } as any;

    const mgr = new BreakpointManager(() => mockSession);
    const id = await mgr.setBreakpointByUrl({
      url: 'https://example.com/script.js',
      lineNumber: 42,
    });

    assert.strictEqual(id, 'bp-1');
    assert.strictEqual(sentMethod, 'Debugger.setBreakpointByUrl');
    assert.strictEqual(sentParams.lineNumber, 42);
  });
});
```

- [ ] **Step 2: 编写 ExecutionController 测试**

验证 pause/resume/stepInto 等方法向 CDP 发送正确的 `Debugger.*` 命令。

---

### Task 3.6: 运行验证并提交

- [ ] **Step 1: 构建 + 类型检查 + 单元测试**

```bash
npm run build && npm run typecheck && npm run test:unit
```

- [ ] **Step 2: 格式检查**

```bash
npm run check-format
```

- [ ] **Step 3: 确认文件大小**

```bash
wc -l src/modules/debugger/DebuggerManager.ts
wc -l src/modules/debugger/BreakpointManager.ts
wc -l src/modules/debugger/ExecutionController.ts
```

- [ ] **Step 4: 提交**

```bash
git add src/modules/debugger/DebuggerManager.ts src/modules/debugger/BreakpointManager.ts src/modules/debugger/ExecutionController.ts tests/unit/modules/debugger/BreakpointManager.test.ts tests/unit/modules/debugger/ExecutionController.test.ts
git commit -m "refactor(debugger): split DebuggerManager into BreakpointManager + ExecutionController

Extract breakpoint management and execution control into separate strategy modules.
DebuggerManager remains as facade with CDP session lifecycle and sub-manager coordination."
```
