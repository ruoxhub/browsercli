# Spike C: monorepo 构建链兼容验证

> **日期**: 2026-05-26
> **临时分支**: `spike/monorepo-build-check`（基于 `add-ui`）
> **结论**: ✅ **可行**。npm workspaces 改造与现有 swc 三段式构建链兼容，无需额外调整。

---

## 1. 背景

`docs/superpowers/specs/2026-05-25-frontend-ui-design.md` §11 风险表自陈：

> npm workspaces 改造与 swc 构建链冲突 ... 改造前先在 spike 分支验证 `npm run build` 全套脚本不破

本 spike 在隔离分支上，最小改动验证：加 `workspaces: ["apps/*"]` 字段 + 一个空的 `apps/web` 占位包后，`build:index → build:compile → build:post` 三段是否仍能跑通。

---

## 2. 改动清单

> 1 个字段 + 1 个文件，零脚本改动。

**`package.json`**（在 `"type": "module"` 之后插入）：

```diff
   "type": "module",
+  "workspaces": [
+    "apps/*"
+  ],
   "bin": {
```

**新文件 `apps/web/package.json`**（占位，无任何依赖）：

```json
{
  "name": "@js-reverse/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Spike-only placeholder. Verifies workspaces does not break root build."
}
```

`package-lock.json` 由 `npm install` 自动重写，新增 11 行（注册 workspace 链接）。

---

## 3. 验证步骤与结果

### 3.1 Baseline（add-ui 上、未启用 workspaces）

```bash
$ npm run build
Generated 27 manifests with 135 tools
Successfully compiled: 506 files with swc (465.37ms)
[exit 0]
```

✅ 基线干净。

### 3.2 启用 workspaces 后

```bash
$ npm install --no-audit --no-fund
added 1 package, and changed 3 packages in 25s

$ npm run build
Generated 27 manifests with 135 tools
Successfully compiled: 506 files with swc (360.76ms)
[exit 0]
```

✅ 三段全部通过，506 文件、135 工具与 baseline **一致**。
✅ 编译时间未受影响（甚至略快，正常波动）。

### 3.3 烟雾测试

```bash
$ node build/src/bin/js-reverse.js --help
js-reverse v2.0.3
JS逆向工程MCP服务 — 标准化前端JavaScript逆向流程

Commands:
  start, stop, status, call, list-tools, config, repl, scaffold
[exit 0]
```

✅ CLI bin 入口加载正常，命令注册完整。

### 3.4 Typecheck

```bash
$ npm run typecheck
tests/unit/modules/Deobfuscator.extended.test.ts(215,7): error TS2353: ... 'webcrack' does not exist in type ...
tests/unit/modules/Deobfuscator.extended.test.ts(394,27): error TS2339: Property 'cached' does not exist on type ...
[exit 0]
```

⚠️ 2 个 TS 错误。**经隔离验证：与本 spike 无关。**

**复现方法**：`git stash && git checkout add-ui -- package.json package-lock.json && npm run typecheck` —— 同样的 2 个错误。说明这是 webcrack 集成（commits dfdcf9f / abce4df）遗留的类型不一致，与 monorepo 改造无关，不影响 spike 结论。

> **附记给后续 plan**：这两个 typecheck 错误应在前端工作开始前先修掉，否则会持续掩盖真正的问题。修法：`tests/unit/modules/Deobfuscator.extended.test.ts:215` 处的 `webcrack` 字段需对齐 `DeobfuscateOptions` 的最新形态；`:394` 的 `cached` 字段需在 `DeobfuscateResult` 上加上或改用现有字段。这是独立 bug，不在 P0 计划内但**应作为前置 fix 单独提交**。

---

## 4. 关键观察

### 4.1 `prepare` 钩子未受影响

`scripts/prepare.ts` 在 `npm install` 时自动跑、清理 `chrome-devtools-frontend` 体积。workspaces 启用后，prepare 仍然只在 root 跑一次（npm 默认行为：workspace install 走的是 root 的 prepare），未出现重复运行或循环依赖。

### 4.2 `files` 字段兼容性

```json
"files": ["build/src", "build/node_modules", "LICENSE", "!*.tsbuildinfo"]
```

发布时只打包 `build/`，不会把 `apps/` 目录打进 npm tarball。`apps/web` 设了 `"private": true`，npm publish 不会尝试发布它。✅ 发布链不需改。

### 4.3 `swc` 命令行路径未变

`build:compile` 写死 `swc src tests -d build --extensions .ts`，**不感知 workspaces**。它只看 root 的 `src/` 和 `tests/`，不会去递归 `apps/web/src/`。这正是我们想要的：前端代码由 vite 自己编译进 `apps/web/dist/`，不能也不该走 swc。

### 4.4 后续 plan 需注意的事

- **CI 缓存键**：`package-lock.json` 哈希变了，CI 缓存（如 `actions/cache` keyed by lockfile）会 miss 一次，正常现象。
- **bundle (rollup)**：`npm run bundle` 我**没跑**，因为它会触发完整产物打包，超出 spike 范围。在 plan 阶段需跑一遍确认 rollup 配置不需要因 workspaces 调整。
- **`apps/web/package.json` 加依赖时**：当 P0-D1 真的引入 react/vite/tailwind 等依赖时，npm install 会把它们装在 `apps/web/node_modules`（局部）或 root `node_modules`（hoist），需在 plan 阶段决定 hoisting 策略；本 spike 没引入任何依赖，所以未触发该决策点。

---

## 5. 推荐落地步骤（给 P0-D1 plan）

1. **前置 fix**（独立提交、独立 PR）：修复 `tests/unit/modules/Deobfuscator.extended.test.ts` 的 2 个 TS 错误，保证 `npm run typecheck` 干净退出。
2. **monorepo 改造提交**（一个 commit）：
   - `package.json` 加 `"workspaces": ["apps/*"]`
   - 新建 `apps/web/package.json`（此时含 react/vite/tailwind/shadcn 真依赖）
   - 跑 `npm install` 让 lockfile 同步
   - 跑 `npm run build` 与 `npm run bundle` 双向验证
3. **额外 root 脚本**（可选，留给 plan 决定）：
   - `"build:web": "npm run build --workspace=@js-reverse/web"`
   - `"dev:web": "npm run dev --workspace=@js-reverse/web"`

---

## 6. 临时分支处理建议

`spike/monorepo-build-check` 分支只含 2 个文件改动（`package.json` + `apps/web/package.json`）+ 自动重生的 `package-lock.json`。**保留作为证据**，等 P0-D1 plan 落地时复用同样的改动；之后再删。

```bash
# 当前状态
$ git diff add-ui --stat
 apps/web/package.json |  6 ++++++
 package-lock.json     | 11 +++++++++++
 package.json          |  3 +++
 3 files changed, 20 insertions(+)
```

---

## 7. 一句话结论

**workspaces 改造是低风险动作。** swc 不感知子包、rollup 配置（需在 plan 阶段补验）、prepare 钩子、bin 入口、files 发布字段全部不需改动。P0-D1 可放心做 monorepo 改造，前置只需修掉 webcrack 遗留的 2 个 TS 错误。
