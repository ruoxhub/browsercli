# Script Source 临时磁盘缓存设计

**日期：** 2026-07-05
**状态：** 待实现

## 目标

将 `ScriptManager` 中的脚本源码从内存（`ScriptInfo.source`）改为磁盘临时文件（`ScriptInfo.sourcePath`），降低运行时内存占用，同一会话内脚本源码可复用。

## 改动范围

**仅改动 `src/modules/debugger/ScriptManager.ts`**，不新增文件，不修改 MCP 工具层。

## ScriptInfo 变更

```typescript
// 删除
source?: string;

// 新增
sourcePath?: string; // 指向 os.tmpdir()/browsercli-scripts/<MD5(url)>.js
```

## 临时缓存目录

```
os.tmpdir()/browsercli-scripts/
├── a1b2c3d4e5f6....js   ← MD5("https://example.com/app.js")
├── f6e5d4c3b2a1....js   ← MD5("https://cdn.example.com/lib.js")
└── ...
```

- 文件命名：`<MD5(url)>.js`
- 内联脚本（无 URL）：不写文件，`sourcePath` 为 `undefined`
- 目录懒创建：首次 `loadScriptSource()` 时 `mkdirSync`

## 新增私有辅助方法

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
```

## loadScriptSource 修改

```typescript
// 原：script.source = scriptSource;
// 改为：
private ensureCacheDir(): string { ... }  // 懒创建临时目录
private cacheFilePath(url: string): string { ... }  // 生成文件路径

// loadScriptSource 中：
const filePath = this.cacheFilePath(script.url);
fs.writeFileSync(filePath, scriptSource, 'utf-8');
script.sourcePath = filePath;
```

## 消费者适配

`ScriptManager` 内部所有原本读取 `script.source` 的地方改为调用 `this.readSource(scriptId)`：

| 方法                        | 原读取方式                         | 改为                                               |
| --------------------------- | ---------------------------------- | -------------------------------------------------- |
| `collectMatchesInScript`    | `script.source!`                   | `this.readSource(script.scriptId)`                 |
| `getBeautifiedScriptSource` | `script.source` / `!script.source` | `!script.sourcePath` / `this.readSource(scriptId)` |
| `buildKeywordIndex`         | 参数 `content: string`             | 调用方先 `readSource()` 再传入（保持不变）         |
| `chunkScript`               | 参数 `content: string`             | 同上                                               |
| `extractFunctionTree`       | `script.source`                    | `this.readSource(scriptId)`                        |
| `searchInScriptsEnhanced`   | 间接通过 keywordIndex              | 不直接读 source，不受影响                          |

## 清理

```typescript
clear(): void {
  // 新增：删除所有临时文件
  for (const script of this.scripts.values()) {
    if (script.sourcePath) {
      try { fs.unlinkSync(script.sourcePath); } catch { /* 忽略 */ }
    }
  }
  // 原有逻辑...
}
```

`close()` 调用 `clear()`，自然附带清理。

## 边界情况

| 情况                  | 行为                                              |
| --------------------- | ------------------------------------------------- |
| 内联脚本（无 URL）    | 不写文件，`sourcePath` 为 `undefined`             |
| 同一 URL 多次请求     | 复用已有 `sourcePath`，不重复写入                 |
| 临时文件被外部删除    | `readSource()` 返回 `null`，调用方需重新走 CDP    |
| 磁盘写入失败          | `loadScriptSource()` 返回 `false`，行为与当前一致 |
| `clear()` / `close()` | 删除所有 `.js` 临时文件                           |

## 验证

`npm run test:unit` 现有的 `ScriptManager` 相关测试需要更新（删除对 `source` 属性的断言，改为验证 `sourcePath`）。
