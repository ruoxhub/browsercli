# 离线静态逆向工具集技能化实现计划 (Offline Reverse Tools Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 5 大离线逆向工具分类（SourceMap还原、Wasm脱机工具链、逆向知识库与向导、Rebuild环境补齐、AST/算法审计）按设计规范重构为独立的技能与 CLI 脚本。

**Architecture:** 采用“2 个全新独立技能 + 3 个现有技能注入”的混合架构。所有脚本采用原生 Node.js ESM (`node:*`) 编写，杜绝 `require` 错误，切断对全局 `getRuntime()` 与 `BrowserManager` 的耦合，支持标准 CLI 参数（`--help`、`--json`）与确定性单元自测。

**Tech Stack:** Node.js v22 (Native ESM), Babel (@babel/parser, @babel/traverse), WABT, source-map / @jridgewell/trace-mapping, native CLI (wasmtime/wasmer).

**Spec:** `docs/superpowers/specs/2026-09-12-offline-reverse-tools-design.md`

## Global Constraints

- 统一采用 Node.js 原生 ESM 模块化规范 (`import ... from 'node:*'`)，严禁出现 CommonJS `require`。
- 严禁导入 `src/runtime.ts`、`RuntimeServices` 或任何会触发浏览器控制器的模块。
- 脚本必须具备清晰的 CLI 参数处理（支持 `--help` 查看说明，`--json` 输出纯数据便于机器消费）。
- Node 21+ 下注入 `globalThis.navigator` 必须使用 `Object.defineProperty`。
- 所有技能文档变动必须符合 `scripts/verify-skills-schema.ts` 格式规范。

---

### Task 1: 创建独立技能 `skills/sourcemap-reverse/`

**Files:**
- Create: `skills/sourcemap-reverse/SKILL.md`
- Create: `skills/sourcemap-reverse/scripts/reconstruct-tree.js`
- Create: `skills/sourcemap-reverse/scripts/lookup-symbol.js`
- Create: `skills/sourcemap-reverse/scripts/diff-sourcemap.js`

**Interfaces:**
- Consumes: JSON SourceMap (v3), 包含 `sources` 与 `sourcesContent`。
- Produces: 还原至磁盘的原始项目工程代码树，支持精准符号行列号映射。

- [ ] **Step 1: 编写 `reconstruct-tree.js` 脚本**
  - 读取 `.map` 文件或包含内嵌 SourceMap 的文件。
  - 清理 `webpack://`、`vite://`、`../` 等前缀与非法相对路径字符，防止目录穿越。
  - 将每个未混淆文件的源码完整写入目标输出目录。
- [ ] **Step 2: 编写 `lookup-symbol.js` 与 `diff-sourcemap.js` 脚本**
  - `lookup-symbol.js`：解析 mappings，支持生成坐标与原始坐标互相映射。
  - `diff-sourcemap.js`：比对两个 map 文件包含的文件集合差异。
- [ ] **Step 3: 编写 `skills/sourcemap-reverse/SKILL.md` 文档**
  - 说明技能定义、触发词、推荐工作流与 3 个脚本的 CLI 用法示例。
- [ ] **Step 4: 运行自测**
  - 构造包含简单 `sourcesContent` 的 mock `.map` 文件，执行 `reconstruct-tree.js` 验证文件是否正确生成。
- [ ] **Step 5: 提交代码**
  - `git add skills/sourcemap-reverse && git commit -m "feat(skills): add sourcemap-reverse skill and scripts"`

---

### Task 2: 创建独立技能 `skills/reverse-knowledge/`

**Files:**
- Create: `skills/reverse-knowledge/SKILL.md`
- Create: `skills/reverse-knowledge/scripts/query-blueprint.js`
- Create: `skills/reverse-knowledge/scripts/stage-advisor.js`

**Interfaces:**
- Consumes: `docs/knowledge/parameter-blueprints/index.json` 及平台算法蓝图。
- Produces: 离线算法方案展示、参数分解（parts）、变异规则（mutations）与 6 大阶段决策向导。

- [ ] **Step 1: 编写 `query-blueprint.js` 脚本**
  - 实现 `--list` 列出京东 h5st、抖音 a_bogus、快手 falcon 等蓝图。
  - 实现 `--id <id>` 查看蓝图详情与 parts 结构。
  - 实现 `--query <text>` 关键词与别名模糊推荐。
- [ ] **Step 2: 编写 `stage-advisor.js` 脚本**
  - 实现 `--explain <stage|all>` 解释 6 大阶段标准。
  - 实现状态机建议：根据 `--has-target`、`--passing`、`--hook-records` 输出下一步动作。
- [ ] **Step 3: 编写 `skills/reverse-knowledge/SKILL.md` 文档**
  - 注册技能定义、触发词与阶段速查表。
- [ ] **Step 4: 运行自测**
  - `node skills/reverse-knowledge/scripts/query-blueprint.js --list`
  - `node skills/reverse-knowledge/scripts/stage-advisor.js --explain Observe`
- [ ] **Step 5: 提交代码**
  - `git add skills/reverse-knowledge && git commit -m "feat(skills): add reverse-knowledge skill and scripts"`

---

### Task 3: 在 `skills/wsam-reverse/` 注入离线 Wasm 工具链

**Files:**
- Create: `skills/wsam-reverse/scripts/wasm-decompile.js`
- Create: `skills/wsam-reverse/scripts/wasm-disassemble.js`
- Create: `skills/wsam-reverse/scripts/wasm-inspect.js`
- Create: `skills/wsam-reverse/scripts/wasm-run.js`
- Modify: `skills/wsam-reverse/SKILL.md`

**Interfaces:**
- Consumes: `.wasm` 二进制文件。
- Produces: WAT 文本格式、类 C 伪代码、节区段表信息与脱机执行结果。

- [ ] **Step 1: 编写 `wasm-decompile.js` 与 `wasm-disassemble.js`**
  - 复用 `wabt` 库，提供 `--input <file.wasm>`，可选 `--output <file.wat>`。
  - 支持折叠表达式 (`foldExprs`) 与导出名内联。
- [ ] **Step 2: 编写 `wasm-inspect.js`**
  - 读取二进制 Buffer，解析 Wasm Magic Number、版本、Section ID 表、导出函数名与可读字符串。
- [ ] **Step 3: 编写 `wasm-run.js`**
  - 探测本地 `wasmtime` / `wasmer` CLI，提供 `--invoke <functionName>` 和 `--args <arg1,arg2>` 命令行执行器。
- [ ] **Step 4: 更新 `skills/wsam-reverse/SKILL.md`**
  - 在文档中新增“离线 CLI 工具（免启动浏览器）”章节，列出 4 个脚本的用法。
- [ ] **Step 5: 运行自测**
  - 对样本 wasm 或最小二进制执行 inspect 与 decompile 自检。
- [ ] **Step 6: 提交代码**
  - `git add skills/wsam-reverse && git commit -m "feat(wsam-reverse): add offline wasm scripts"`

---

### Task 4: 在 `skills/web-reverse-env/` 注入 Rebuild 脱机工具

**Files:**
- Create: `skills/web-reverse-env/scripts/diff-env-requirements.js`
- Create: `skills/web-reverse-env/scripts/export-rebuild-bundle.js`
- Modify: `skills/web-reverse-env/SKILL.md`

**Interfaces:**
- Consumes: Node 运行时报错字符串，目标逆向 JS 代码。
- Produces: 缺失能力推断与最小补丁代码，独立的脱机运行工程目录。

- [ ] **Step 1: 编写 `diff-env-requirements.js`**
  - 输入 `--error "..."` 或 `--file log.txt`。
  - 匹配 `window`、`document`、`navigator`、`crypto`、`localStorage`、`sessionStorage`、`location`，输出缺失原因与建议补丁。
- [ ] **Step 2: 编写 `export-rebuild-bundle.js`**
  - 导出包含 `entry.js`、`env.js`、`polyfills.js`、`target.js`、`package.json` 的标准目录。
  - 处理 Node 21+ 下 `globalThis.navigator` 的 getter 保护（使用 `Object.defineProperty`）。
- [ ] **Step 3: 更新 `skills/web-reverse-env/SKILL.md`**
  - 在 scripts 列表中补充这两个工具的说明与典型用法。
- [ ] **Step 4: 运行自测**
  - `node skills/web-reverse-env/scripts/diff-env-requirements.js --error "ReferenceError: window is not defined"`
  - `node skills/web-reverse-env/scripts/export-rebuild-bundle.js --output-dir ./temp-test && node ./temp-test/entry.js && rm -rf ./temp-test`
- [ ] **Step 5: 提交代码**
  - `git add skills/web-reverse-env && git commit -m "feat(web-reverse-env): add diff-env and export-bundle scripts"`

---

### Task 5: 注入 AST 虚拟机分析与算法探测脚本

**Files:**
- Create: `skills/ast-deobfuscation/scripts/analyze-jsvmp-vm.js`
- Create: `skills/web-reverse-algorithm/scripts/detect-crypto.js`
- Modify: `skills/ast-deobfuscation/SKILL.md`
- Modify: `skills/web-reverse-algorithm/SKILL.md`

**Interfaces:**
- Consumes: JavaScript 混淆源码。
- Produces: JSVMP 骨架（分派器、字节码来源、Opcode 分布）、加密算法与库匹配结果。

- [ ] **Step 1: 编写 `analyze-jsvmp-vm.js`**
  - 基于 `@babel/parser` 与 `@babel/traverse` 实现纯静态分派器（while-switch / index dispatch）与 Opcode 提取，不依赖 live page。
  - 放置于 `skills/ast-deobfuscation/scripts/`，与现有的 `deobfuscate-jsvmp.js` 形成前后配合。
- [ ] **Step 2: 编写 `detect-crypto.js`**
  - 基于 AST 模式与常量特征库，扫描对称加密、非对称加密、哈希摘要与密码学库特征。
  - 放置于 `skills/web-reverse-algorithm/scripts/`，用于第一步题型判定。
- [ ] **Step 3: 更新对应 `SKILL.md`**
  - 分别在两者的 `SKILL.md` 中添加对应脚本的 CLI 调用指南。
- [ ] **Step 4: 运行自测**
  - 测试样例脚本扫描与输出。
- [ ] **Step 5: 提交代码**
  - `git add skills/ast-deobfuscation skills/web-reverse-algorithm && git commit -m "feat(skills): add analyze-jsvmp-vm and detect-crypto scripts"`

---

### Task 6: 技能索引统一注册与规范门禁校验

**Files:**
- Modify: `skills/AGENTS.md`
- Test: `npm run verify-skills`

- [ ] **Step 1: 更新 `skills/AGENTS.md` 目录索引**
  - 将 `sourcemap-reverse/` 与 `reverse-knowledge/` 注册进 Subdirectories 列表。
- [ ] **Step 2: 运行规范门禁校验**
  - 执行 `npm run verify-skills` 确保所有技能文档格式正常，无未定义或缺失参数。
- [ ] **Step 3: 整体提交**
  - `git add skills/AGENTS.md && git commit -m "docs(skills): register new skills in AGENTS.md"`
