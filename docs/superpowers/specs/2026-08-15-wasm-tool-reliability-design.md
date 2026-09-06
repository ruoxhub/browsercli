# WASM 工具可靠性修复设计

## 背景

在 `https://www.mashangpa.com/problem-detail/11/` 上验证 WASM 工具时确认了三个缺陷：

1. `WasmCollector.collect()` 已实现，但没有对应的 `collect_wasm` 工具入口，导致 `wasm_dump` 提示用户调用一个不存在的工具。
2. `wasm_memory_inspect` 会读取并递归枚举页面全局对象，可能触发 getter、扫描大型宿主对象并长期占用 Worker Job。
3. `wasm_offline_run` 与 `wasm_optimize` 各自实现原生命令执行；Windows 上命令不存在时会丢失 `execFile` 的错误消息，`auto` 回退还依赖本地化 stderr 文本。

## 目标

- 提供显式、可发现的 `collect_wasm` 工具，并继续复用现有采集器。
- 让内存检查不触发页面 getter、不递归遍历宿主对象，并在页面求值异常时有确定的超时上限。
- 让所有 WASM 原生命令调用返回一致、非空且可判断的缺失依赖错误。
- 不修改通用 Worker Job/API/proxycli 代码，不覆盖工作区既有改动。

## 方案

### `collect_wasm`

新增 full profile 工具 `collect_wasm`，参数映射到现有 `WasmCollector.collect()`。调用前先把工具 Context 的选中页同步给 Runtime，保证采集、后续 dump 与内存检查使用同一页面。`url` 必填；调用会安装 WASM 预加载捕获脚本并以 `domcontentloaded` 为就绪条件重新导航，再通过 `waitAfterLoadMs` 捕获异步加载模块。`timeout` 同时约束整个工具调用，防止采集器异常时长期占用 Worker Job。

该行为必须保持显式：不会在浏览器启动或普通导航路径中默认注入脚本，符合项目的零 JS 注入默认策略。工具只返回有界的采集结果，不另建采集服务或状态层。

### 安全内存检查

`wasm_memory_inspect` 改为在选中 Frame 中执行，并由共享的 `withOperationTimeout()` 限制页面求值时间。内存发现只检查对象自身的 data descriptor：

- 直接暴露的 `WebAssembly.Memory`；
- 全局对象（例如目标页的 `window.exports`）自身属性中的 Memory；
- `WebAssembly.Instance.exports` 中的 Memory。

不读取 accessor descriptor，不遍历原型链，不递归进入任意对象。Memory 引用去重后读取第一个匹配项。偏移越界返回结构化失败；全文模式搜索限定扫描字节数并报告是否截断，避免超大 Memory 再次长期占用页面线程。

### 统一原生命令结果

新增 WASM 目录内共享的 `runNativeCommand(command, args, timeoutMs)`。它只封装 Node `execFile`，统一返回：

- `stdout`、`stderr`；
- 数字 `exitCode`；
- `notFound`；
- `timedOut`。

当子进程没有 stderr 时使用 `error.message`，确保失败消息不为空。`wasm_offline_run` 的 auto 模式根据 `notFound` 回退，不再匹配中文字符串；两个运行时都缺失时明确列出 `wasmtime` 与 `wasmer`。`wasm_optimize` 对缺失 `wasm-opt` 给出 Binaryen 安装提示。`wasm_capabilities` 复用同一执行器，避免第三套探测语义。

## 测试

- 工具清单包含 `collectWasm`，handler 同步选中页、将参数原样委托给采集器并返回模块/事件统计。
- 采集导航不等待全局 network idle；采集 Promise 不结束时，handler 在总时限内返回结构化失败。
- 内存检查能发现 `globalThis.exports.memory`，且不会触发可枚举 getter。
- 页面求值永不结束时，内存检查在指定测试超时内返回结构化失败。
- 临时清空 PATH 后，offline auto 与 optimize 均返回明确、非空的依赖缺失错误。
- 最终在指定目标页面依次回归 WASM 工具；原生依赖未安装属于预期的可解释失败，而不是空错误。

## 非目标

- 不新增通用 Job 取消 API。
- 不自动安装 `wasmtime`、`wasmer` 或 Binaryen。
- 不让 WASM 捕获脚本默认注入所有页面。
- 不更改采集器的跨调用缓存语义。
