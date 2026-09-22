# WebAssembly (Wasm) 模块逆向参考文档 (Wasm Reference)

WebAssembly 二进制捕获、导出、边界追踪与线性内存检查工具。

## 概览 (Overview)

用于分析使用 C/C++/Rust/Go 编译的 `.wasm` 二进制模块（常用于高端加固、滑块核心校验、JSVMP 解释器底层或重度加密算子）。

| 工具名称              | 功能描述                                                                              | 核心参数                                                                                    |
| :-------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------ |
| `collect_wasm`        | 重导航到目标 URL，拦截网络加载及运行时动态编译的 Wasm 模块（支持 captureBase64）      | `--url <str>`, `[--timeout <num>]`, `[--waitAfterLoadMs <num>]`, `[--captureBase64 <bool>]` |
| `wasm_dump`           | 将捕获到的 Wasm 模块导出到本地磁盘生成 `.wasm` 文件                                   | `[--moduleIndex <num>]`, `[--outputPath <str>]`                                             |
| `wasm_vmp_trace`      | 追踪 JS 与 Wasm 跨边界调用的运行时事件（函数调用、入参与返回值）                      | `[--maxEvents <num>]`, `[--filterModule <str>]`                                             |
| `wasm_memory_inspect` | 检查并搜索导出 `WebAssembly.Memory` 缓冲区的线性内存（支持 Hex/ASCII 转储与模式检索） | `[--searchPattern <str>]`, `[--offset <num>]`, `[--length <num>]`                           |

---

## 详细命令与示例

### 1. 捕获并导出 Wasm 二进制模块

```bash
# 1. 拦截目标页面加载的 Wasm 模块（等待 3 秒保证编译完成，直接抓取 base64 二进制）
browsercli call collect_wasm --url "https://example.com/sec-verify" --waitAfterLoadMs 3000 --captureBase64 true

# 2. 导出第 0 号模块到本地文件
browsercli call wasm_dump --moduleIndex 0 --outputPath "artifacts/wasm/core_calc.wasm"
```

导出的 `.wasm` 文件可直接配合 `skills/wsam-reverse` 做离线反编译（`wasm-decompile`）与反汇编。

### 2. 跨边界追踪与内存嗅探

```bash
# 追踪 JS 向 Wasm 传递的关键参数
browsercli call wasm_vmp_trace --maxEvents 50

# 在 Wasm 线性内存堆中搜索包含敏感前缀的数据
browsercli call wasm_memory_inspect --searchPattern "token=" --length 1024
```
