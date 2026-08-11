# jshookmcp 功能迁移设计

> 状态：已批准 · 日期：2026-08-11 · 首期交付：SourceMap 完整链路 · 迁移方式：Clean-room 行为重写，不复制 AGPL 实现

## 1. 摘要

本设计定义从 `open-source/jshookmcp` 吸收可复用能力的整体路线，并把第一阶段 SourceMap 能力细化到可实施程度。

迁移不是逐目录复制。当前项目已经具备浏览器、网络、Debugger、Hook、WASM、工作流和任务证据链等主干能力；新工作只补经过差距分析确认的能力缺口，并遵循当前项目的 `Observe-first`、`Hook-preferred`、`Breakpoint-last`、`Evidence-first` 方法论。

第一阶段新增一个独立的 `SourceMapService` 深模块和五个显式 MCP 工具：

- `sourcemap_discover`
- `sourcemap_parse`
- `sourcemap_lookup`
- `sourcemap_reconstruct_tree`
- `sourcemap_diff`

SourceMap 获取、解析和查询默认只读；只有 `sourcemap_reconstruct_tree` 能显式写盘。首期不自动解析 `scriptParsed` 事件，不自动映射控制台堆栈，不提供原始源码断点，也不改变默认浏览器启动、CDP 懒激活或零 JS 注入策略。

## 2. 背景与问题

当前 `ScriptManager` 已记录脚本的 `scriptId`、生成代码 URL 和 `sourceMapURL`，但缺少一条从 SourceMap 发现、安全获取、规范解析、位置查询到源码树重建的完整链路。用户目前需要手动下载和解析 `.map`，难以把结果稳定纳入逆向任务证据。

`jshookmcp` 包含 SourceMap、GraphQL、V8 inspector、Canvas、WebGPU、Electron、原生进程与移动端等多个能力域，但其代码采用 AGPL-3.0-only 许可证，而当前项目采用 Apache-2.0。直接复制 handler、类型、测试或派生实现会造成不兼容的许可证风险，因此本项目只迁移经批准的外部行为和测试场景，并使用独立设计与实现。

## 3. 目标

### 3.1 第一阶段目标

- 支持 Source Map v3 普通映射、内联 `data:`、外部 `.map` 和 indexed sections。
- 支持 indexed sections 中的内嵌 `map` 与外部 `url`；外部 section 继续遵循统一获取和安全策略。
- 使用 `@jridgewell/trace-mapping` 完成 VLQ、映射查询和 indexed map 核心处理，并把它提升为直接依赖。
- 识别并保留 debug-id、ignore-list、scope/range 类元数据以及未知扩展字段，不在首期解释完整 v4 scope 语义。
- 提供五个明确、可组合的 MCP 工具。
- 解析结果仅保存在有界进程内缓存，通过 opaque `mapId` 复用。
- 显式提供 `taskId` 时默认把重建源码写入对应逆向任务目录；未提供任务时要求显式、安全的输出目录。
- 对跨源获取、私网访问、协议、重定向、体积和输出路径实施明确限制。
- 新模块相关测试覆盖率达到 80% 以上，并覆盖主要行为与安全失败路径。

### 3.2 整体迁移目标

- 给出 jshookmcp 能力的分波次迁移方向。
- 优先复用当前项目的模块和工具，不建立平行实现。
- 把平台相关、高权限或高安全面的能力隔离到可选扩展，而不是核心运行时。
- 每个后续波次在实施前单独完成差距分析、brainstorming 和设计审批。

## 4. 非目标

第一阶段明确不包含：

- `scriptParsed` 时自动下载或解析 SourceMap。
- 自动改写控制台消息、异常堆栈或网络响应。
- 原始源码断点、断点回映或调试器自动跳转。
- 下载缺失的 `sourcesContent`；缺失项只记录到结果和 manifest。
- 完整 Source Map v4 scope/range 语义。
- 持久化原始 map 或解析缓存。
- 新增启动期 `Debugger.enable`、`Network.enable` 或其他 eager CDP 激活。
- 新增页面启动脚本或 `StealthScripts2025` 隐式注入。
- 复制或改写 jshookmcp 的 AGPL handler、类型、测试和实现细节。

整体路线明确排除：

- jshookmcp 的服务壳、CLI、配置维护与更新命令。
- 与当前 BrowserManager、Debugger、Network、Hook、Workflow 重复的平行实现。
- `exploit-dev` 攻击链、ROP 验证和默认 CAPTCHA 自动求解。
- 未经独立安全设计的代理守护进程、进程管理或高权限原生操作。

## 5. 迁移原则与许可证边界

### 5.1 Ponytail 复用顺序

实施前按以下顺序停止在第一个可用层级：

1. 复用 `ScriptManager` 已保存的 SourceMap 引用。
2. 复用完整、未截断的现有 Network/CDP 响应证据。
3. 复用当前 BrowserContext 的同源会话请求能力。
4. 复用现有 `RuntimeServices`、ToolRegistry、响应管线、任务目录和 `fsSafe`。
5. 复用已安装的 `@jridgewell/trace-mapping`，不自写 VLQ 解析器。
6. 只新增 SourceMap 领域自身不可替代的最小代码。

### 5.2 Clean-room 规则

- 实现人员只依据本规格、官方 Source Map 规范和 permissive 上游依赖文档编码。
- 实现阶段不得打开、复制或逐行改写 jshookmcp 的 SourceMap handler、类型和测试源码。
- 测试夹具从公开格式规范独立构造，不使用 jshookmcp fixture。
- 依赖、源码和构建产物中不得出现对 jshookmcp 包或内部路径的引用。
- 如果某项行为无法从本规格或公开规范确定，停止并补充规格，不以 AGPL 实现作为答案。

## 6. 整体迁移路线图

路线图表示优先级和架构位置，不授权后续波次直接实施。

| 波次   | 能力范围                 | 当前项目基础                                    | 迁移策略                                                                                                      | 进入条件                                       |
| ------ | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Wave 1 | SourceMap 完整链路       | ScriptManager 已有 `sourceMapURL`，缺少解析服务 | 本规格定义的独立深模块与五个薄工具                                                                            | 本规格批准                                     |
| Wave 2 | WASM 差量与 GraphQL 语义 | 已有 9 个 WASM 工具和 Network 证据              | 优先补纯 TS inspect、strings、diff、obfuscation；GraphQL 基于现有请求证据做 operation/auth/schema/replay 设计 | Wave 1 稳定；分别完成差距测试和独立规格        |
| Wave 3 | 显式 V8 运行时证据       | 已有 DebuggerManager 与性能工具                 | 评估 heap snapshot/search、allocation sampling、deopt、JIT/TurboFan、bytecode；CDP 域仅按工具显式启停         | 内存、隐私、浏览器兼容与清理策略获批           |
| Wave 4 | 场景型浏览器/桌面能力    | 已有 Page、Hook、Screenshot、Extension 基础     | Canvas scene/pick/trace、WebGPU、Electron/ASAR 分别做场景插件；需要注入时必须显式 opt-in                      | 有真实任务与可复现实例                         |
| Wave 5 | 原生与移动端扩展         | 核心运行时无跨平台原生代理职责                  | ADB/Dart、process/memory/syscall、BoringSSL、binary instrumentation、native emulation 仅以 Extension 形式进入 | 平台矩阵、权限模型、安全审查和外部依赖策略获批 |

### 6.1 复用而非迁移的能力

以下能力已经有当前项目主干，应做差量测试而不是复制：

- 浏览器生命周期、导航、输入和 stealth/cloak 分层。
- 基础 Network 请求、响应体、WebSocket 与统计能力。
- Debugger、断点、脚本收集和执行上下文。
- HookManager、HookStore、HookCodeBuilder。
- AST/去混淆、crypto 分析和 AI 服务集成。
- WASM capabilities、dump、disassemble、decompile、inspect sections、offline run、optimize、VMP trace、memory inspect。
- Workflow、Extension Registry、ReverseTaskStore 和任务证据链。

### 6.2 后续 WASM 边界

Wave 2 首选纯分析型差量：

- 无外部依赖的结构 inspect。
- section-aware 字符串提取。
- 结构化 WAT/map diff。
- 混淆特征检测。

`wasm_to_c`、二进制重写、函数级或 basic-block instrumentation 会写产物并改变运行语义，必须在独立设计中评估，不因 Wave 2 自动进入实现范围。

## 7. 第一阶段架构

### 7.1 总体结构

```text
MCP tools: discover / parse / lookup / reconstruct_tree / diff
                           |
                           v
                   SourceMapService
                   |- SourceMapResolver
                   |- SourceMapDocument
                   |- bounded internal cache
                   `- SourceMapReconstructor
                           |
              existing runtime adapters and fsSafe
```

工具层只负责 schema、`Context` 取值、运行时适配和统一响应。SourceMap 业务规则全部位于 `src/modules/sourcemap/`。

### 7.2 模块职责

#### `SourceMapService.ts`

- 唯一公共门面。
- 编排发现、解析、查询、diff 和重建流程。
- 持有有界缓存；首期不单独创建公共 Cache 抽象。
- 生成不可猜测、进程内有效的 `mapId`。
- 生产运行时由 `RuntimeServices` 延迟初始化。

#### `SourceMapResolver.ts`

- 解析 `scriptId`、生成脚本 URL、`sourceMapURL`、直接 URL、`data:` 和直接内容。
- 只读取完整、未截断的已有网络证据。
- 在证据缺失时执行受控同源或显式跨源获取。
- 解析 indexed section 的相对 URL，并实施循环、深度、数量和累计体积限制。
- 返回内容、规范基准 URL、来源证明和警告，不负责映射查询。

#### `SourceMapDocument.ts`

- 校验和归一化 v3 普通映射与 indexed map。
- 在外部 section 被 Resolver 物化后交给 `@jridgewell/trace-mapping`。
- 提供正向/反向位置查询、coverage、mapping 统计和有界 diff。
- 保存 debug-id、ignore-list、scope/range 类字段和未知扩展字段。
- 不依赖 Page、CDP、Network 或文件系统，便于纯单元测试。

#### `SourceMapReconstructor.ts`

- 根据 `sourceRoot`、`sources` 和 `sourcesContent` 生成安全文件树计划。
- 中和路径穿越、URL scheme、authority、Windows 保留名和文件名冲突。
- 使用现有安全路径能力校验根目录与最终路径。
- 默认不覆盖；写入文件后最后生成 manifest。
- 不获取缺失源码。

#### `types.ts`

- 定义服务输入输出、来源证明、错误码、解析摘要和 manifest。
- 类型只服务 SourceMap 模块和薄工具，不扩张全局公共类型面。

### 7.3 运行时接线

- `RuntimeServices` 新增 `getSourceMapService()` lazy getter。
- 高扇入 `Runtime` 接口只新增可选属性 `sourceMapService?: SourceMapService`，避免破坏测试桩和已有调用方。
- 生产 `getRuntime()` 始终暴露该属性的 getter。
- 浏览器和网络能力不注入纯解析核心；工具调用时通过窄的 `SourceMapResourceAccess` 适配接口传入。
- `ScriptManager` 保持现有职责，只提供 `scriptId`、URL 和 `sourceMapURL`。
- SourceMap 工具归入 `full` tool profile。

### 7.4 建议文件布局

```text
src/modules/sourcemap/
  SourceMapService.ts
  SourceMapResolver.ts
  SourceMapDocument.ts
  SourceMapReconstructor.ts
  types.ts

src/tools/sourcemap/
  index.ts
  manifest.ts
```

五个工具首期放在一个 `index.ts` 中；只有出现明确维护压力时才拆成每工具一文件。

## 8. SourceMap 格式支持

### 8.1 v3

必须支持：

- 普通 map：`version`、`file`、`sourceRoot`、`sources`、`sourcesContent`、`names`、`mappings`。
- Base64 和 percent-encoded JSON `data:` URI。
- 相对或绝对外部 `.map`。
- indexed map 的 `sections[].offset`。
- indexed section 的内嵌 `map`。
- indexed section 的外部 `url`，相对父 map URL 解析。

外部 section 物化规则：

- 最大嵌套深度默认 8。
- 单个顶层 map 的 section 总数默认最多 1,000。
- 使用规范 URL 集合检测循环引用。
- 顶层和所有 section 的解码后内容累计计入同一个体积预算。
- 每个外部 section 复用与顶层 URL 相同的跨源、协议、DNS、重定向和超时策略。

### 8.2 v4 与扩展元数据

首期兼容策略是“识别并保留，暂不解释”：

- 返回识别到的 debug-id、`x_google_ignoreList` 和 scope/range 类顶层字段。
- 未知顶层字段保存在 `extensions` 摘要中；大字段不直接回传完整内容，只返回字段名、类型、大小或哈希。
- v3 可解析部分仍可查询。
- 需要完整 v4 scope/range 解释的操作返回明确 warning，而不是静默猜测。

## 9. 五个 MCP 工具契约

### 9.1 统一约定

- 响应沿用 `{ success, message, tooltype, data }`。
- 公共位置使用 `line` 1-based、`column` 0-based，并在响应中回显约定。
- `mapId` 是 `sm_` 前缀的随机 opaque ID，不暴露内容哈希。
- 工具返回有界摘要，不把完整 map 或完整源码塞入 MCP 响应。
- 互斥输入在 schema 能表达时使用 schema；跨字段互斥和条件要求在 handler 边界再次校验。

### 9.2 `sourcemap_discover`

用途：从当前 `ScriptManager` 已知脚本中发现 SourceMap 引用，不下载、不解析。

输入：

```ts
interface SourcemapDiscoverInput {
  scriptId?: string;
  urlPattern?: string;
  limit?: number; // default 100, max 1000
}
```

行为：

- `scriptId` 存在时精确查询。
- `urlPattern` 是对生成脚本 URL 的大小写敏感字面量子串匹配，不解释为正则或 glob。
- 两者都缺省时列出当前页有 SourceMap 引用的脚本。
- 不激活新的 CDP 域。

主要输出：

- `scriptId`
- `generatedUrl`
- 脱敏后的 `sourceMapURL`
- `kind: inline | external`
- `resolvable`
- `warnings`

### 9.3 `sourcemap_parse`

用途：从三种互斥来源之一获取并解析 map，缓存后返回 `mapId`。

输入：

```ts
interface SourcemapParseInput {
  scriptId?: string;
  mapUrl?: string;
  mapContent?: string;
  generatedUrl?: string;
  allowCrossOrigin?: boolean; // default false
}
```

约束：

- `scriptId`、`mapUrl`、`mapContent` 必须且只能提供一个。
- 相对 `mapUrl` 必须提供 `generatedUrl` 作为基准。
- 直接 `mapContent` 可选 `generatedUrl`，用于解析 `sourceRoot` 和相对 source；缺失时只做逻辑路径解析。
- 无当前页/脚本来源的网络 URL 视为跨源，要求 `allowCrossOrigin=true`。

主要输出：

- `mapId`
- `cacheHit`
- 来源证明：输入类型、脱敏 URL、是否来自完整捕获、同源请求或显式跨源请求。
- `version`
- `indexed`
- `sourcesCount`
- `namesCount`
- `sectionsCount`
- `sourcesContentCoverage: { present, missing, ratio }`
- `mappingStats`
- `debugId`
- `ignoreList`
- `extensions`
- `warnings`

### 9.4 `sourcemap_lookup`

用途：对已缓存 map 做单点双向位置查询。

输入：

```ts
interface SourcemapLookupInput {
  mapId: string;
  direction: 'generated_to_original' | 'original_to_generated';
  line: number;
  column: number;
  source?: string;
  bias?: 'greatest_lower_bound' | 'least_upper_bound';
}
```

约束：

- `original_to_generated` 必须提供 `source`。
- `generated_to_original` 忽略并拒绝多余 `source`，保持输入明确。
- 无映射属于正常结果：`success=true`、`match=null`。

主要输出：

- 规范化输入位置。
- `match`：生成或原始位置、source、name、命中 bias。
- `exact`。
- 坐标约定。

### 9.5 `sourcemap_reconstruct_tree`

用途：把 `sourcesContent` 显式重建为安全文件树。

输入：

```ts
interface SourcemapReconstructTreeInput {
  mapId: string;
  taskId?: string;
  outputDir?: string;
  overwrite?: boolean; // default false
}
```

行为：

- 提供已存在的 `taskId` 且未给 `outputDir` 时，默认写入该任务根下 `sourcemap/<mapId>/`。
- 提供任务目标时必须先通过 `ReverseTaskStore` 验证任务存在并取得任务目录，不得把未经验证的 `taskId` 直接拼接为路径。
- `taskId` 和 `outputDir` 都未提供时返回 `OUTPUT_PATH_REQUIRED`；项目不引入隐式“当前任务”全局状态。
- 同时提供 `taskId` 与 `outputDir` 时，以显式 `outputDir` 为准，`taskId` 只进入结果和 manifest 的关联信息。
- 显式 `outputDir` 经过现有 `fsSafe` 与根目录危险目标检查。
- 只写 `sourcesContent` 已有内容。
- 默认不覆盖任何现有文件。

主要输出：

- `rootDir`
- `manifestPath`
- `written`
- `skipped`
- `missing`
- `collisions`
- 有界文件列表和完整计数。

### 9.6 `sourcemap_diff`

用途：比较两个已缓存 map 的结构、source 内容和映射变化。

输入：

```ts
interface SourcemapDiffInput {
  leftMapId: string;
  rightMapId: string;
  mode?: 'summary' | 'sources' | 'mappings'; // default summary
  maxChanges?: number; // default 200, max 2000
}
```

输出按 mode 逐级增加：

- `summary`：版本、indexed 状态、debug-id、extension、source/mapping 数量和 coverage 变化。
- `sources`：source 增删、路径变化、`sourcesContent` 哈希变化。
- `mappings`：在上述结果上增加有界位置差异。
- 所有模式都返回完整差异计数和 `truncated`，不因响应截断丢失总量。

## 10. 获取与解析数据流

### 10.1 获取优先级

按以下顺序命中即停止：

1. 直接 `mapContent` 或 `data:` URI，本地解码。
2. 与 map URL 精确对应且能证明完整、未截断的现有 Network/CDP 响应体。
3. 同源 URL 通过当前 BrowserContext 的请求能力显式获取，复用会话 Cookie，但不执行页面 JS。
4. 跨源 URL 仅在 `allowCrossOrigin=true` 时通过受控请求获取。

如果现有网络缓存无法证明响应完整，必须视为未命中，不得尝试解析截断内容。

### 10.2 同源定义

- 使用生成脚本 URL或当前页 URL的规范 origin 作为基准。
- scheme、hostname 和有效端口全部相同才是同源。
- 没有可信 origin 基准的直接网络 URL按跨源处理。
- 同源目标可以是用户正在调试的本地站点；私网拒绝规则只强制用于跨源兜底。

### 10.3 跨源与 SSRF 规则

- 默认拒绝跨源。
- 仅允许 `http:` 和 `https:`。
- 拒绝 URL credentials、`file:`、`ftp:`、`blob:`、`javascript:` 等协议；`data:` 只走本地解码路径。
- DNS 解析后拒绝 loopback、link-local、private、unspecified 和其他非公网 IPv4/IPv6 地址。
- 跨源请求必须连接到已校验的解析地址，或校验实际 socket 远端地址；只做请求前 DNS 查询不足以防止 rebinding。运行时无法保证这一点时返回 `FETCH_BLOCKED`。
- 最多跟随 3 次重定向，每一跳重新执行协议、credentials、origin、DNS 和体积预检。
- `Content-Length` 存在时先检查；响应体流式读取并在达到上限时立即中止，完成后再次按解码字节硬校验。
- 任何一跳失败都丢弃未完成内容，不进入解析或缓存。
- 日志、响应来源证明和 manifest 对 credentials 与 query 参数值脱敏。
- 不持久化 Cookie、Authorization、响应头或请求凭证。

### 10.4 资源限制

默认值：

| 限制                                          |  默认值 |  硬上限 |
| --------------------------------------------- | ------: | ------: |
| 单个顶层 map 及其外部 sections 的累计解码内容 |  20 MiB | 100 MiB |
| 缓存 entry 数                                 |      16 |      64 |
| 缓存原始内容总量                              |  64 MiB | 256 MiB |
| 空闲 TTL                                      | 30 分钟 | 24 小时 |
| indexed map 嵌套深度                          |       8 |      16 |
| indexed section 总数                          |   1,000 |  10,000 |
| 重定向                                        |       3 |       3 |
| 网络请求超时                                  |   15 秒 |   60 秒 |
| diff 明细                                     |     200 |   2,000 |

可配置项通过现有配置解析路径读取，禁止直接散落读取 `process.env`。至少提供以下环境键：

- `SOURCEMAP_MAX_BYTES`
- `SOURCEMAP_CACHE_MAX_BYTES`
- `SOURCEMAP_CACHE_MAX_ENTRIES`
- `SOURCEMAP_CACHE_TTL_MS`
- `SOURCEMAP_FETCH_TIMEOUT_MS`

配置值必须是有限正整数并限制到硬上限。缓存容量不得小于单 map 上限；配置冲突时启动不失败，SourceMapService lazy 初始化时返回明确配置错误。

## 11. 缓存模型

- 仅存在于 worker 进程内。
- 缓存键包含完全物化后的规范 map（包括所有外部 indexed sections）SHA-256、规范 map URL或解析基准 URL；相同顶层 map 引用到不同 section 内容时不会错误复用，相同内容在不同 base 下也不会错误复用。
- `mapId` 使用密码学随机字节生成，不使用内容哈希作为外部 ID。
- 同一缓存键再次 parse 返回现有 `mapId` 并更新 LRU/TTL。
- 淘汰同时受 entry 数、原始内容总量和空闲 TTL 控制；任一上限触发都可回收。
- worker 重启、TTL 或 LRU 淘汰后，旧 `mapId` 返回 `MAP_NOT_FOUND`，调用方必须重新 parse。
- 缓存不写入任务目录，也不作为持久证据。
- 缓存统计可以进入调试日志，但不得包含源码内容、Cookie 或未脱敏 URL。

## 12. 源码树重建规则

### 12.1 路径归一化

每个 `sourceRoot + source` 依次执行：

1. 统一 `/` 和 `\` 分隔符。
2. 去除 URL scheme、authority、query 和 fragment，只保留逻辑路径。
3. 去除盘符与绝对路径根。
4. 折叠 `.` 和 `..`，不得越过逻辑根。
5. 替换 NUL、控制字符和当前平台非法文件名字符。
6. 处理 Windows 设备保留名和尾随点/空格。
7. 空路径使用 `source-<index>`。

归一化后仍必须验证最终 resolved path 位于输出根目录内。已存在 symlink 的路径段按真实路径校验；无法安全确认时拒绝写入。

### 12.2 冲突与覆盖

- 多个 source 归一化到同一路径时，首个保留原名，后续使用 `~<content-hash-prefix>` 确定性后缀。
- 内容相同的冲突仍记录到 manifest，可复用同一文件但不得静默丢失 source 映射。
- `overwrite=false` 时任何已存在目标都记为 skipped，不修改。
- `overwrite=true` 仅允许覆盖输出根内的普通文件，不跟随最终目标 symlink。
- 文件写入采用同目录临时文件后原子替换；manifest 最后写入。

### 12.3 Manifest

manifest 至少包含：

- `mapId`
- 脱敏后的 map 来源
- 生成时间与格式版本
- 每个原始 source 到输出相对路径的映射
- 内容 SHA-256 与字节数
- written、skipped、missing、collision 状态
- 路径归一化 warning
- coverage 与汇总计数

Manifest 不包含 Cookie、Authorization、完整 query secret 或原始 map 内容。

## 13. 错误模型

稳定失败码：

| 错误码                          | 含义                                                  |
| ------------------------------- | ----------------------------------------------------- |
| `INVALID_SOURCE_INPUT`          | parse 来源未提供、提供多个或条件字段缺失              |
| `SCRIPT_NOT_FOUND`              | 当前 ScriptManager 中不存在指定脚本                   |
| `SOURCEMAP_REFERENCE_NOT_FOUND` | 脚本没有可用 SourceMap 引用                           |
| `FETCH_BLOCKED`                 | 跨源未授权、协议、DNS、credentials 或重定向被策略拒绝 |
| `FETCH_TOO_LARGE`               | Content-Length 或实际解码内容超过限制                 |
| `FETCH_TIMEOUT`                 | 请求超时                                              |
| `INDEXED_MAP_LIMIT_EXCEEDED`    | section 深度、数量、循环或累计体积超限                |
| `PARSE_FAILED`                  | JSON、v3 结构或 mapping 无法解析                      |
| `UNSUPPORTED_SEMANTICS`         | 请求依赖首期不解释的 v4 语义                          |
| `MAP_NOT_FOUND`                 | `mapId` 不存在或已淘汰                                |
| `OUTPUT_PATH_REQUIRED`          | 未提供 `taskId` 或输出目录                            |
| `PATH_BLOCKED`                  | 输出根或目标路径不安全                                |
| `OUTPUT_EXISTS`                 | 不允许覆盖的目标已经存在                              |
| `SOURCEMAP_CONFIG_INVALID`      | lazy 初始化时发现 SourceMap 限制配置冲突              |

位置没有映射、source 没有 `sourcesContent`、diff 没有差异都属于成功结果，不抛异常。

错误消息不得包含响应体、Cookie、Authorization 或未脱敏 URL。底层库异常转换为稳定错误码后，可把安全的 cause 摘要写入 debug 日志。

## 14. 测试设计

使用现有 `node:test`，不新增测试框架。

### 14.1 单元测试

`SourceMapDocument`：

- 普通外部 v3 fixture。
- Base64 与 percent-encoded inline fixture。
- 内嵌 indexed sections 与 section offset 边界。
- 外部 section 物化后的 indexed map。
- `sourceRoot` 和相对 source。
- 缺失或部分 `sourcesContent` coverage。
- generated-to-original 与 original-to-generated。
- 两种 bias 和无命中结果。
- debug-id、ignore-list、scope/range 与未知字段保留。
- summary、sources、mappings diff 及截断计数。
- 错误 JSON、错误 version、非法 mappings。

`SourceMapResolver`：

- 直接内容和两类 `data:`。
- `scriptId` 到 URL 的解析。
- 完整网络证据命中；截断或完整性未知时不命中。
- BrowserContext 同源兜底。
- 跨源默认拒绝和显式允许。
- URL credentials、非法协议、私网 IPv4/IPv6、DNS 结果、重定向逐跳拒绝。
- Content-Length 预检、实际体积超限和超时。
- 外部 section 相对 URL、循环、深度、数量和累计体积限制。

`SourceMapService`：

- lazy 创建后缓存命中。
- 缓存键包含 base URL。
- entry、字节和 TTL 淘汰。
- 淘汰后 `MAP_NOT_FOUND`。
- opaque ID 不等于内容哈希。

`SourceMapReconstructor`：

- 正常树重建与 manifest。
- `../`、绝对路径、URL、盘符、NUL、Windows 保留名。
- 同名同内容和同名不同内容冲突。
- 缺失 `sourcesContent`。
- 默认不覆盖和显式覆盖。
- symlink 路径拒绝。
- 中途写入失败时不留下完成态 manifest。

### 14.2 工具测试

- 五个工具全部进入 sourcemap manifest 和 generated registry。
- profile 为 `full`。
- schema 默认值、互斥来源和条件字段校验。
- 统一响应 envelope、tooltype 和稳定错误码。
- lookup 无命中仍为 success。
- reconstruct 是唯一带写副作用的 SourceMap 工具注解。

### 14.3 集成测试

- 模拟当前页脚本、完整捕获响应和同源请求，验证 discover → parse → lookup。
- 两次 parse 得到 cache hit 和同一 `mapId`。
- 两个 map 的 parse → diff。
- 显式 `taskId` 下 parse → reconstruct，并验证任务目录、manifest 与路径。
- 无 `taskId` 且无 outputDir 时拒绝。
- SourceMap 工具调用前服务未初始化；第一次调用后初始化一次。
- SourceMap 调用不会触发浏览器启动期 eager CDP 或全局 JS 注入。

### 14.4 Property 测试

- 任意生成的 source 路径都不能让最终文件逃出输出根。
- 任意合法 section offset 序列归一化后保持单调和 section 边界。
- 任意缓存访问序列都不超过 entry 和字节上限。

### 14.5 覆盖率与验证命令

- `src/modules/sourcemap/` 相关语句和分支覆盖率目标至少 80%。
- 最终代码修改后必须重新运行：

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:property
npm run check-format
```

如果全量套件因仓库已有无关失败受阻，交接必须给出新鲜的相关测试结果、完整失败输出和与本次 diff 无关的证据，不得把修改前结果作为完成证明。

## 15. 预期变更面

第一阶段实施预计触及：

- `package.json` 与 lockfile：把 `@jridgewell/trace-mapping` 提升为直接依赖。
- `src/modules/sourcemap/*`：新深模块。
- `src/runtime/RuntimeServices.ts`：lazy service。
- `src/runtime.ts`：可选稳定接口扩展和生产 getter。
- `src/tools/sourcemap/index.ts`、`manifest.ts`：五个薄工具。
- 工具索引生成产物或生成脚本输出：只通过现有生成流程更新。
- `src/config/*`：SourceMap 限制配置，复用现有 resolver。
- `tests/fixtures/sourcemap/*`：独立构造的 fixture。
- `tests/unit/modules/sourcemap/*`、`tests/unit/tools/sourcemap/*`。
- `tests/integration/tools/sourcemap.integration.test.ts`。
- `tests/property/modules/sourcemap-paths.property.test.ts`。
- SourceMap 用户文档和工具参考。

不修改 `build/`，不把 jshookmcp 源码或 fixture 加入构建依赖。

## 16. 风险与缓解

| 风险                           | 缓解                                                                 |
| ------------------------------ | -------------------------------------------------------------------- |
| 大 map 导致内存尖峰            | 单 map、累计 section、缓存字节、entry、TTL 多重限制；解析前后校验    |
| 已捕获响应被截断               | 只有能证明完整的响应才复用，否则走显式获取                           |
| 跨源 URL 形成 SSRF             | 默认拒绝；显式授权；协议、credentials、DNS、私网和重定向逐跳检查     |
| indexed section 循环或爆炸     | URL 循环集合、深度、总 section 和累计体积上限                        |
| source 路径穿越或 symlink 逃逸 | 逻辑归一化、resolved/real path 双重边界、最终 symlink 拒绝           |
| SourceMap 扩展格式漂移         | v3 严格解析；扩展只保留和警告，不猜测语义                            |
| Runtime 高扇入接口破坏         | 只新增可选属性；生产 runtime 始终提供；相关 stub 测试                |
| 破坏反检测分层                 | 所有行为由工具显式触发；无启动期 CDP、无隐式 JS 注入                 |
| AGPL 许可证污染                | 实现阶段仅依据本规格和 permissive/官方上游；独立 fixture；无源码引用 |

## 17. 验收标准

第一阶段只有同时满足以下条件才算完成：

- 五个 SourceMap 工具可通过 ToolRegistry 在 `full` profile 使用。
- 普通、inline、external、indexed v3 均可解析和查询。
- indexed 外部 section 受控解析，循环与资源上限可验证。
- v4/debug-id/scope 类元数据被识别和保留，未支持语义有明确 warning。
- discover、parse、lookup、diff 默认不写磁盘。
- reconstruct 只在安全目标下显式写入，并生成完整 manifest。
- 跨源默认拒绝；跨源允许后仍拒绝私网、非法协议、credentials、危险重定向和超限内容。
- 缓存有界、可淘汰，淘汰后错误稳定。
- 不修改 ScriptManager 职责，不自动映射堆栈或断点。
- 不改变默认 CDP 懒激活、viewport、stealth/cloak 或 JS 注入行为。
- 新模块相关覆盖率达到 80% 以上。
- 最终 diff 后的类型、相关测试和格式检查通过，或明确记录无法归因于本次变更的阻塞。
- 实现和测试中不存在 jshookmcp AGPL 源码、类型、fixture 或运行时依赖。

## 18. 已确认决策

- 整体路线图 + 第一阶段可实施细化。
- 第一阶段选择 SourceMap 完整链路。
- 完整 v3；v4/debug-id/scope 元数据识别保留，语义后置。
- 只读解析和内存缓存；仅重建显式写盘。
- 完整捕获优先、同源会话请求次之、跨源显式授权。
- 五个公开工具，不拆成 jshookmcp 的七个工具形态。
- SourceMapService 独立于 ScriptManager，不做自动 Debugger 集成。
- `@jridgewell/trace-mapping` 提升为直接依赖。
- Clean-room 重写，不复制 AGPL 表达。
- 行为、安全、集成和 80% 覆盖率共同作为完成门槛。

## 19. 未决问题

无。任何实施中发现的新语义、跨平台或安全决策必须回到规格评审，不得由实现代码隐式决定。
