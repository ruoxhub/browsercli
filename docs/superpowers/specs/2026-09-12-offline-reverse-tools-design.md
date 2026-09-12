# 离线静态逆向工具集技能化重构设计规范 (Offline Reverse Tools Design)

- **日期**：2026-09-12
- **状态**：Draft -> Pending User Review
- **责任范围**：`skills/` 离线逆向工具拓扑重构、解耦实现与 CLI 契约规范

---

## 1. 背景与目标

### 1.1 现状与痛点
当前 `Reverser-CLI` 仓库在 MCP 注册表中注册了 167+ 个工具，全量暴露时会消耗 Agent 上下文 ~40K+ tokens。经系统性分析与 CodeGraph 拓扑探索，其中有 5 大核心分类（静态代码理解、WebAssembly 逆向、SourceMap 工程还原、脱机环境补齐推断、参数签名蓝图与逆向向导）在底层技术上**完全无需启动 Chromium / Patchright / Cloak 浏览器或 proxycli daemon 进程**。

然而目前这部分工具：
1. 缺乏直接可在本地终端或由 Agent 快速执行的独立 Node.js CLI 脚本；
2. 在 MCP 层面高度耦合于全局单例 `getRuntime()` 与 `RuntimeServices`；
3. 部分高价值能力（如 SourceMap 前端工程源码树完整还原）在 `skills/` 中缺少明确归属与专项入口。

### 1.2 目标
1. **解耦与轻量化**：切断静态工具链对全局 `BrowserManager`、`PageController` 等浏览器重量级模块的依赖，实现 100% 离线独立运行。
2. **结构化技能分流**：
   - 具有高度独立价值且现有技能未覆盖的场景（SourceMap 还原、逆向知识库蓝图）建立**独立全新 Skill**；
   - 与现有领域能力强相关的场景（Wasm 离线工具、补环境报错推断、JSVMP 虚拟机分析、加密特征探测）**就近注入到现有 Skill 的 `scripts/`**。
3. **标准化 CLI 契约**：所有产出的脚本均支持统一的 ESM 规范、`--help` 提示、`--json` 输出与错误码标准。

---

## 2. 工具归属拓扑与目录架构

```text
skills/
├── sourcemap-reverse/                     [全新独立技能] SourceMap 前端工程源码还原
│   ├── SKILL.md                          (技能说明、触发词与工作流契约)
│   └── scripts/
│       ├── reconstruct-tree.js           (解析 .map 文件并完整恢复项目源码目录树)
│       ├── lookup-symbol.js              (混淆线上坐标与原始源码行列号双向查找)
│       └── diff-sourcemap.js             (多版本构建产物 SourceMap 差异对比)
│
├── reverse-knowledge/                     [全新独立技能] 逆向知识库、蓝图与阶段向导
│   ├── SKILL.md                          (方法论指引、成熟平台算法库说明)
│   └── scripts/
│       ├── query-blueprint.js            (离线检索 jd-h5st、douyin-a-bogus 等成熟蓝图)
│       └── stage-advisor.js              (逆向 6 大阶段决策状态机与准入准出评估)
│
├── wsam-reverse/                          [现有技能补全] WebAssembly 逆向
│   ├── SKILL.md                          (补充离线 CLI 章节)
│   └── scripts/
│       ├── wasm-decompile.js             (基于 WABT 生成类 C 伪代码与函数特征提取)
│       ├── wasm-disassemble.js           (反汇编为标准 WAT 文本格式)
│       ├── wasm-inspect.js               (解析节区段表、函数签名与内嵌常量字符串)
│       └── wasm-run.js                   (利用 wasmtime/wasmer 命令行脱机执行导出函数)
│
├── web-reverse-env/                       [现有技能补全] 补环境与脱机复现
│   ├── SKILL.md                          (更新 scripts 清单)
│   └── scripts/
│       ├── diff-env-requirements.js      (根据 Node 执行报错智能推断缺失的浏览器对象)
│       └── export-rebuild-bundle.js      (导出独立的 entry.js + env.js + polyfills.js 脚手架)
│
├── ast-deobfuscation/                     [现有技能补全] AST 虚拟机结构解剖
│   └── scripts/
│       └── analyze-jsvmp-vm.js           (Babel AST 静态解析分派器结构与 Opcode 映射)
│
└── web-reverse-algorithm/                 [现有技能补全] 纯算题型快速探测
    └── scripts/
        └── detect-crypto.js              (基于 AST 与特征库快速扫描源码中加解密算法与库)
```

---

## 3. 详细设计与接口契约

### 3.1 SourceMap 还原技能 (`skills/sourcemap-reverse/`)
- **`reconstruct-tree.js`**：
  - *输入*：`<target.js.map>` 文件路径，`--output-dir <dir>`，可选 `--overwrite`。
  - *核心逻辑*：利用 `JSON.parse` 读取 map 数据，遍历 `sources` 与 `sourcesContent`，过滤 `webpack://`、`vite://` 等前缀，清理相对路径非法字符，调用 `node:fs/promises` 将完整代码目录树落盘。
- **`lookup-symbol.js`**：
  - *输入*：`<target.js.map>`，`--line <number>`，`--column <number>`，可选 `--direction <generated_to_original|original_to_generated>`。
  - *输出*：映射到的源文件名、原代码行号、列号与代码片段。
- **`diff-sourcemap.js`**：
  - *输入*：`<left.map>`，`<right.map>`。
  - *输出*：源文件增减列表与关键映射变动摘要。

### 3.2 逆向知识库技能 (`skills/reverse-knowledge/`)
- **`query-blueprint.js`**：
  - *功能*：直接检索仓库内置的 `docs/knowledge/parameter-blueprints/index.json` 及各子目录（京东 `jd-h5st`、抖音 `douyin-a-bogus`、快手 `ks-hxfalcon`、通用 Header 签名与 Query Token）。
  - *命令行*：
    - `--list`：列出所有平台算法方案与状态。
    - `--id <id>`：查看指定算法蓝图的适用范围、parts 结构与 workflow 步骤。
    - `--query <keywords>`：自然语言/关键词匹配推荐。
- **`stage-advisor.js`**：
  - *功能*：沉淀 `Observe` ➔ `Capture` ➔ `Rebuild` ➔ `Patch` ➔ `PureExtraction` ➔ `Port` 状态机。
  - *命令行*：
    - `--explain <stage|all>`：输出准入准出与避坑原则。
    - `--has-target <bool>`、`--passing <bool>`：输入当前状态直接输出当前推荐操作。

### 3.3 WASM 离线工具链 (`skills/wsam-reverse/scripts/`)
- **`wasm-decompile.js`** / **`wasm-disassemble.js`**：
  - 调用 `wabt` 库的 `readWasm()`，生成带有折叠表达式（`foldExprs`）与符号内联的高可读 WAT/伪代码。
- **`wasm-inspect.js`**：
  - 纯二进制 Buffer 读取，解析 Header、Section ID、导出表与包含可读字符串的 Data Section。
- **`wasm-run.js`**：
  - 通过 `node:child_process` 探测本地 `wasmtime` 或 `wasmer`，传入 `--invoke <functionName>` 执行计算并打印返回值。

### 3.4 补环境推断与打包器 (`skills/web-reverse-env/scripts/`)
- **`diff-env-requirements.js`**：
  - 提取 `inferMissingCapabilities` 纯函数，支持 `--error <string>` 或 `--file <log.txt>`，匹配 `window`、`document`、`navigator`、`localStorage`、`sessionStorage`、`crypto`、`location`、`btoa/atob`，输出建议补丁代码块。
- **`export-rebuild-bundle.js`**：
  - 导出独立脱机工程。注意在 Node 21+ 环境下，`navigator` 为 getter，必须采用 `Object.defineProperty(globalThis, 'navigator', { ... })` 注入。

### 3.5 虚拟机分析与加密探测
- **`analyze-jsvmp-vm.js`**：
  - 使用 `@babel/parser` 解析代码，解剖 `switch-case` 分派器、取指循环、字节码来源（IIFE / 数组字面量）与指令表空洞率。
- **`detect-crypto.js`**：
  - 使用 `@babel/parser` 与正则特征库扫描代码中的对称加密（AES/DES/RC4）、非对称加密（RSA/SM2）、哈希散列（MD5/SHA/SM3）以及常见库（CryptoJS/JSEncrypt/forge）。

---

## 4. 依赖解耦与运行时规范

1. **零全局单例污染**：
   所有脚本严禁 `import { getRuntime } from ...`。底层的复用通过直接导入具体类（如 `WasmDecompiler`、`CryptoDetector`）或在脚本内编写自包含纯函数实现。
2. **ESM 原生化**：
   文件统一使用 `.js` 后缀配合 Node 原生 ESM 导入（`import fs from 'node:fs'` 等），杜绝 CommonJS `require` 语法错误。
3. **统一 CLI 输出协议**：
   - 默认输出人类可读的彩色控制台排版；
   - 携带 `--json` 参数时只输出纯合法 JSON 字符串至 `stdout`，便于流水线与 Agent 提取。

---

## 5. 验证标准与测试清单

| 脚本 | 验证命令 | 成功判定标准 |
| :--- | :--- | :--- |
| `reconstruct-tree.js` | `node skills/sourcemap-reverse/scripts/reconstruct-tree.js <test.map> -o ./out` | 源码文件按目录结构完整解包落盘 |
| `query-blueprint.js` | `node skills/reverse-knowledge/scripts/query-blueprint.js --list` | 输出 5 个已知蓝图列表，Exit Code 0 |
| `stage-advisor.js` | `node skills/reverse-knowledge/scripts/stage-advisor.js --explain all` | 输出 6 大阶段目标与准出判定 |
| `diff-env-requirements.js` | `node skills/web-reverse-env/scripts/diff-env-requirements.js -e "window is not defined"` | 输出 window 缺失原因与补丁代码 |
| `export-rebuild-bundle.js` | `node skills/web-reverse-env/scripts/export-rebuild-bundle.js -o ./test-bundle && node ./test-bundle/entry.js` | 生成工程且 node 执行正常退出 |
| `wasm-inspect.js` | `node skills/wsam-reverse/scripts/wasm-inspect.js <sample.wasm>` | 输出节区映射与内嵌字符串 |
| `detect-crypto.js` | `node skills/web-reverse-algorithm/scripts/detect-crypto.js <sample.js>` | 正确检出 CryptoJS 或散列算法 |
## 6. src/tools 原有工具及其关联代码删除清单 (Tools & Associated Code Removal)

为避免能力重复、消除冗余维护负担并彻底精简 MCP 注册表上下文，在技能与 CLI 脚本落地并通过验证后，必须彻底清理 `src/tools/` 中的原有 MCP 工具及强关联死代码：

### 6.1 待完全删除的工具目录与文件
1. **SourceMap 域**：
   - 彻底删除目录 `src/tools/sourcemap/`（包含 `index.ts`, `manifest.ts` 等）。
   - 从 `scripts/generate-tools-index.ts` 中移除 `sourcemap` 域配置。
2. **Rebuild 域**：
   - 彻底删除目录 `src/tools/rebuild/`（包含 `index.ts`, `manifest.ts`, `rebuildFn.ts`, `types.ts` 等）。
   - 从 `scripts/generate-tools-index.ts` 中移除 `rebuild` 域配置。
   - 适配重构 `src/reverse/ExecutionAdapters.ts`，移除对 `src/tools/rebuild/index.js` 的导入与调用绑定。
3. **Workflow 域离线子模块**：
   - 删除 `src/tools/workflow/parameterWorkflows.ts`（已迁移至 `reverse-knowledge`）。
   - 删除 `src/tools/workflow/advisor.ts`（已迁移至 `reverse-knowledge`）。
   - 更新 `src/tools/workflow/manifest.ts` 与 `src/tools/workflow/index.ts`，注销 `list_parameter_workflows`, `get_parameter_workflow`, `recommend_parameter_workflow`, `recommend_next_stepTool`, `explainReverseStage`。
4. **Wasm 域离线工具**：
   - 删除 `src/tools/wasm/wasmDecompile.ts`、`src/tools/wasm/wasmDisassemble.ts`、`src/tools/wasm/wasmInspectSections.ts`、`src/tools/wasm/wasmOfflineRun.ts`、`src/tools/wasm/wasmOptimize.ts`、`src/tools/wasm/wasmCapabilities.ts`、`src/tools/wasm/nativeCommand.ts`。
   - 更新 `src/tools/wasm/manifest.ts` 与 `src/tools/wasm/index.ts`，仅保留依附活体浏览器的抓取工具（`collectWasm`, `wasmDump`, `wasmMemoryInspect`）。
5. **Analyzer / JSVMP 离线分析工具**：
   - 删除 `src/tools/analyzer/detectCrypto.ts`，并同步更新 `src/tools/analyzer/manifest.ts` 与 `index.ts`。
   - 删除 `src/tools/jsvmp/analyzeVm.ts`，并同步更新 `src/tools/jsvmp/manifest.ts` 与 `index.ts`。

### 6.2 索引与测试联动清理
1. **重新生成注册表**：执行 `npm run build:index`，自动重新生成 `src/tools/generated-tools-index.ts`。
2. **关联单测修剪**：清理或适配直接断言被删除 MCP 工具定义的单测文件（如 `tests/unit/tools/sourcemap/`、`tests/unit/functions/rebuild.test.ts`、`tests/unit/tools/jshook-tools.handlers.test.ts` 中针对已移除工具断言的分支）。
3. **构建与类型验证**：执行 `npm run typecheck` 与 `npm run build`，确保无悬挂引用或破坏性破坏。
