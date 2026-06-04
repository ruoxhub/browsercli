# Wasm 逆向

WebAssembly 模块常用于：图像处理、加密算法（替代 JS 实现以提速）、反混淆（VMP）、核心算法保护。js-reverse 提供从**捕获 → 反编译 → 离线执行**的完整链路。

> **核心心法**：**反编译 > 反汇编**（默认）。除非你想看原始 WAT 指令，否则 `wasm_decompile` 的"函数摘要 + 可疑模式"能节省 80% 阅读时间。

---

## 工作流

```
# 1) 工具链自检（首次必做）
wasm_capabilities
# → {wabt: true, binaryen: true, wasmtime: true, wasmer: false, ...}
# 若关键工具缺失：见 "失败回退"

# 2) 导出模块（从浏览器抓到 .wasm）
wasm_dump [--moduleIndex 0] --outputPath ./target.wasm

# 3) 段信息 + 字符串扫描（先建立全局观）
wasm_inspect_sections --inputPath ./target.wasm \
  --includeFunctionSignatures true \
  --includeStringScan true \
  --maskSensitiveStrings true \
  --maxSummaryLines 200

# 4) 反编译（推荐）
wasm_decompile --inputPath ./target.wasm --inlineExport true
# 输出：每个函数的人类可读伪代码 + 可疑模式（大量 xor / look-up table / 大块算术）

# 5) 反汇编（当反编译看不懂时）
wasm_disassemble --inputPath ./target.wasm --foldExprs true
# 输出：WAT 文本格式（webassembly text format）

# 6) 离线执行（如需"试运行"）
wasm_offline_run --inputPath ./target.wasm --functionName <name> --args <json> --runtime wasmtime

# 7) 内存 / 运行时追踪
wasm_memory_inspect --offset 0 --length 1024 --format hex --searchPattern "deadbeef"
wasm_vmp_trace [--maxEvents 100] [--filterModule <name>]
```

---

## 关键决策

### 反编译 vs 反汇编

| 场景 | 选 | 原因 |
|------|----|------|
| 快速理解模块结构 | `wasm_decompile` | 函数级摘要，可疑模式标记 |
| 看具体指令（VMP opcode） | `wasm_disassemble` | 原始 WAT，每条指令可追 |
| 函数太多要快速定位 | `wasm_decompile --inlineExport true` | 展开 export 链 |
| 调试器单步 | `wasm_offline_run` | 不用启动完整运行时 |

### 段信息 vs 直接反编译

`wasm_inspect_sections` 适合：
- 知道模块有 N 个函数但不知道哪个是入口 → 看 export 段
- 怀疑有内嵌字符串 / URL / 域名 → `--includeStringScan true`
- 想知道内存布局 → 看 Memory 段

**不要**先反编译再段信息。反编译对超大模块（>10k 函数）很慢。

---

## VMP 场景

如果 wasm 是**代码保护器**（如某些商业 VMP 用的 wasm 壳），反编译可能输出大量无意义指令（`i32.const` / `local.get` / `i32.xor` 循环）。这时：

1. `wasm_vmp_trace` 抓运行时事件（每次进入 / 退出函数 + 参数摘要）
2. 用 `wasm_offline_run` 重放同一个输入多次，看哪条路径被命中
3. 关注 **dispatcher**（最外层 switch 调度函数）的输入输出

不要试图"完整还原 VMP" — 通常目标是**只提取目标算法**（如签名函数），其他外壳可以跳过。

---

## 与 JS 边界

很多 wasm 模块不是独立运行，而是从 JS 侧被调用。Hook 路径：

```
# 1. 找 JS 侧加载代码
list_scripts --filter "wasm\|.wasm\|WebAssembly"
search_in_sources --query "WebAssembly.instantiate\|compileStreaming"
# 找到 JS 调 wasm 的入口

# 2. 用 hook 拦截 JS 侧的 import（传入 wasm 的 JS 函数）
create_hook --type function --target <importedFuncName>
# 看 JS 给 wasm 传了什么

# 3. 拦截 wasm 侧 export（wasm 调 JS）
wasm_vmp_trace  # 看 wasm→JS 边界调用
```

---

## 输出产物

| 文件 | 内容 |
|------|------|
| `target.wasm` | 原始模块（从浏览器抓出） |
| `target.decompiled.wat` | 反编译输出 |
| `target.disassembled.wat` | 反汇编输出（如果做了） |
| `target.sections.json` | 段信息 + 字符串扫描 |
| `target.funcs.md` | export 函数表（按可疑度排序） |
| `call-graph.md` | 从 vmp_trace 提取的调用关系 |
| `record_reverse_evidence` | task artifact 条目 |

---

## 失败回退

| 现象 | 解决 |
|------|------|
| `wasm_capabilities` 报 wabt 缺失 | `npm i -g wabt` 或 `apt install wabt` |
| `wasm_capabilities` 报 wasmtime 缺失 | `curl https://wasmtime.dev/install.sh -sSf \| bash` |
| `wasm_decompile` 慢 / 卡住 | 加 `--maxWatChars 500000` 限制输出 |
| 反编译输出看不懂 | 改用 `wasm_disassemble` 看原始 WAT；或 `wasm_offline_run` 重放输入 |
| 找不到入口函数 | 看 `wasm_inspect_sections` 的 export 段；用 `summarize_code` 辅助 JS 侧 |
| 二进制字符串扫描报敏感 | `--maskSensitiveStrings true` 屏蔽，但记下索引回查 |

---

## 工具链要求

| 工具 | 用途 | 安装 |
|------|------|------|
| `wabt` | WAT 汇编/反汇编 | `apt install wabt` / `brew install wabt` |
| `binaryen` (`wasm-opt`) | 优化 + 二次反编译 | `brew install binaryen` |
| `wasmtime` | 离线执行 | `curl https://wasmtime.dev/install.sh -sSf \| bash` |
| `wasmer` | 备用运行时 | `curl https://get.wasmer.io -sSf \| sh` |

`wasm_capabilities` 返回各工具可用性。**全缺失**时仍可做段信息 + 反编译，但离线执行不可用。
