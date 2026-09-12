# WebAssembly Analysis (Wasm) Reference

Capture, dump, and trace WebAssembly modules for `proxycli`.

## Overview

Analyze Wasm binaries compiled from C/C++/Rust/Go used for core encryption, obfuscation, or JSVMP engines.

| Tool Name             | Description                                             | Key Parameters                                                    |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `collect_wasm`        | Navigate and capture network & runtime Wasm modules     | `--url <str>`, `[--timeout <num>]`, `[--captureBase64 <bool>]`    |
| `wasm_dump`           | Save captured Wasm module to local `.wasm` file         | `[--moduleIndex <num>]`, `[--outputPath <str>]`                   |
| `wasm_vmp_trace`      | Trace JS-Wasm boundary calls and memory exchanges       | `[--maxEvents <num>]`, `[--filterModule <str>]`                   |
| `wasm_memory_inspect` | Search patterns and inspect `WebAssembly.Memory` buffer | `[--offset <num>]`, `[--length <num>]`, `[--searchPattern <str>]` |

---

## Detailed Commands

### 1. collect_wasm & wasm_dump

Must execute `collect_wasm` before dumping. Captures both network `.wasm` fetches and dynamically instantiated `WebAssembly.instantiate` / `compile` calls.

```bash
# 1. Navigate and record Wasm instantiations
proxycli call collect_wasm --url "https://example.com/crypto-page" --waitAfterLoadMs 3000

# 2. Dump first captured module to disk
proxycli call wasm_dump --moduleIndex 0 --outputPath "artifacts/wasm/core.wasm"
```

### 2. wasm_vmp_trace & wasm_memory_inspect

Trace parameter passing across the JS-Wasm boundary or inspect heap memory.

```bash
# Trace calls between JS and Wasm
proxycli call wasm_vmp_trace --maxEvents 100

# Search for magic header or pattern in Wasm linear memory
proxycli call wasm_memory_inspect --searchPattern "token=" --length 1024
```
