# Script Source 临时磁盘缓存 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `ScriptInfo.source` 从内存字符串改为磁盘临时文件路径 `sourcePath`，降低运行时内存占用。

**Architecture:** 仅修改 `ScriptManager.ts`，`loadScriptSource()` 中 CDP 获取的源码写入 `os.tmpdir()/proxycli-scripts/` 临时目录，其他方法通过新增的 `readSource()` 私有辅助方法从磁盘读取。

**Tech Stack:** Node.js `fs`, `os`, `path`, `crypto` 内置模块。

## Global Constraints

- 仅改动 `src/modules/debugger/ScriptManager.ts`，不新增文件
- 不修改 MCP 工具层（`src/tools/debugger/index.ts`）
- Node `^20.19.0 || ^22.12.0 || >=23`
- 提交采用 Conventional Commits 格式

---

### Task 1: 更新 ScriptInfo 接口并添加私有辅助方法

**Files:**

- Modify: `src/modules/debugger/ScriptManager.ts`

**Interfaces:**

- Consumes: 无
- Produces: `ScriptInfo.sourcePath?: string`, `private readSource(scriptId): string | null`, `private ensureCacheDir(): string`, `private cacheFilePath(url): string`

- [ ] **Step 1: 添加 import**

在文件顶部 `import {logger} ...` 前添加：

```typescript
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
```

- [ ] **Step 2: 修改 ScriptInfo 接口**

将第 31 行的 `source?: string;` 替换为 `sourcePath?: string;`：

```typescript
export interface ScriptInfo {
  scriptId: string;
  url: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sourceLength?: number;
  sourcePath?: string;
  hash?: string;
  sourceMapURL?: string;
}
```

- [ ] **Step 3: 在 ScriptManager 中添加 private field**

在 `private scriptChunks` 后面添加：

```typescript
private cacheDir: string | null = null;
```

- [ ] **Step 4: 添加三个私有辅助方法**

在 `clearCache()` 方法之前插入：

```typescript
private readSource(scriptId: string): string | null {
  const script = this.scripts.get(scriptId);
  if (!script?.sourcePath) return null;
  try {
    return fs.readFileSync(script.sourcePath, 'utf-8');
  } catch {
    return null;
  }
}

private ensureCacheDir(): string {
  if (this.cacheDir) return this.cacheDir;
  this.cacheDir = path.join(os.tmpdir(), 'proxycli-scripts');
  if (!fs.existsSync(this.cacheDir)) {
    fs.mkdirSync(this.cacheDir, {recursive: true});
  }
  return this.cacheDir;
}

private cacheFilePath(url: string): string {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return path.join(this.ensureCacheDir(), `${hash}.js`);
}
```

- [ ] **Step 5: 运行类型检查**

```bash
npm run typecheck
```

预期：无编译错误。

- [ ] **Step 6: Commit**

```bash
git add src/modules/debugger/ScriptManager.ts
git commit -m "refactor(debugger): replace ScriptInfo.source with sourcePath, add temp-file helpers"
```

---

### Task 2: 修改 loadScriptSource 写入临时文件

**Files:**

- Modify: `src/modules/debugger/ScriptManager.ts:341-362`

**Interfaces:**

- Consumes: `cacheFilePath()`, `ensureCacheDir()`
- Produces: `script.sourcePath` 被写入

- [ ] **Step 1: 修改 loadScriptSource()**

将 `script.source = scriptSource;` 替换为：

```typescript
// 写入临时文件
if (script.url) {
  const filePath = this.cacheFilePath(script.url);
  this.ensureCacheDir();
  fs.writeFileSync(filePath, scriptSource, 'utf-8');
  script.sourcePath = filePath;
}
```

完整方法变为：

```typescript
private async loadScriptSource(script: ScriptInfo): Promise<boolean> {
  const session = this.getCDPSession();
  try {
    const {scriptSource} = await session.send('Debugger.getScriptSource', {
      scriptId: script.scriptId,
    });
    // 写入临时文件
    if (script.url) {
      const filePath = this.cacheFilePath(script.url);
      this.ensureCacheDir();
      fs.writeFileSync(filePath, scriptSource, 'utf-8');
      script.sourcePath = filePath;
    }
    script.sourceLength = scriptSource.length;

    this.buildKeywordIndex(script.scriptId, script.url, scriptSource);
    this.chunkScript(script.scriptId, scriptSource);
    return true;
  } catch (error) {
    logger.error(
      `Failed to get script source for ${script.scriptId}:`,
      error,
    );
    (script as any).loadError = error;
    return false;
  }
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

预期：无编译错误。

- [ ] **Step 3: Commit**

```bash
git add src/modules/debugger/ScriptManager.ts
git commit -m "refactor(debugger): write script source to temp file in loadScriptSource"
```

---

### Task 3: 适配所有 script.source 消费者

**Files:**

- Modify: `src/modules/debugger/ScriptManager.ts`

**Interfaces:**

- Consumes: `readSource()`
- Produces: 所有消费者改用 `readSource()` 或 `sourcePath` 判断

- [ ] **Step 1: loadSourcesForScripts() - 跳过已加载检查**

第 264 行，将 `if (script.source) continue;` 改为：

```typescript
if (script.sourcePath) continue;
```

- [ ] **Step 2: getScriptSource() - 已加载检查**

第 304 行，将 `if (!targetScript.source) {` 改为：

```typescript
if (!targetScript.sourcePath) {
```

- [ ] **Step 3: getBeautifiedScriptSource() - 读取和判断**

第 209-224 行，完整方法改为：

```typescript
async getBeautifiedScriptSource(
  scriptId: string,
  beautify: (source: string) => string,
): Promise<string> {
  const script = await this.getScriptSource(scriptId);
  if (!script) {
    throw new Error(`Script source not found: ${scriptId}`);
  }
  if (!script.sourcePath) {
    const loadError = (script as any).loadError;
    if (loadError) {
      throw new Error(`Failed to get script source for ${scriptId}: ${loadError.message || loadError}`);
    }
    throw new Error(`Script source not found: ${scriptId}`);
  }
  const source = this.readSource(scriptId);
  if (!source) {
    throw new Error(`Script source file missing: ${scriptId}`);
  }
  try {
    return beautify(source);
  } catch {
    return source;
  }
}
```

- [ ] **Step 4: collectMatchesInScript() - 读取 source**

第 465 行，将 `const lines = script.source!.split('\n');` 改为：

```typescript
const source = this.readSource(script.scriptId);
if (!source) return;
const lines = source.split('\n');
```

- [ ] **Step 5: extractFunctionTree() - 读取 source**

第 525-529 行附近，将条件中 `script.source` 改为判断 sourcePath，并将 `script.source` 改为 `readSource()`：

```typescript
const script = await this.getScriptSource(scriptId);
if (!script || !script.sourcePath) {
  throw new Error(`Script not found: ${scriptId}`);
}

const source = this.readSource(scriptId);
if (!source) {
  throw new Error(`Script source file missing: ${scriptId}`);
}

const babel = await this.loadBabel();
const ast = this.parseScriptWithBabel(babel, source, scriptId);
```

- [ ] **Step 6: 运行类型检查**

```bash
npm run typecheck
```

预期：无编译错误（`script.source` 不再存在，确保所有引用已适配）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/debugger/ScriptManager.ts
git commit -m "refactor(debugger): adapt all callers from script.source to readSource/sourcePath"
```

---

### Task 4: 更新 clear() 添加临时文件清理

**Files:**

- Modify: `src/modules/debugger/ScriptManager.ts:732-738`

**Interfaces:**

- Consumes: `script.sourcePath`
- Produces: `clear()` 中增加文件删除逻辑

- [ ] **Step 1: 修改 clear()**

```typescript
clear(): void {
  // 删除所有脚本临时文件
  for (const script of this.scripts.values()) {
    if (script.sourcePath) {
      try { fs.unlinkSync(script.sourcePath); } catch { /* 忽略 */ }
    }
  }
  this.scripts.clear();
  this.scriptsByUrl.clear();
  this.keywordIndex.clear();
  this.scriptChunks.clear();
  logger.info('ScriptManager cleared - ready for new website');
}
```

- [ ] **Step 2: 运行类型检查**

```bash
npm run typecheck
```

预期：无编译错误。

- [ ] **Step 3: Commit**

```bash
git add src/modules/debugger/ScriptManager.ts
git commit -m "feat(debugger): delete temp script files on clear()"
```

---

### Task 5: 运行全量测试

**Files:**

- 无代码修改

- [ ] **Step 1: 构建**

```bash
npm run build
```

- [ ] **Step 2: 运行单元测试**

```bash
npm run test:unit
```

- [ ] **Step 3: 检查格式**

```bash
npm run check-format
```

**注意:** 现有 test 文件中如有直接访问 `script.source` 的断言需同步修改。如有失败，按 Task 6 修复。

---

### Task 6: 修复测试（仅当 Task 5 失败时）

**Files:**

- 按测试失败输出确定具体文件

- [ ] **Step 1: 搜索测试中对 script.source 的引用**

```bash
rg "\.source\b" tests/ --type ts -l
```

- [ ] **Step 2: 逐个修复**

将测试中对 `expect(script.source)` 的断言改为适配 `sourcePath` 的语义（例如改为 `expect(script.sourcePath).toBeDefined()` 或移除对内存中 source 的断言）。

- [ ] **Step 3: 确认全部通过**

```bash
npm run test:unit
npm run typecheck
npm run check-format
```

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update tests for sourcePath migration"
```
