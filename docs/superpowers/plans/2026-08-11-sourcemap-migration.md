# SourceMap 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Reverser-CLI 增加 Source Map v3 发现、安全获取、解析、双向查询、源码树重建和差异比较的完整显式工具链。

**Architecture:** 新建 `src/modules/sourcemap/` 深模块，由 `SourceMapService` 统一编排纯解析文档、受控资源解析器、有界缓存和安全重建器。五个 MCP 工具保持薄适配，通过现有 `RuntimeServices` 延迟创建服务，并从 `ToolContextProvider` 构造窄运行时访问接口；不修改 `ScriptManager` 职责，不自动激活 Debugger/Network，不注入页面脚本。

**Tech Stack:** TypeScript ESM、Node.js `node:test`、fast-check、Zod、Patchright、`@jridgewell/trace-mapping@^0.3.31`、Node 标准库 `crypto`/`dns`/`http`/`https`/`net`/`fs`。

## Global Constraints

- Node 版本必须满足 `^20.19.0 || ^22.12.0 || >=23`。
- 仅把当前已安装的 `@jridgewell/trace-mapping` 提升为直接依赖；不得新增其他运行时依赖。
- 实现只能依据 `docs/superpowers/specs/2026-08-11-jshookmcp-migration-design.md`、官方 Source Map 规范和 permissive 上游文档；不得打开、复制或改写 jshookmcp 的 AGPL handler、类型、fixture 或测试。
- 完整支持普通、inline、external、indexed Source Map v3；indexed section 的外部 `url` 必须先安全物化为内嵌 `map`。
- v4/debug-id/ignore-list/scope/range 类字段只识别和保留；不猜测首期未支持的语义。
- 默认单 map 累计上限 20 MiB，硬上限 100 MiB；缓存默认 16 项/64 MiB/30 分钟；indexed 深度 8、section 数 1,000；重定向最多 3；请求默认 15 秒；diff 明细默认 200、最多 2,000。
- `sourcemap_discover`、`sourcemap_parse`、`sourcemap_lookup`、`sourcemap_diff` 只读；只有 `sourcemap_reconstruct_tree` 可显式写盘。
- 不在 `scriptParsed` 时自动解析，不自动映射堆栈或断点，不在启动路径 eager-enable CDP 域，不执行页面 JS，不改变 cloak/stealth/viewport 行为。
- `Runtime` 高扇入接口只能新增可选属性；现有测试桩不得因 SourceMap 变成必填。
- 所有位置对外统一为 line 1-based、column 0-based。
- 新模块相关覆盖率目标至少 80%；最终 diff 后必须重新运行相关测试、`npm run typecheck` 和 `npm run check-format`。
- 工作区可能包含用户的并行改动；每次提交只暂存任务明确列出的文件，不得格式化、还原或提交无关文件。

---

## File Map

### 新建源码

- `src/modules/sourcemap/types.ts`：错误码、配置、原始 map、服务输入输出和运行时访问接口。
- `src/modules/sourcemap/SourceMapDocument.ts`：纯 v3 校验、TraceMap、coverage、metadata、lookup 和 diff。
- `src/modules/sourcemap/SourceMapResolver.ts`：来源互斥校验、data URI、脚本发现、已捕获响应、同源/跨源请求和 indexed section 物化。
- `src/modules/sourcemap/SourceMapReconstructor.ts`：安全路径规划、冲突处理、原子写入和 manifest。
- `src/modules/sourcemap/SourceMapService.ts`：公共门面、opaque `mapId`、TTL/LRU/字节缓存和模块编排。
- `src/tools/sourcemap/index.ts`：五个 MCP 工具和运行时 access adapter。
- `src/tools/sourcemap/manifest.ts`：`full` profile 工具域清单。
- `docs/reference/sourcemap.md`：工具使用、边界和坐标约定。

### 新建测试与 fixture

- `tests/fixtures/sourcemap/basic-v3.json`
- `tests/fixtures/sourcemap/indexed-embedded-v3.json`
- `tests/fixtures/sourcemap/metadata-v3.json`
- `tests/unit/modules/sourcemap/SourceMapDocument.test.ts`
- `tests/unit/modules/sourcemap/SourceMapResolver.test.ts`
- `tests/unit/modules/sourcemap/SourceMapReconstructor.test.ts`
- `tests/unit/modules/sourcemap/SourceMapService.test.ts`
- `tests/unit/config/servicesConfig.sourcemap.test.ts`
- `tests/unit/tools/sourcemap/SourceMapTools.test.ts`
- `tests/integration/tools/sourcemap.integration.test.ts`
- `tests/property/modules/sourcemap-paths.property.test.ts`

### 修改现有文件

- `package.json`、`package-lock.json`：直接依赖声明。
- `src/config/servicesConfig.ts`：SourceMap 限制配置读取与硬上限验证。
- `src/runtime/RuntimeServices.ts`：延迟创建 `SourceMapService`。
- `src/runtime.ts`：可选 `sourceMapService` 和生产 getter。
- `src/worker/context/DebuggerContextProvider.ts`：新增不激活 CDP 的只读 peek。
- `src/worker/ToolContext.ts`：暴露现有 DebuggerManager 的只读访问。
- `scripts/generate-tools-index.ts`：SourceMap 域描述。
- `src/tools/generated-tools-index.ts`：由 `npm run build:index` 生成。
- `tests/unit/runtime/RuntimeServices.test.ts`
- `tests/unit/worker/DebuggerContextProvider.test.ts`
- `tests/unit/tools/ToolRegistry.profile.test.ts`
- `docs/reference/tool-reference.md`：链接 SourceMap 专题。

---

### Task 1: 建立 SourceMap 类型、fixture 与基础解析文档

**Files:**

- Create: `src/modules/sourcemap/types.ts`
- Create: `src/modules/sourcemap/SourceMapDocument.ts`
- Create: `tests/fixtures/sourcemap/basic-v3.json`
- Create: `tests/fixtures/sourcemap/indexed-embedded-v3.json`
- Create: `tests/fixtures/sourcemap/metadata-v3.json`
- Create: `tests/unit/modules/sourcemap/SourceMapDocument.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: `@jridgewell/trace-mapping` 的 `TraceMap`、`AnyMap`、`decodedMappings`。
- Produces: `SourceMapError`、`SourceMapConfig`、`MaterializedSourceMap`、`SourceMapSummary`、`SourceMapSourceEntry`、`SourceMapDocument.parse()`、`SourceMapDocument.getSummary()`、`SourceMapDocument.getSources()`。

- [ ] **Step 1: 把现有传递依赖提升为直接依赖**

Run:

```bash
npm install @jridgewell/trace-mapping@^0.3.31 --save
```

Expected: `package.json` 的 `dependencies` 新增 `@jridgewell/trace-mapping`，`package-lock.json` 根包依赖同步更新，不引入新的包族。

- [ ] **Step 2: 创建三个独立 fixture**

`tests/fixtures/sourcemap/basic-v3.json`：

```json
{
  "version": 3,
  "file": "bundle.js",
  "sourceRoot": "webpack:///",
  "sources": ["src/answer.ts"],
  "sourcesContent": ["export const answer = 42;\n"],
  "names": [],
  "mappings": "AAAA"
}
```

`tests/fixtures/sourcemap/indexed-embedded-v3.json`：

```json
{
  "version": 3,
  "sections": [
    {
      "offset": {"line": 0, "column": 0},
      "map": {
        "version": 3,
        "sources": ["first.ts"],
        "sourcesContent": ["export const first = 1;\n"],
        "names": [],
        "mappings": "AAAA"
      }
    },
    {
      "offset": {"line": 2, "column": 0},
      "map": {
        "version": 3,
        "sources": ["second.ts"],
        "sourcesContent": ["export const second = 2;\n"],
        "names": [],
        "mappings": "AAAA"
      }
    }
  ]
}
```

`tests/fixtures/sourcemap/metadata-v3.json`：

```json
{
  "version": 3,
  "sources": ["ignored.ts"],
  "sourcesContent": [null],
  "names": [],
  "mappings": "AAAA",
  "debugId": "8a1f9b89-41d4-4ccb-a785-6c31afc8f962",
  "x_google_ignoreList": [0],
  "x_com_bloomberg_sourcesFunctionMappings": [[0, 0, 0]],
  "x_scope_info": {"format": "preserve-only"}
}
```

- [ ] **Step 3: 写基础解析失败测试**

在 `tests/unit/modules/sourcemap/SourceMapDocument.test.ts` 写入：

```ts
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, it} from 'node:test';

import {SourceMapDocument} from '../../../../src/modules/sourcemap/SourceMapDocument.js';
import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';

const fixture = (name: string) =>
  readFile(path.join(process.cwd(), 'tests/fixtures/sourcemap', name), 'utf8');

describe('SourceMapDocument.parse', () => {
  it('parses a basic v3 map and reports content coverage', async () => {
    const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
    assert.deepEqual(document.getSummary().sourcesContentCoverage, {
      present: 1,
      missing: 0,
      ratio: 1,
    });
    assert.equal(document.getSummary().indexed, false);
  });

  it('flattens embedded indexed sections', async () => {
    const document = SourceMapDocument.parse(
      await fixture('indexed-embedded-v3.json'),
    );
    assert.equal(document.getSummary().indexed, true);
    assert.equal(document.getSummary().sectionsCount, 2);
    assert.equal(document.getSources().length, 2);
  });

  it('preserves extension metadata without interpreting it', async () => {
    const document = SourceMapDocument.parse(await fixture('metadata-v3.json'));
    const summary = document.getSummary();
    assert.equal(summary.debugId, '8a1f9b89-41d4-4ccb-a785-6c31afc8f962');
    assert.deepEqual(summary.ignoreList, [0]);
    assert.deepEqual(summary.extensions.map(item => item.name).sort(), [
      'x_com_bloomberg_sourcesFunctionMappings',
      'x_scope_info',
    ]);
  });

  it('rejects malformed JSON with a stable code', () => {
    assert.throws(
      () => SourceMapDocument.parse('{'),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'PARSE_FAILED',
    );
  });
});
```

- [ ] **Step 4: 运行测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapDocument.test.js
```

Expected: build 或 test 因 `SourceMapDocument`/`types` 不存在而失败。

- [ ] **Step 5: 实现最小公共类型和基础文档**

`src/modules/sourcemap/types.ts` 至少定义以下精确公共形状：

```ts
export type SourceMapErrorCode =
  | 'INVALID_SOURCE_INPUT'
  | 'SCRIPT_NOT_FOUND'
  | 'SOURCEMAP_REFERENCE_NOT_FOUND'
  | 'FETCH_BLOCKED'
  | 'FETCH_TOO_LARGE'
  | 'FETCH_TIMEOUT'
  | 'INDEXED_MAP_LIMIT_EXCEEDED'
  | 'PARSE_FAILED'
  | 'UNSUPPORTED_SEMANTICS'
  | 'MAP_NOT_FOUND'
  | 'OUTPUT_PATH_REQUIRED'
  | 'PATH_BLOCKED'
  | 'OUTPUT_EXISTS'
  | 'SOURCEMAP_CONFIG_INVALID';

export class SourceMapError extends Error {
  constructor(
    readonly code: SourceMapErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SourceMapError';
  }
}

export interface BasicSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names: string[];
  mappings: string;
  [key: string]: unknown;
}

export interface IndexedSourceMapSection {
  offset: {line: number; column: number};
  map: MaterializedSourceMap;
}

export interface IndexedSourceMap {
  version: 3;
  sections: IndexedSourceMapSection[];
  [key: string]: unknown;
}

export type MaterializedSourceMap = BasicSourceMap | IndexedSourceMap;

export interface SourceMapExtensionSummary {
  name: string;
  type: string;
  bytes: number;
  sha256: string;
}

export interface SourceMapSummary {
  version: 3;
  indexed: boolean;
  sourcesCount: number;
  namesCount: number;
  sectionsCount: number;
  mappingsCount: number;
  sourcesContentCoverage: {present: number; missing: number; ratio: number};
  debugId?: string;
  ignoreList: number[];
  extensions: SourceMapExtensionSummary[];
  warnings: string[];
}

export interface SourceMapSourceEntry {
  index: number;
  source: string;
  resolvedSource: string;
  content: string | null;
}
```

`SourceMapDocument.ts` 使用 `TraceMap` 处理普通 map、`AnyMap` 处理已物化 indexed map；构造器保持私有：

```ts
export class SourceMapDocument {
  private constructor(
    private readonly raw: MaterializedSourceMap,
    private readonly traceMap: TraceMap,
    private readonly summary: SourceMapSummary,
  ) {}

  static parse(content: string, mapUrl?: string): SourceMapDocument {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new SourceMapError('PARSE_FAILED', 'SourceMap is not valid JSON', {
        cause: error,
      });
    }
    const raw = assertMaterializedSourceMap(parsed);
    const traceMap =
      'sections' in raw
        ? AnyMap(raw, mapUrl ?? null)
        : new TraceMap(raw, mapUrl ?? null);
    return new SourceMapDocument(raw, traceMap, buildSummary(raw, traceMap));
  }

  getSummary(): SourceMapSummary {
    return this.summary;
  }

  getSources(): SourceMapSourceEntry[] {
    return this.traceMap.resolvedSources.map((resolvedSource, index) => ({
      index,
      source: this.traceMap.sources[index] ?? resolvedSource,
      resolvedSource,
      content: this.traceMap.sourcesContent?.[index] ?? null,
    }));
  }

  getTraceMap(): TraceMap {
    return this.traceMap;
  }
}
```

`assertMaterializedSourceMap()` 必须校验 `version === 3`、普通 map 必填数组/字符串字段、indexed offset 为非负整数且 section 只有内嵌 `map`；此阶段遇到 section `url` 返回 `PARSE_FAILED`，由 Task 4 在进入文档前物化。

- [ ] **Step 6: 运行基础文档测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapDocument.test.js
```

Expected: 4 tests pass。

- [ ] **Step 7: 提交基础解析单元**

```bash
git add package.json package-lock.json src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapDocument.ts tests/fixtures/sourcemap tests/unit/modules/sourcemap/SourceMapDocument.test.ts
git commit -m "feat(sourcemap): add v3 document parser"
```

---

### Task 2: 增加双向 lookup、统计与有界 diff

**Files:**

- Modify: `src/modules/sourcemap/types.ts`
- Modify: `src/modules/sourcemap/SourceMapDocument.ts`
- Modify: `tests/unit/modules/sourcemap/SourceMapDocument.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `SourceMapDocument`、`MaterializedSourceMap`。
- Produces: `SourceMapLookupInput`、`SourceMapLookupResult`、`SourceMapDiffInput`、`SourceMapDiffResult`、`SourceMapDocument.lookup()`、`SourceMapDocument.diff()`。

- [ ] **Step 1: 写 lookup 与 diff 失败测试**

追加：

```ts
it('maps generated and original positions with public coordinate rules', async () => {
  const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
  const original = document.lookup({
    direction: 'generated_to_original',
    line: 1,
    column: 0,
    bias: 'greatest_lower_bound',
  });
  assert.equal(original.match?.line, 1);
  assert.equal(original.match?.column, 0);
  assert.match(original.match?.source ?? '', /src\/answer\.ts$/);

  const generated = document.lookup({
    direction: 'original_to_generated',
    source: original.match?.source ?? '',
    line: 1,
    column: 0,
    bias: 'least_upper_bound',
  });
  assert.deepEqual(generated.match, {line: 1, column: 0});
});

it('returns a successful null match for an unmapped position', async () => {
  const document = SourceMapDocument.parse(await fixture('basic-v3.json'));
  assert.equal(
    document.lookup({
      direction: 'generated_to_original',
      line: 50,
      column: 0,
    }).match,
    null,
  );
});

it('reports exact diff totals while bounding details', async () => {
  const left = SourceMapDocument.parse(await fixture('basic-v3.json'));
  const right = SourceMapDocument.parse(
    JSON.stringify({
      version: 3,
      sources: ['one.ts', 'two.ts'],
      sourcesContent: ['one', 'two'],
      names: [],
      mappings: 'AAAA;ACAA',
    }),
  );
  const diff = left.diff(right, {mode: 'mappings', maxChanges: 1});
  assert.equal(diff.truncated, true);
  assert.equal(diff.changes.length, 1);
  assert.ok(diff.totalChanges > diff.changes.length);
});
```

- [ ] **Step 2: 运行测试并确认缺少 API**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapDocument.test.js
```

Expected: TypeScript 因 `lookup`/`diff` 不存在而失败。

- [ ] **Step 3: 定义查询与 diff 类型**

在 `types.ts` 增加：

```ts
export type SourceMapBias = 'greatest_lower_bound' | 'least_upper_bound';

export type SourceMapLookupInput =
  | {
      direction: 'generated_to_original';
      line: number;
      column: number;
      bias?: SourceMapBias;
    }
  | {
      direction: 'original_to_generated';
      source: string;
      line: number;
      column: number;
      bias?: SourceMapBias;
    };

export interface SourceMapLookupResult {
  coordinateConvention: {line: '1-based'; column: '0-based'};
  match: {line: number; column: number; source?: string; name?: string} | null;
  exact: boolean;
}

export interface SourceMapDiffInput {
  mode: 'summary' | 'sources' | 'mappings';
  maxChanges: number;
}

export interface SourceMapDiffResult {
  summaryChanged: boolean;
  sources: {added: string[]; removed: string[]; contentChanged: string[]};
  mappingChanges: number;
  totalChanges: number;
  changes: Array<{kind: 'added' | 'removed'; mapping: string}>;
  truncated: boolean;
}
```

- [ ] **Step 4: 实现坐标转换和无额外 Set 的有序 diff**

`lookup()` 使用 `GREATEST_LOWER_BOUND`/`LEAST_UPPER_BOUND`，对外不转换 column，只把原始 line 与生成 line 保持 1-based。反向查询先在 `sources`、`resolvedSources` 中寻找精确匹配或唯一同尾路径，找不到时返回 `match:null`。

映射 diff 使用 `decodedMappings()` 按行和 segment 的原始顺序生成规范行，禁止把所有映射复制到两个 `Set`：

```ts
interface NormalizedMappingRow {
  generatedLine: number;
  generatedColumn: number;
  source: string | null;
  originalLine: number | null;
  originalColumn: number | null;
  name: string | null;
}

private *mappingRows(): Generator<NormalizedMappingRow> {
  const lines = decodedMappings(this.traceMap);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (const segment of lines[lineIndex] ?? []) {
      const sourceIndex = segment.length >= 4 ? segment[1] : undefined;
      const nameIndex = segment.length === 5 ? segment[4] : undefined;
      yield {
        generatedLine: lineIndex + 1,
        generatedColumn: segment[0],
        source:
          sourceIndex === undefined
            ? null
            : (this.traceMap.resolvedSources[sourceIndex] ?? null),
        originalLine: segment.length >= 4 ? segment[2] + 1 : null,
        originalColumn: segment.length >= 4 ? segment[3] : null,
        name:
          nameIndex === undefined ? null : (this.traceMap.names[nameIndex] ?? null),
      };
    }
  }
}
```

`diff()` 对两个 generator 做双指针归并，持续增加完整 added/removed 计数，只在 `changes.length < maxChanges` 时保存明细。source 内容变化用 SHA-256 比较，不把内容写入结果。

- [ ] **Step 5: 运行文档测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapDocument.test.js
```

Expected: 7 tests pass。

- [ ] **Step 6: 提交查询与 diff**

```bash
git add src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapDocument.ts tests/unit/modules/sourcemap/SourceMapDocument.test.ts
git commit -m "feat(sourcemap): add lookup and bounded diff"
```

---

### Task 3: 实现受控 URL、SSRF 与有界响应读取

**Files:**

- Create: `src/modules/sourcemap/SourceMapResolver.ts`
- Create: `tests/unit/modules/sourcemap/SourceMapResolver.test.ts`
- Modify: `src/modules/sourcemap/types.ts`

**Interfaces:**

- Consumes: `SourceMapError`、`SourceMapConfig`。
- Produces: `SourceMapResolverDependencies`、`SourceMapHttpResponse`、`decodeDataUri()`、`assertAllowedNetworkUrl()`、`SourceMapResolver.fetchUrl()`。

- [ ] **Step 1: 写 data URI、IP 分类和体积失败测试**

```ts
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {describe, it} from 'node:test';

import {
  assertPublicAddress,
  decodeDataUri,
  readBoundedBody,
} from '../../../../src/modules/sourcemap/SourceMapResolver.js';
import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';

describe('SourceMapResolver network boundaries', () => {
  it('decodes base64 and percent data URIs', () => {
    assert.equal(
      decodeDataUri('data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==', 100),
      '{"version":3}',
    );
    assert.equal(
      decodeDataUri('data:application/json,%7B%22version%22%3A3%7D', 100),
      '{"version":3}',
    );
  });

  it('blocks private and mapped-private addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.1.1',
      '::1',
      'fc00::1',
    ]) {
      assert.throws(() => assertPublicAddress(address), SourceMapError);
    }
  });

  it('aborts a streamed body at the byte limit', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    await assert.rejects(
      readBoundedBody(body, 10),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'FETCH_TOO_LARGE',
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapResolver.test.js
```

Expected: resolver exports 不存在。

- [ ] **Step 3: 定义网络依赖和响应类型**

在 `types.ts` 增加：

```ts
export interface SourceMapConfig {
  maxBytes: number;
  cacheMaxBytes: number;
  cacheMaxEntries: number;
  cacheTtlMs: number;
  fetchTimeoutMs: number;
  maxRedirects: 3;
  maxIndexedDepth: number;
  maxIndexedSections: number;
  maxDiffChanges: number;
}

export interface SourceMapHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: NodeJS.ReadableStream;
}

export interface SourceMapResolverDependencies {
  lookup(hostname: string): Promise<Array<{address: string; family: 4 | 6}>>;
  request(
    url: URL,
    options: {
      address: string;
      family: 4 | 6;
      headers: Record<string, string>;
      timeoutMs: number;
    },
  ): Promise<SourceMapHttpResponse>;
}
```

- [ ] **Step 4: 实现 IP blocklist、DNS pinning 和流式读取**

使用 `node:net` 的 `BlockList`，至少加入以下保留范围：

```ts
const blockedAddresses = new BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.0.0.0', 24, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('198.18.0.0', 15, 'ipv4');
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4');
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4');
blockedAddresses.addAddress('::', 'ipv6');
blockedAddresses.addAddress('::1', 'ipv6');
blockedAddresses.addSubnet('fc00::', 7, 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');
blockedAddresses.addSubnet('ff00::', 8, 'ipv6');
```

`assertPublicAddress()` 先用 `isIP()` 确定 family，再调用 `blockedAddresses.check()`；无效地址和命中保留范围都抛 `FETCH_BLOCKED`。

默认 `request()` 使用 `node:http`/`node:https`，保留原 hostname 作为 `Host` 和 TLS SNI，同时把 `lookup` callback 固定为已校验的 `address/family`。请求超时销毁 socket 并转换为 `FETCH_TIMEOUT`。`readBoundedBody()` 每收到 chunk 就增加字节数，超过上限立即销毁流并抛 `FETCH_TOO_LARGE`。

- [ ] **Step 5: 实现协议、credentials 与 data URI 校验**

```ts
export function assertAllowedNetworkUrl(input: URL): void {
  if (!['http:', 'https:'].includes(input.protocol)) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      `Protocol blocked: ${input.protocol}`,
    );
  }
  if (input.username || input.password) {
    throw new SourceMapError(
      'FETCH_BLOCKED',
      'URL credentials are not allowed',
    );
  }
}
```

`decodeDataUri()` 只接受 `data:application/json`、`data:application/octet-stream` 或省略 media type 的 JSON 内容；Base64 使用 `Buffer.from(payload, 'base64')`，percent encoding 使用 `decodeURIComponent()`，两者都按 UTF-8 字节数执行 `maxBytes`。

- [ ] **Step 6: 运行 resolver 边界测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapResolver.test.js
```

Expected: data URI、私网拒绝和流式超限 tests pass。

- [ ] **Step 7: 提交网络安全基础**

```bash
git add src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapResolver.ts tests/unit/modules/sourcemap/SourceMapResolver.test.ts
git commit -m "feat(sourcemap): add bounded resource fetcher"
```

---

### Task 4: 完成发现、来源选择与 indexed section 物化

**Files:**

- Modify: `src/modules/sourcemap/types.ts`
- Modify: `src/modules/sourcemap/SourceMapResolver.ts`
- Modify: `tests/unit/modules/sourcemap/SourceMapResolver.test.ts`

**Interfaces:**

- Consumes: Task 3 的受控 fetch primitives。
- Produces: `SourceMapRuntimeAccess`、`SourceMapParseInput`、`ResolvedSourceMap`、`SourceMapResolver.discover()`、`SourceMapResolver.resolve()`。

- [ ] **Step 1: 定义运行时 access 与来源结果**

```ts
export interface SourceMapScriptInfo {
  scriptId: string;
  generatedUrl: string;
  sourceMapURL: string;
}

export interface SourceMapCapturedBody {
  url: string;
  content: string;
  complete: boolean;
}

export interface SourceMapRuntimeAccess {
  listScripts(): SourceMapScriptInfo[];
  findCapturedBody(url: string): Promise<SourceMapCapturedBody | undefined>;
  getCookies(url: string): Promise<Array<{name: string; value: string}>>;
  getPageUrl(): string | undefined;
  resolveExistingTaskDir(taskId: string): Promise<string | undefined>;
}

export interface SourceMapParseInput {
  scriptId?: string;
  mapUrl?: string;
  mapContent?: string;
  generatedUrl?: string;
  allowCrossOrigin?: boolean;
}

export interface ResolvedSourceMap {
  map: MaterializedSourceMap;
  canonicalContent: string;
  baseUrl?: string;
  decodedBytes: number;
  provenance: {
    kind: 'content' | 'data' | 'captured' | 'same_origin' | 'cross_origin';
    displayUrl?: string;
  };
  warnings: string[];
}
```

- [ ] **Step 2: 写来源优先级和 indexed URL 失败测试**

```ts
it('uses an exact complete captured body before fetching', async () => {
  let requests = 0;
  const resolver = createResolver({
    request: async () => {
      requests += 1;
      throw new Error('network must not run');
    },
  });
  const access = fakeAccess({
    captured: {
      url: 'https://example.com/app.js.map',
      content: await fixture('basic-v3.json'),
      complete: true,
    },
  });
  const result = await resolver.resolve(
    {
      mapUrl: 'https://example.com/app.js.map',
      generatedUrl: 'https://example.com/app.js',
    },
    access,
  );
  assert.equal(result.provenance.kind, 'captured');
  assert.equal(requests, 0);
});

it('blocks cross-origin fetch unless explicitly allowed', async () => {
  const resolver = createResolver();
  await assert.rejects(
    resolver.resolve(
      {
        mapUrl: 'https://cdn.example.net/app.js.map',
        generatedUrl: 'https://example.com/app.js',
      },
      fakeAccess(),
    ),
    (error: unknown) =>
      error instanceof SourceMapError && error.code === 'FETCH_BLOCKED',
  );
});

it('materializes relative indexed section URLs', async () => {
  const resolver = createResolverWithBodies({
    'https://example.com/root.map': JSON.stringify({
      version: 3,
      sections: [{offset: {line: 0, column: 0}, url: 'part.map'}],
    }),
    'https://example.com/part.map': await fixture('basic-v3.json'),
  });
  const result = await resolver.resolve(
    {
      mapUrl: 'https://example.com/root.map',
      generatedUrl: 'https://example.com/app.js',
    },
    fakeAccess(),
  );
  assert.ok('sections' in result.map);
  assert.ok('map' in result.map.sections[0]);
});
```

在同一测试文件定义下列真实 helper，保证测试不访问公网：

```ts
const TEST_CONFIG: SourceMapConfig = {
  maxBytes: 20 * 1024 * 1024,
  cacheMaxBytes: 64 * 1024 * 1024,
  cacheMaxEntries: 16,
  cacheTtlMs: 30 * 60 * 1000,
  fetchTimeoutMs: 15_000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

function fakeAccess(
  options: {captured?: SourceMapCapturedBody} = {},
): SourceMapRuntimeAccess {
  return {
    listScripts: () => [],
    findCapturedBody: async url =>
      options.captured?.url === url ? options.captured : undefined,
    getCookies: async () => [],
    getPageUrl: () => 'https://example.com/app.js',
    resolveExistingTaskDir: async () => undefined,
  };
}

function createResolver(
  overrides: Partial<SourceMapResolverDependencies> = {},
): SourceMapResolver {
  return new SourceMapResolver(TEST_CONFIG, {
    lookup: async () => [{address: '93.184.216.34', family: 4}],
    request: async () => {
      throw new Error('unexpected network request');
    },
    ...overrides,
  });
}

function createResolverWithBodies(
  bodies: Record<string, string>,
): SourceMapResolver {
  return createResolver({
    request: async url => {
      const body = bodies[url.href];
      assert.notEqual(body, undefined, `unexpected URL: ${url.href}`);
      return {
        status: 200,
        headers: {'content-length': String(Buffer.byteLength(body ?? ''))},
        body: Readable.from([body ?? '']),
      };
    },
  });
}
```

- [ ] **Step 3: 运行测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapResolver.test.js
```

Expected: `resolve()`、类型或 indexed materialization 断言失败。

- [ ] **Step 4: 实现三选一来源校验与 discover**

`resolve()` 先计算 `Boolean(scriptId) + Boolean(mapUrl) + Boolean(mapContent)`，结果不等于 1 时抛 `INVALID_SOURCE_INPUT`。相对 `mapUrl` 缺少 `generatedUrl` 时同样抛 `INVALID_SOURCE_INPUT`。

`discover()` 只读取 `access.listScripts()`，不调用 fetch：

```ts
discover(
  input: {scriptId?: string; urlPattern?: string; limit?: number},
  access: SourceMapRuntimeAccess,
): {candidates: SourceMapScriptInfo[]; warnings: string[]} {
  const limit = Math.min(input.limit ?? 100, 1000);
  const scripts = access.listScripts();
  const candidates = scripts
    .filter(script => script.sourceMapURL.length > 0)
    .filter(script => !input.scriptId || script.scriptId === input.scriptId)
    .filter(
      script =>
        !input.urlPattern || script.generatedUrl.includes(input.urlPattern),
    )
    .slice(0, limit);
  return {
    candidates,
    warnings:
      scripts.length === 0
        ? ['Debugger context is not active; no existing script metadata is available.']
        : [],
  };
}
```

- [ ] **Step 5: 实现来源优先级、同源和手工重定向**

顺序固定为 direct content/data → exact complete captured response → request。`new URL(mapRef, generatedUrl)` 负责相对 URL。请求 URL 与生成脚本/当前页的 origin 相同则允许私网并携带 `access.getCookies(url)` 生成的 `Cookie` header；跨源必须 `allowCrossOrigin === true`，每一跳先 DNS 校验并 pin 地址。

每次收到 3xx：读取 `Location`，规范为新 URL，增加 redirectCount；超过 3 抛 `FETCH_BLOCKED`；重新计算 same-origin/cross-origin 并执行全部策略。日志和 provenance 使用 `redactUrl()` 把 username/password 清空、所有 query value 替换为 `[redacted]`。

- [ ] **Step 6: 递归物化 indexed sections**

实现：

```ts
private async materialize(
  value: unknown,
  parentUrl: string | undefined,
  state: {depth: number; sections: number; bytes: number; seenUrls: Set<string>},
  access: SourceMapRuntimeAccess,
  allowCrossOrigin: boolean,
): Promise<MaterializedSourceMap>
```

规则：depth 每次递归加 1；每个 section 增加 sections；所有 body 的 `Buffer.byteLength()` 累加到 bytes。超过 config 或 URL 已在 `seenUrls` 时抛 `INDEXED_MAP_LIMIT_EXCEEDED`。section 有 `map` 时递归；有 `url` 时相对 `parentUrl` 解析、按相同获取策略下载后递归；同时存在或都不存在时抛 `PARSE_FAILED`。最终 `canonicalContent = JSON.stringify(materializedMap)`。

- [ ] **Step 7: 运行 resolver 全部测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapResolver.test.js
```

Expected: direct、captured、same-origin、cross-origin、redirect、indexed、cycle、depth、section count、size tests pass。

- [ ] **Step 8: 提交完整 resolver**

```bash
git add src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapResolver.ts tests/unit/modules/sourcemap/SourceMapResolver.test.ts
git commit -m "feat(sourcemap): resolve scripts and indexed maps"
```

---

### Task 5: 实现安全源码树重建与 manifest

**Files:**

- Create: `src/modules/sourcemap/SourceMapReconstructor.ts`
- Create: `tests/unit/modules/sourcemap/SourceMapReconstructor.test.ts`
- Modify: `src/modules/sourcemap/types.ts`

**Interfaces:**

- Consumes: `SourceMapDocument.getSources()`、`validateOutputPath()`。
- Produces: `SourceMapReconstructInput`、`SourceMapReconstructResult`、`SourceMapReconstructor.reconstruct()`、`normalizeSourcePath()`。

- [ ] **Step 1: 写正常、穿越、冲突和覆盖失败测试**

```ts
import assert from 'node:assert/strict';
import {mkdtemp, readFile, symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {SourceMapDocument} from '../../../../src/modules/sourcemap/SourceMapDocument.js';
import {
  normalizeSourcePath,
  SourceMapReconstructor,
} from '../../../../src/modules/sourcemap/SourceMapReconstructor.js';

describe('SourceMapReconstructor', () => {
  it('normalizes hostile source paths below the output root', () => {
    assert.equal(normalizeSourcePath('../../CON.txt', 0), '_CON.txt');
    assert.equal(
      normalizeSourcePath('webpack:///src/main.ts?token=secret', 1),
      'src/main.ts',
    );
  });

  it('writes content and the manifest last', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-tree-'));
    const document = SourceMapDocument.parse(
      JSON.stringify({
        version: 3,
        sources: ['src/main.ts'],
        sourcesContent: ['export const main = true;\n'],
        names: [],
        mappings: 'AAAA',
      }),
    );
    const result = await new SourceMapReconstructor().reconstruct(document, {
      mapId: 'sm_test',
      outputDir: root,
      overwrite: false,
    });
    assert.equal(
      await readFile(path.join(root, 'src/main.ts'), 'utf8'),
      'export const main = true;\n',
    );
    assert.equal(result.written, 1);
    assert.equal(
      JSON.parse(await readFile(result.manifestPath, 'utf8')).mapId,
      'sm_test',
    );
  });

  it('does not follow an existing symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-link-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-outside-'));
    await symlink(outside, path.join(root, 'src'), 'junction');
    const document = SourceMapDocument.parse(
      JSON.stringify({
        version: 3,
        sources: ['src/main.ts'],
        sourcesContent: ['blocked'],
        names: [],
        mappings: 'AAAA',
      }),
    );
    await assert.rejects(
      new SourceMapReconstructor().reconstruct(document, {
        mapId: 'sm_test',
        outputDir: root,
        overwrite: false,
      }),
      /symlink/i,
    );
  });
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapReconstructor.test.js
```

Expected: reconstructor 模块不存在。

- [ ] **Step 3: 定义重建结果**

```ts
export interface SourceMapReconstructInput {
  mapId: string;
  taskId?: string;
  outputDir?: string;
  overwrite: boolean;
}

export interface SourceMapManifestEntry {
  source: string;
  outputPath?: string;
  status: 'written' | 'skipped' | 'missing' | 'collision';
  sha256?: string;
  bytes?: number;
  warnings: string[];
}

export interface SourceMapReconstructResult {
  rootDir: string;
  manifestPath: string;
  written: number;
  skipped: number;
  missing: number;
  collisions: number;
  entries: SourceMapManifestEntry[];
}
```

- [ ] **Step 4: 实现确定性路径归一化**

`normalizeSourcePath(source, index)` 必须：把 `\` 转 `/`；若是 URL 去 scheme/authority/query/fragment；去盘符和开头 `/`；用 POSIX 规则折叠 `.`/`..` 且不允许越过根；替换控制字符和 `<>:"|?*`；Windows 保留名加 `_`；去尾随点/空格；空结果变成 `source-${index}`。

冲突表以归一化相对路径为 key。第二个及以后冲突使用 `basename~${sha256(content).slice(0, 8)}${ext}`；相同内容可复用文件，但每个 source 必须保留 manifest entry。

- [ ] **Step 5: 实现根目录、symlink 与原子写规则**

根目录先经 `validateOutputPath()`，再拒绝 filesystem root、`os.homedir()`、`process.cwd()` 本身。逐级 `lstat()` 已存在路径段，任何 symlink 都抛 `PATH_BLOCKED`。最终 `path.resolve(root, relative)` 必须满足 `target === root` 或以 `${root}${path.sep}` 开头。

每个文件写到同目录 `.${basename}.${randomUUID()}.tmp`，使用 `open(temp, 'wx')`，关闭后再 rename。`overwrite=false` 且目标已存在时记录 skipped；`overwrite=true` 也不得覆盖 symlink。所有 source 处理完成后才写 `sourcemap-manifest.json`。

- [ ] **Step 6: 运行重建测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapReconstructor.test.js
```

Expected: normal、hostile、collision、missing、overwrite、symlink 和 manifest tests pass。

- [ ] **Step 7: 提交重建器**

```bash
git add src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapReconstructor.ts tests/unit/modules/sourcemap/SourceMapReconstructor.test.ts
git commit -m "feat(sourcemap): reconstruct safe source trees"
```

---

### Task 6: 实现 SourceMapService 门面和有界缓存

**Files:**

- Create: `src/modules/sourcemap/SourceMapService.ts`
- Create: `tests/unit/modules/sourcemap/SourceMapService.test.ts`
- Modify: `src/modules/sourcemap/types.ts`

**Interfaces:**

- Consumes: resolver、document、reconstructor 和 `SourceMapRuntimeAccess`。
- Produces: `SourceMapServiceDependencies`、`SourceMapService.discover()`、`parse()`、`lookup()`、`diff()`、`reconstructTree()`、`getCacheStats()`。

- [ ] **Step 1: 写缓存命中、base 隔离、TTL 和淘汰失败测试**

```ts
const BASIC = JSON.stringify({
  version: 3,
  sources: ['src/main.ts'],
  sourcesContent: ['export const main = true;\n'],
  names: [],
  mappings: 'AAAA',
});

function createServiceHarness(overrides: Partial<SourceMapConfig> = {}) {
  let clock = 1000;
  const config: SourceMapConfig = {...TEST_CONFIG, ...overrides};
  const service = new SourceMapService(config, {
    now: () => clock,
    randomBytes: size => Buffer.alloc(size, 1),
    resolverDependencies: {
      lookup: async () => [{address: '93.184.216.34', family: 4}],
      request: async () => {
        throw new Error('unexpected network request');
      },
    },
  });
  return {
    service,
    access: fakeAccess(),
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

describe('SourceMapService cache', () => {
  it('reuses an id for the same materialized map and base URL', async () => {
    const {service, access} = createServiceHarness();
    const first = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    const second = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    assert.equal(second.mapId, first.mapId);
    assert.equal(second.cacheHit, true);
    assert.match(first.mapId, /^sm_[a-f0-9]{32}$/);
  });

  it('does not reuse a map across different base URLs', async () => {
    const {service, access} = createServiceHarness();
    const left = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://a.test/app.js'},
      access,
    );
    const right = await service.parse(
      {mapContent: BASIC, generatedUrl: 'https://b.test/app.js'},
      access,
    );
    assert.notEqual(left.mapId, right.mapId);
  });

  it('returns MAP_NOT_FOUND after TTL eviction', async () => {
    const harness = createServiceHarness({cacheTtlMs: 10});
    const parsed = await harness.service.parse(
      {mapContent: BASIC},
      harness.access,
    );
    harness.advance(11);
    assert.throws(
      () =>
        harness.service.lookup({
          mapId: parsed.mapId,
          direction: 'generated_to_original',
          line: 1,
          column: 0,
        }),
      (error: unknown) =>
        error instanceof SourceMapError && error.code === 'MAP_NOT_FOUND',
    );
  });
});
```

`TEST_CONFIG` 和 `fakeAccess()` 与 resolver 测试保持同形，直接在该测试文件定义，不从测试文件跨模块导入。

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapService.test.js
```

Expected: service 模块不存在。

- [ ] **Step 3: 实现缓存 entry 和 key**

```ts
interface CacheEntry {
  mapId: string;
  cacheKey: string;
  document: SourceMapDocument;
  rawBytes: number;
  provenance: ResolvedSourceMap['provenance'];
  lastAccess: number;
}

function buildCacheKey(resolved: ResolvedSourceMap): string {
  return createHash('sha256')
    .update(resolved.canonicalContent)
    .update('\0')
    .update(resolved.baseUrl ?? '')
    .digest('hex');
}
```

Service 内部维护 `byId` 与 `idByKey` 两个 `Map`。`mapId` 使用 `sm_${randomBytes(16).toString('hex')}`。每次公共方法先清理 TTL；新增前按最旧 `lastAccess` 做 O(n) LRU，最多 64 项，禁止引入 heap 抽象。

构造器依赖形状固定为：

```ts
export interface SourceMapServiceDependencies {
  now?: () => number;
  randomBytes?: typeof randomBytes;
  resolverDependencies?: Partial<SourceMapResolverDependencies>;
}

constructor(
  config: SourceMapConfig,
  dependencies: SourceMapServiceDependencies = {},
)
```

生产默认分别使用 `Date.now`、`node:crypto.randomBytes` 和 resolver 的默认 DNS/HTTP 实现；测试只替换这三个边界。

- [ ] **Step 4: 实现门面方法**

方法签名固定为：

```ts
discover(
  input: {scriptId?: string; urlPattern?: string; limit?: number},
  access: SourceMapRuntimeAccess,
): ReturnType<SourceMapResolver['discover']>;

parse(
  input: SourceMapParseInput,
  access: SourceMapRuntimeAccess,
): Promise<{mapId: string; cacheHit: boolean; summary: SourceMapSummary; provenance: ResolvedSourceMap['provenance']; warnings: string[]}>;

lookup(
  input: SourceMapLookupInput & {mapId: string},
): SourceMapLookupResult;

diff(input: {
  leftMapId: string;
  rightMapId: string;
  mode?: 'summary' | 'sources' | 'mappings';
  maxChanges?: number;
}): SourceMapDiffResult;

reconstructTree(
  input: SourceMapReconstructInput,
  access: SourceMapRuntimeAccess,
): Promise<SourceMapReconstructResult>;
```

`reconstructTree()` 的 root 选择顺序：显式 `outputDir`；否则 `taskId` 必须存在且 `access.resolveExistingTaskDir(taskId)` 返回目录；否则抛 `OUTPUT_PATH_REQUIRED`。`taskId` 不存在时抛 `OUTPUT_PATH_REQUIRED`，不得调用 `ReverseTaskStore.openTask()` 创建任务。

- [ ] **Step 5: 运行 service 测试并确认绿灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/SourceMapService.test.js
```

Expected: cache hit、base isolation、entry limit、byte limit、TTL、lookup、diff、reconstruct dispatch tests pass。

- [ ] **Step 6: 提交服务门面**

```bash
git add src/modules/sourcemap/types.ts src/modules/sourcemap/SourceMapService.ts tests/unit/modules/sourcemap/SourceMapService.test.ts
git commit -m "feat(sourcemap): add bounded service cache"
```

---

### Task 7: 接入配置、RuntimeServices 与非激活 Debugger peek

**Files:**

- Modify: `src/config/servicesConfig.ts:1-377`
- Modify: `src/runtime/RuntimeServices.ts:27-84`
- Modify: `src/runtime.ts:46-154`
- Modify: `src/worker/context/DebuggerContextProvider.ts:18-84`
- Modify: `src/worker/ToolContext.ts:154-241`
- Create: `tests/unit/config/servicesConfig.sourcemap.test.ts`
- Modify: `tests/unit/runtime/RuntimeServices.test.ts`
- Modify: `tests/unit/worker/DebuggerContextProvider.test.ts`

**Interfaces:**

- Consumes: `SourceMapConfig`、`SourceMapService`。
- Produces: `getSourceMapConfig()`、`RuntimeServices.getSourceMapService()`、`Runtime.sourceMapService?`、`DebuggerContextProvider.getForPage()`、`ToolContextProvider.getExistingDebuggerContext()`。

- [ ] **Step 1: 在修改高扇入 Runtime 前执行影响分析**

Run through codebase-memory:

```text
search_graph(name_pattern="^(Runtime|getRuntime)$", file_pattern="src/**/*.ts", include_connected=true)
trace_path(function_name="getRuntime", direction="inbound", depth=2, include_tests=true)
```

Expected: 记录调用方；确认计划只新增可选 `sourceMapService?: SourceMapService` 和生产 getter，不修改任何现有必填属性或方法签名。

- [ ] **Step 2: 写配置失败测试**

```ts
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {getSourceMapConfig} from '../../../src/config/servicesConfig.js';
import {SourceMapError} from '../../../src/modules/sourcemap/types.js';

const keys = [
  'SOURCEMAP_MAX_BYTES',
  'SOURCEMAP_CACHE_MAX_BYTES',
  'SOURCEMAP_CACHE_MAX_ENTRIES',
  'SOURCEMAP_CACHE_TTL_MS',
  'SOURCEMAP_FETCH_TIMEOUT_MS',
] as const;

afterEach(() => keys.forEach(key => delete process.env[key]));

describe('getSourceMapConfig', () => {
  it('returns approved defaults', () => {
    assert.deepEqual(getSourceMapConfig(), {
      maxBytes: 20 * 1024 * 1024,
      cacheMaxBytes: 64 * 1024 * 1024,
      cacheMaxEntries: 16,
      cacheTtlMs: 30 * 60 * 1000,
      fetchTimeoutMs: 15_000,
      maxRedirects: 3,
      maxIndexedDepth: 8,
      maxIndexedSections: 1000,
      maxDiffChanges: 2000,
    });
  });

  it('rejects a cache smaller than one map', () => {
    process.env.SOURCEMAP_MAX_BYTES = String(30 * 1024 * 1024);
    process.env.SOURCEMAP_CACHE_MAX_BYTES = String(20 * 1024 * 1024);
    assert.throws(
      getSourceMapConfig,
      (error: unknown) =>
        error instanceof SourceMapError &&
        error.code === 'SOURCEMAP_CONFIG_INVALID',
    );
  });
});
```

- [ ] **Step 3: 实现配置 getter 和硬上限**

使用现有 `getEnvNumber()`，一个本地 helper 只接受有限正整数；超过硬上限或 cache 小于 max map 时抛 `SOURCEMAP_CONFIG_INVALID`。硬上限：map 100 MiB、cache 256 MiB、entries 64、TTL 24h、timeout 60s。该 getter 只由 lazy service 调用，不加入启动期 `validateConfig()`。

- [ ] **Step 4: 写并实现 RuntimeServices lazy 测试**

在 `RuntimeServices.test.ts` 增加：

```ts
it('creates SourceMapService lazily and reuses it', () => {
  const services = new RuntimeServices(pageController);
  const first = services.getSourceMapService();
  assert.equal(services.getSourceMapService(), first);
});
```

实现：

```ts
private sourceMapService: SourceMapService | null = null;

getSourceMapService(): SourceMapService {
  return (this.sourceMapService ??= new SourceMapService(getSourceMapConfig()));
}
```

`Runtime` 增加 `sourceMapService?: SourceMapService`；生产 runtime object 增加 getter，其他字段不动。

- [ ] **Step 5: 写并实现不激活 CDP 的 peek 测试**

在 `DebuggerContextProvider.test.ts` 增加：

```ts
it('peek does not create a CDP session', () => {
  let newSessionCount = 0;
  const page = {
    isClosed: () => false,
    context: () => ({
      newCDPSession: async () => {
        newSessionCount += 1;
        throw new Error('peek must not create a session');
      },
    }),
    once: () => undefined,
  } as never;
  const provider = new DebuggerContextProvider();
  assert.equal(provider.getForPage(page), undefined);
  assert.equal(newSessionCount, 0);
});
```

实现：

```ts
getForPage(page: Page): DebuggerManager | undefined {
  const manager = this._debuggerManagers.get(page);
  return manager?.isEnabled() ? manager : undefined;
}
```

`ToolContextProvider` 增加同步方法：

```ts
getExistingDebuggerContext(page?: Page): DebuggerManager | undefined {
  const target = page ?? this.getSelectedPage();
  return target ? this._debuggerContext.getForPage(target) : undefined;
}
```

不得修改现有 `getDebuggerContext()`；SourceMap 只调用新 peek。

- [ ] **Step 6: 运行配置、runtime 和 worker tests**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/config/servicesConfig.sourcemap.test.js build/tests/unit/runtime/RuntimeServices.test.js build/tests/unit/worker/DebuggerContextProvider.test.js
```

Expected: defaults、invalid config、lazy identity、peek no-CDP tests pass。

- [ ] **Step 7: 提交运行时接线**

```bash
git add src/config/servicesConfig.ts src/runtime/RuntimeServices.ts src/runtime.ts src/worker/context/DebuggerContextProvider.ts src/worker/ToolContext.ts tests/unit/config/servicesConfig.sourcemap.test.ts tests/unit/runtime/RuntimeServices.test.ts tests/unit/worker/DebuggerContextProvider.test.ts
git commit -m "feat(sourcemap): wire lazy runtime service"
```

---

### Task 8: 注册五个 MCP 工具并构造运行时 access

**Files:**

- Create: `src/tools/sourcemap/index.ts`
- Create: `src/tools/sourcemap/manifest.ts`
- Create: `tests/unit/tools/sourcemap/SourceMapTools.test.ts`
- Modify: `scripts/generate-tools-index.ts:16-44`
- Modify: `src/tools/generated-tools-index.ts` via generator
- Modify: `tests/unit/tools/ToolRegistry.profile.test.ts`

**Interfaces:**

- Consumes: `getRuntime().sourceMapService`、`ToolContextProvider`、`ReverseTaskStore`、五个 service 方法。
- Produces: `sourcemapDiscover`、`sourcemapParse`、`sourcemapLookup`、`sourcemapReconstructTree`、`sourcemapDiff` 和 sourcemap manifest。

- [ ] **Step 1: 写工具 schema、annotation 和 manifest 失败测试**

```ts
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';

import {setRuntime} from '../../../../src/runtime.js';
import {SourceMapError} from '../../../../src/modules/sourcemap/types.js';
import {
  sourcemapDiff,
  sourcemapDiscover,
  sourcemapLookup,
  sourcemapParse,
  sourcemapReconstructTree,
} from '../../../../src/tools/sourcemap/index.js';
import {manifest} from '../../../../src/tools/sourcemap/manifest.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

afterEach(() => setRuntime(undefined));

describe('SourceMap tools', () => {
  it('exports exactly five full-profile tools', () => {
    assert.equal(manifest.profile, 'full');
    assert.deepEqual(
      manifest.tools.map(item => item.handlerName),
      [
        'sourcemapDiscover',
        'sourcemapParse',
        'sourcemapLookup',
        'sourcemapReconstructTree',
        'sourcemapDiff',
      ],
    );
  });

  it('marks only reconstruction as mutating', () => {
    assert.equal(sourcemapDiscover.annotations.readOnlyHint, true);
    assert.equal(sourcemapParse.annotations.readOnlyHint, true);
    assert.equal(sourcemapLookup.annotations.readOnlyHint, true);
    assert.equal(sourcemapDiff.annotations.readOnlyHint, true);
    assert.equal(sourcemapReconstructTree.annotations.readOnlyHint, false);
  });

  it('returns the common envelope and a stable domain error code', async () => {
    setRuntime({
      sourceMapService: {
        lookup: () => {
          throw new SourceMapError('MAP_NOT_FOUND', 'Map is unavailable');
        },
      },
    } as never);
    const response = new ToolResponseAccumulator();
    await sourcemapLookup.handler(
      {
        params: {
          mapId: `sm_${'0'.repeat(32)}`,
          direction: 'generated_to_original',
          line: 1,
          column: 0,
        },
      },
      response,
      {} as never,
    );
    assert.deepEqual(response.toJSON().structuredContent, {
      success: false,
      message: 'Map is unavailable',
      tooltype: 'sourcemap_lookup',
      data: {code: 'MAP_NOT_FOUND'},
    });
  });
});
```

- [ ] **Step 2: 运行工具测试并确认红灯**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/sourcemap/SourceMapTools.test.js
```

Expected: tool domain 不存在。

- [ ] **Step 3: 实现统一响应与 runtime access adapter**

`index.ts` 定义一个错误边界，不复制五次 try/catch：

```ts
async function respond<T>(
  response: Pick<ToolResponseAccumulator, 'setStructuredContent'>,
  tooltype: string,
  action: () => Promise<T> | T,
): Promise<void> {
  try {
    const data = await action();
    response.setStructuredContent({
      success: true,
      message: `${tooltype} completed`,
      tooltype,
      data,
    });
  } catch (error) {
    if (!(error instanceof SourceMapError)) {
      throw error;
    }
    response.setStructuredContent({
      success: false,
      message: error.message,
      tooltype,
      data: {code: error.code},
    });
  }
}
```

从 `src/worker/ToolResponse.ts` 以 type-only import 导入已导出的 `ToolResponseAccumulator`。只转换预期的 `SourceMapError`；未知编程错误继续交给现有 `ToolExecutionPipeline` 处理，不伪装为 `PARSE_FAILED`。

`createRuntimeAccess()`：

- `listScripts()` 调用 `runtime.contextProvider?.getExistingDebuggerContext()?.getScripts()`，无现有 manager 返回 `[]`，禁止调用 `getDebuggerContext()`。
- `findCapturedBody(url)` 遍历 `contextProvider.getNetworkRequests(true)` 的 exact URL；读取 `response.headers()['content-length']` 预检，再调用 `response.body()`；成功读取才返回 `complete:true`。
- `getCookies(url)` 调用 selected page 的 `context().cookies(url)`。
- `getPageUrl()` 返回 selected page URL。
- `resolveExistingTaskDir(taskId)` 先 `reverseTaskStore.readSnapshot(taskId, 'task.json')`，存在才返回 `getTaskDir(taskId)`，不得调用 `openTask()`。

- [ ] **Step 4: 定义五个精确 Zod schema**

```ts
const discoverSchema = {
  scriptId: zod.string().min(1).optional(),
  urlPattern: zod.string().optional(),
  limit: zod.number().int().positive().max(1000).optional().default(100),
};

const parseSchema = {
  scriptId: zod.string().min(1).optional(),
  mapUrl: zod.string().min(1).optional(),
  mapContent: zod.string().min(1).optional(),
  generatedUrl: zod.string().min(1).optional(),
  allowCrossOrigin: zod.boolean().optional().default(false),
};

const lookupSchema = {
  mapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  direction: zod.enum(['generated_to_original', 'original_to_generated']),
  line: zod.number().int().positive(),
  column: zod.number().int().nonnegative(),
  source: zod.string().min(1).optional(),
  bias: zod.enum(['greatest_lower_bound', 'least_upper_bound']).optional(),
};

const reconstructSchema = {
  mapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  taskId: zod.string().min(1).optional(),
  outputDir: zod.string().min(1).optional(),
  overwrite: zod.boolean().optional().default(false),
};

const diffSchema = {
  leftMapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  rightMapId: zod.string().regex(/^sm_[a-f0-9]{32}$/),
  mode: zod
    .enum(['summary', 'sources', 'mappings'])
    .optional()
    .default('summary'),
  maxChanges: zod.number().int().positive().max(2000).optional().default(200),
};
```

Handler 边界额外检查 parse 三选一和 original-to-generated 的 `source`；失败交给 service 的稳定错误码。

- [ ] **Step 5: 定义五个工具与 manifest**

所有工具使用 `ToolCategory.REVERSE_ENGINEERING`。Handler 分别调用：

```ts
service.discover(request.params, access);
service.parse(request.params, access);
service.lookup(request.params);
service.reconstructTree(request.params, access);
service.diff(request.params);
```

Manifest：

```ts
export const manifest = {
  name: 'sourcemap',
  description:
    'SourceMap discovery, parsing, lookup, reconstruction, and diff tools.',
  profile: 'full',
  tools: [
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapDiscover'},
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapParse'},
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapLookup'},
    {
      modulePath: './sourcemap/index.js',
      handlerName: 'sourcemapReconstructTree',
    },
    {modulePath: './sourcemap/index.js', handlerName: 'sourcemapDiff'},
  ],
} satisfies DomainManifest;
```

- [ ] **Step 6: 生成索引并运行工具/registry tests**

在 `DOMAIN_DESCRIPTIONS` 加 `sourcemap`，然后运行：

```bash
npm run build:index
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/unit/tools/sourcemap/SourceMapTools.test.js build/tests/unit/tools/ToolRegistry.profile.test.js
```

Expected: generated index 包含 5 个新 handler；`full` profile 可见，较小 profile 不包含；工具 tests pass。

- [ ] **Step 7: 提交工具域**

```bash
git add src/tools/sourcemap src/tools/generated-tools-index.ts scripts/generate-tools-index.ts tests/unit/tools/sourcemap/SourceMapTools.test.ts tests/unit/tools/ToolRegistry.profile.test.ts
git commit -m "feat(sourcemap): expose five MCP tools"
```

---

### Task 9: 增加集成/属性测试、文档并完成最终验证

**Files:**

- Create: `tests/integration/tools/sourcemap.integration.test.ts`
- Create: `tests/property/modules/sourcemap-paths.property.test.ts`
- Create: `docs/reference/sourcemap.md`
- Modify: `docs/reference/tool-reference.md`
- Modify: 仅为修复本任务测试发现的 SourceMap 文件

**Interfaces:**

- Consumes: 完整 SourceMapService、五个工具、ToolRegistry。
- Produces: 用户文档、端到端证据和最终可交付 diff。

- [ ] **Step 1: 写 discover → parse → lookup → diff → reconstruct 集成测试**

```ts
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {it} from 'node:test';

import {SourceMapService} from '../../../src/modules/sourcemap/SourceMapService.js';
import type {
  SourceMapConfig,
  SourceMapRuntimeAccess,
} from '../../../src/modules/sourcemap/types.js';

const BASIC_MAP = JSON.stringify({
  version: 3,
  sources: ['src/main.ts'],
  sourcesContent: ['export const main = true;\n'],
  names: [],
  mappings: 'AAAA',
});

const CHANGED_MAP = JSON.stringify({
  version: 3,
  sources: ['src/main.ts', 'src/extra.ts'],
  sourcesContent: ['export const main = true;\n', 'export const extra = 1;\n'],
  names: [],
  mappings: 'AAAA;ACAA',
});

const INTEGRATION_CONFIG: SourceMapConfig = {
  maxBytes: 1024 * 1024,
  cacheMaxBytes: 4 * 1024 * 1024,
  cacheMaxEntries: 8,
  cacheTtlMs: 60_000,
  fetchTimeoutMs: 1000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

function createIntegrationHarness() {
  let requests = 0;
  let ids = 0;
  const mapUrl = 'https://example.com/app.js.map';
  const access: SourceMapRuntimeAccess = {
    listScripts: () => [
      {
        scriptId: 'script-1',
        generatedUrl: 'https://example.com/app.js',
        sourceMapURL: mapUrl,
      },
    ],
    findCapturedBody: async url =>
      url === mapUrl ? {url, content: BASIC_MAP, complete: true} : undefined,
    getCookies: async () => [],
    getPageUrl: () => 'https://example.com/app.js',
    resolveExistingTaskDir: async () => undefined,
  };
  const service = new SourceMapService(INTEGRATION_CONFIG, {
    randomBytes: size => Buffer.alloc(size, (ids += 1)),
    resolverDependencies: {
      lookup: async () => [{address: '93.184.216.34', family: 4}],
      request: async () => {
        requests += 1;
        throw new Error('captured body should prevent a request');
      },
    },
  });
  return {service, access, getRequestCount: () => requests};
}

it('runs the explicit SourceMap workflow without implicit writes', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'sourcemap-flow-'));
  const {service, access, getRequestCount} = createIntegrationHarness();
  const discovered = service.discover({}, access);
  assert.equal(discovered.candidates[0]?.scriptId, 'script-1');

  const first = await service.parse({scriptId: 'script-1'}, access);
  const second = await service.parse({mapContent: CHANGED_MAP}, access);
  assert.equal(
    service.lookup({
      mapId: first.mapId,
      direction: 'generated_to_original',
      line: 1,
      column: 0,
    }).match?.line,
    1,
  );
  assert.equal(
    service.diff({leftMapId: first.mapId, rightMapId: second.mapId})
      .summaryChanged,
    true,
  );
  assert.deepEqual(await readdir(outputDir), []);
  assert.equal(getRequestCount(), 0);

  const tree = await service.reconstructTree(
    {mapId: first.mapId, outputDir, overwrite: false},
    access,
  );
  assert.equal(
    JSON.parse(await readFile(tree.manifestPath, 'utf8')).mapId,
    first.mapId,
  );
});
```

- [ ] **Step 2: 写路径和缓存属性测试**

`tests/property/modules/sourcemap-paths.property.test.ts`：

```ts
import assert from 'node:assert/strict';
import path from 'node:path';
import {it} from 'node:test';

import fc from 'fast-check';

import {normalizeSourcePath} from '../../../src/modules/sourcemap/SourceMapReconstructor.js';
import {SourceMapService} from '../../../src/modules/sourcemap/SourceMapService.js';
import type {
  SourceMapConfig,
  SourceMapRuntimeAccess,
} from '../../../src/modules/sourcemap/types.js';

const PROPERTY_CONFIG: SourceMapConfig = {
  maxBytes: 4096,
  cacheMaxBytes: 8192,
  cacheMaxEntries: 2,
  cacheTtlMs: 60_000,
  fetchTimeoutMs: 1000,
  maxRedirects: 3,
  maxIndexedDepth: 8,
  maxIndexedSections: 1000,
  maxDiffChanges: 2000,
};

const PROPERTY_ACCESS: SourceMapRuntimeAccess = {
  listScripts: () => [],
  findCapturedBody: async () => undefined,
  getCookies: async () => [],
  getPageUrl: () => undefined,
  resolveExistingTaskDir: async () => undefined,
};

it('never produces an absolute or escaping source path', () => {
  fc.assert(
    fc.property(fc.string(), fc.nat(), (source, index) => {
      const normalized = normalizeSourcePath(source, index);
      assert.equal(path.isAbsolute(normalized), false);
      assert.equal(normalized.split('/').includes('..'), false);
      assert.ok(normalized.length > 0);
    }),
    {numRuns: 1000},
  );
});

it('keeps cache entry and byte limits under arbitrary parse sequences', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.string({maxLength: 32}), {maxLength: 100}),
      async contents => {
        const service = new SourceMapService(PROPERTY_CONFIG);
        for (const [index, content] of contents.entries()) {
          await service.parse(
            {
              mapContent: JSON.stringify({
                version: 3,
                sources: [`source-${index}.ts`],
                sourcesContent: [content],
                names: [],
                mappings: 'AAAA',
              }),
            },
            PROPERTY_ACCESS,
          );
          const stats = service.getCacheStats();
          assert.ok(stats.entries <= PROPERTY_CONFIG.cacheMaxEntries);
          assert.ok(stats.bytes <= PROPERTY_CONFIG.cacheMaxBytes);
        }
      },
    ),
    {numRuns: 100},
  );
});
```

- [ ] **Step 3: 运行新增 integration/property tests 并修复 SourceMap 范围内失败**

Run:

```bash
npm run build:compile
node --require ./build/tests/setup.js --test build/tests/integration/tools/sourcemap.integration.test.js
node --require ./build/tests/setup.js --test build/tests/property/modules/sourcemap-paths.property.test.js
```

Expected: explicit flow 和 1,000-run path property pass。只修改 `src/modules/sourcemap/`、`src/tools/sourcemap/` 或本计划列出的接线文件；无关失败只记录，不顺手修复。

- [ ] **Step 4: 编写 SourceMap 用户文档**

`docs/reference/sourcemap.md` 必须包含：

```markdown
# SourceMap 工具

SourceMap 工具仅在 `full` profile 中可用。除 `sourcemap_reconstruct_tree` 外均为只读操作。

## 推荐流程

1. `sourcemap_discover` 读取已经存在的 Debugger 脚本元数据；它不会激活新的 CDP 域。
2. `sourcemap_parse` 从 `scriptId`、`mapUrl`、`mapContent` 三者之一生成进程内 `mapId`。
3. `sourcemap_lookup` 使用 line 1-based、column 0-based 坐标双向查询。
4. `sourcemap_diff` 比较两个 `mapId`，明细有界但总数完整。
5. `sourcemap_reconstruct_tree` 显式写入任务目录或安全 `outputDir`。

## 安全边界

- 跨源默认拒绝，必须显式 `allowCrossOrigin=true`。
- 跨源仍拒绝私网、loopback、非法协议、URL credentials、危险重定向和超限响应。
- 缺失 `sourcesContent` 只记录，不继续联网补源。
- `mapId` 在 worker 重启、TTL 或 LRU 淘汰后失效。
```

在 `docs/reference/tool-reference.md` 的相关入口加入一条 `SourceMap 专题` 相对链接，不重排其他章节。

- [ ] **Step 5: 运行 SourceMap 覆盖率检查**

Run:

```bash
npm run build:compile
npx c8 --include=build/src/modules/sourcemap/**/*.js --include=build/src/tools/sourcemap/**/*.js --reporter=text node --require ./build/tests/setup.js --test build/tests/unit/modules/sourcemap/*.test.js build/tests/unit/tools/sourcemap/*.test.js build/tests/integration/tools/sourcemap.integration.test.js build/tests/property/modules/sourcemap-paths.property.test.js
```

Expected: statements 和 branches 均达到 80% 或更高。若不足，只增加命中已批准行为/失败路径的测试，不为覆盖率添加无意义分支。

- [ ] **Step 6: 执行最终 diff 边界验证**

先确认暂存/工作区范围：

```bash
git status --short
git diff -- src/modules/sourcemap src/tools/sourcemap src/config/servicesConfig.ts src/runtime/RuntimeServices.ts src/runtime.ts src/worker/context/DebuggerContextProvider.ts src/worker/ToolContext.ts scripts/generate-tools-index.ts src/tools/generated-tools-index.ts package.json package-lock.json tests/fixtures/sourcemap tests/unit/modules/sourcemap tests/unit/config/servicesConfig.sourcemap.test.ts tests/unit/runtime/RuntimeServices.test.ts tests/unit/worker/DebuggerContextProvider.test.ts tests/unit/tools/sourcemap tests/unit/tools/ToolRegistry.profile.test.ts tests/integration/tools/sourcemap.integration.test.ts tests/property/modules/sourcemap-paths.property.test.ts docs/reference/sourcemap.md docs/reference/tool-reference.md
```

然后在最后一次代码修改后依次运行：

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:property
npm run check-format
```

Expected: 全部通过。若仓库已有无关失败，保存完整失败输出，重新运行直接相关测试并证明失败文件不在本次 diff；不得用修改前结果替代。

- [ ] **Step 7: 复查反检测与许可证边界**

Run:

```bash
git diff --unified=0 | rg "Runtime\.enable|Console\.enable|StealthScripts2025|addInitScript|evaluateOnNewDocument|open-source/jshookmcp"
```

Expected: 无新增启动期 CDP/JS 注入和 jshookmcp 引用。允许测试断言或文档明确写出“不得调用”时，逐条人工确认不是实现调用。

- [ ] **Step 8: 提交集成证据与文档**

```bash
git add tests/integration/tools/sourcemap.integration.test.ts tests/property/modules/sourcemap-paths.property.test.ts docs/reference/sourcemap.md docs/reference/tool-reference.md
git add src/modules/sourcemap src/tools/sourcemap src/config/servicesConfig.ts src/runtime/RuntimeServices.ts src/runtime.ts src/worker/context/DebuggerContextProvider.ts src/worker/ToolContext.ts scripts/generate-tools-index.ts src/tools/generated-tools-index.ts package.json package-lock.json
git add tests/fixtures/sourcemap tests/unit/modules/sourcemap tests/unit/config/servicesConfig.sourcemap.test.ts tests/unit/runtime/RuntimeServices.test.ts tests/unit/worker/DebuggerContextProvider.test.ts tests/unit/tools/sourcemap tests/unit/tools/ToolRegistry.profile.test.ts
git commit -m "test(sourcemap): verify full migration workflow"
```

提交前运行 `git diff --cached --name-only`；发现任何不在本计划 File Map 中的文件时取消暂存该文件，不得把用户并行改动带入提交。

---

## Completion Evidence

完成实施时交接必须包含：

- 9 个任务对应的 commit 列表。
- 五个工具在 `full` profile 的 registry 证据。
- v3 basic/inline/external/indexed、外部 section、缺失内容、metadata 的测试结果。
- 跨源拒绝、私网/DNS rebinding、重定向、超限和路径穿越测试结果。
- SourceMap 范围的 80% 以上覆盖率输出。
- 最后一次修改后的 typecheck、unit、integration、property、format 结果。
- `git diff --check` 与最终 `git status --short`。
- 明确说明没有自动 CDP 激活、页面 JS 注入或 AGPL 源码引用。
