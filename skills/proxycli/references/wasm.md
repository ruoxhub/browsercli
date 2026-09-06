# WebAssembly Analysis (Wasm) Reference

Capture, dump, decompile, disassemble, inspect, and run WebAssembly modules for `proxycli`.

## Overview

Analyze Wasm binaries compiled from C/C++/Rust/Go used for core encryption, obfuscation, or JSVMP engines.

| Tool Name               | Description                                                             | Key Parameters                                                    |
| ----------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `wasm_capabilities`     | Check availability of native Wasm toolchains (WABT, Binaryen, Wasmtime) | None                                                              |
| `collect_wasm`          | Navigate and capture network & runtime Wasm modules                     | `--url <str>`, `[--timeout <num>]`, `[--captureBase64 <bool>]`    |
| `wasm_dump`             | Save captured Wasm module to local `.wasm` file                         | `[--moduleIndex <num>]`, `[--outputPath <str>]`                   |
| `wasm_disassemble`      | Disassemble `.wasm` to WebAssembly text format (WAT)                    | `--inputPath <str>`, `[--outputPath <str>]`                       |
| `wasm_decompile`        | Decompile `.wasm` into C-like pseudocode                                | `--inputPath <str>`, `[--outputPath <str>]`                       |
| `wasm_inspect_sections` | Scan sections, exports, imports, and string tables                      | `--inputPath <str>`, `[--includeStringScan <bool>]`               |
| `wasm_offline_run`      | Execute exported Wasm function offline in sandboxed runtime             | `--inputPath <str>`, `--functionName <str>`, `[--args <arr>]`     |
| `wasm_optimize`         | Optimize or minify `.wasm` file using wasm-opt                          | `--inputPath <str>`, `[--outputPath <str>]`                       |
| `wasm_vmp_trace`        | Trace JS-Wasm boundary calls and memory exchanges                       | `[--maxEvents <num>]`, `[--filterModule <str>]`                   |
| `wasm_memory_inspect`   | Search patterns and inspect `WebAssembly.Memory` buffer                 | `[--offset <num>]`, `[--length <num>]`, `[--searchPattern <str>]` |

---

## Detailed Commands

### 1. wasm_capabilities

Check if native tools (`wasm2wat`, `wasm-decompile`, `wasm-opt`, `wasmtime`) are installed on the local system. Note: Capturing and dumping Wasm does NOT require these tools.

```bash
proxycli call wasm_capabilities
```

### 2. collect_wasm & wasm_dump

Must execute `collect_wasm` before dumping. Captures both network `.wasm` fetches and dynamically instantiated `WebAssembly.instantiate` / `compile` calls.

```bash
# 1. Navigate and record Wasm instantiations
proxycli call collect_wasm --url "https://example.com/crypto-page" --waitAfterLoadMs 3000

# 2. Dump first captured module to disk
proxycli call wasm_dump --moduleIndex 0 --outputPath "artifacts/wasm/core.wasm"
```

### 3. wasm_disassemble & wasm_decompile

Generate readable disassembly or pseudocode from `.wasm`.

```bash
# Disassemble to WAT
proxycli call wasm_disassemble --inputPath "artifacts/wasm/core.wasm" --outputPath "artifacts/wasm/core.wat"

# Decompile to C-like pseudocode (best for reading algorithm logic)
proxycli call wasm_decompile --inputPath "artifacts/wasm/core.wasm" --outputPath "artifacts/wasm/core.c"
```

### 4. wasm_inspect_sections

Quickly scan function signatures, export names, and embedded string constants without full decompilation.

```bash
proxycli call wasm_inspect_sections --inputPath "artifacts/wasm/core.wasm" --includeFunctionSignatures true --includeStringScan true
```

### 5. wasm_vmp_trace & wasm_memory_inspect

Trace parameter passing across the JS-Wasm boundary or inspect heap memory.

```bash
# Trace calls between JS and Wasm
proxycli call wasm_vmp_trace --maxEvents 100

# Search for magic header or pattern in Wasm linear memory
proxycli call wasm_memory_inspect --searchPattern "token=" --length 1024
```

### 6. wasm_offline_run

Run an exported Wasm algorithm function offline in a headless sandbox (Wasmtime/Wasmer).

```bash
proxycli call wasm_offline_run --inputPath "artifacts/wasm/core.wasm" --functionName "encrypt_payload" --args '[123, 456]'
```
