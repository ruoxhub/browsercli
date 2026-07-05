# Script Source 持久化缓存设计

**日期：** 2026-07-05  
**状态：** 待实现

## 目标

`get_script_source` 工具获取的脚本源码持久化到本地 `~/.browsercli/cache/script/` 目录，使得跨浏览器会话的脚本源码可复用，避免重复 CDP 请求。

## 缓存目录与文件结构

```
~/.browsercli/cache/script/
├── a1b2c3d4e5f6....js   ← MD5("https://example.com/app.js")
├── f6e5d4c3b2a1....js   ← MD5("https://cdn.example.com/lib.js")
└── ...
```

- 目录：`~/.browsercli/cache/script/`（使用 `USER_CONFIG_DIR_NAME` 常量）
- 文件命名：`<MD5(url)>.js`
- 文件内容：**原始源码**（不格式化），直接按 `.js` 文本存储
- 内联脚本（无 URL）：不缓存

## 新增组件：ScriptSourceCache

**文件：** `src/utils/ScriptSourceCache.ts`

### API

```typescript
class ScriptSourceCache {
  /** 尝试从缓存读取脚本源码。未命中返回 null。 */
  get(url: string): string | null;

  /** 将脚本源码写入缓存。内联脚本（无 url）跳过。 */
  set(url: string, source: string): void;

  /** 判断指定 URL 是否已有缓存。 */
  has(url: string): boolean;

  /** 获取缓存统计信息。 */
  stats(): { totalFiles: number; totalSize: number; cacheDir: string };
}
```

- **纯同步**：所有方法同步文件 I/O，适合 MCP 工具 handler 低延迟要求
- **懒创建目录**：首次 `set()` 或 `get()` 时自动 `mkdir`
- **无 TTL 过期**：脚本源码不因时间失效，用户手动删除目录即可清理
- **空 URL 直接跳过**：不写入、不产生垃圾文件

### 存储格式

每个 `.js` 文件直接包含原始脚本源码，无额外元数据包装。

## 修改点：get_script_source handler

**文件：** `src/tools/debugger/index.ts`

### 缓存读取（handler 开头）

```typescript
// 尝试从缓存读取
const script = debuggerContext.getScriptById(scriptId);
const scriptUrl = script?.url;
if (scriptUrl) {
  const cached = scriptSourceCache.get(scriptUrl);
  if (cached) {
    source = cached;
    // 跳过 CDP，走后续行范围/偏移/格式化逻辑
  }
}
```

### 缓存写入（CDP 获取成功后）

```typescript
// 成功从 CDP 获取源码后
if (source && script?.url) {
  scriptSourceCache.set(script.url, source);
}
```

### 调用链

```
MCP Handler (index.ts)
  ├─ ScriptSourceCache.get(url)  ← 先查缓存
  ├─ debuggerContext.getScriptSource(scriptId) → CDP  ← 缓存未命中时走 CDP
  └─ ScriptSourceCache.set(url, source)                ← CDP 成功后写入
```

缓存在**工具层**而非 `ScriptManager` 层注入，原因：
- `ScriptManager` 职责是 CDP 交互，不应感知持久化
- 工具层 handler 拥有完整请求上下文
- 遵循关注点分离

## 边界情况

| 情况 | 行为 |
|------|------|
| 内联脚本（无 URL） | `get()`/`set()` 直接跳过，不报错 |
| 同一 URL 多次请求 | 第二次命中缓存，跳过 CDP |
| CDN query string（`?v=2`） | 视为不同 URL，缓存 key 不同 |
| 缓存文件损坏 | `get()` 捕获异常，返回 null，走 CDP |
| 磁盘写入失败 | `set()` 静默失败，不影响主流程 |

## 验证

**单元测试：** `tests/unit/utils/ScriptSourceCache.test.ts`
- 写入 → 读取 → 内容一致
- 不存在 URL → `get()` 返回 `null`
- 空 URL → `set()` 不写入文件
- 重写同一 URL → 覆盖旧文件
- `stats()` 统计文件数和大小

运行：`npm run test:unit`
