# Crypto Hook Functions 提取设计

**日期**: 2026-04-20
**状态**: 待实现
**范围**: `src/tools/crypto/` → `src/functions/crypto/`

## 概述

将 `src/tools/crypto/` 下 3 个加密库 Hook 工具的核心逻辑提取为独立纯函数，脱离 MCP Tool 框架依赖。新函数接收 Puppeteer Frame 参数，注入 Hook 代码，返回结构化结果对象。

原工具保留不变，新旧 API 并存。

## 架构

### 文件结构

```
src/functions/crypto/
├── hookCryptoJS.ts    # CryptoJS Hook 函数
├── hookJSEncrypt.ts   # JSEncrypt RSA Hook 函数
├── hookSMCrypto.ts    # SM-crypto 国密 Hook 函数
├── types.ts           # 共享类型定义
└── index.ts           # Barrel export
```

### 函数签名

```typescript
// types.ts - 共享类型
export interface HookResult {
  success: boolean;
  message: string;
  algorithms?: string[];   // hookCryptoJS / hookSMCrypto 返回
  logFormat?: string;      // 所有函数返回
}

export type LogFormat = 'full' | 'compact' | 'json';

// hookCryptoJS.ts
export type CryptoJSAlgorithm = 'AES' | 'DES' | 'MD5' | 'SHA' | 'HMAC' | 'all';

export async function hookCryptoJS(
  frame: Frame,
  algorithms?: CryptoJSAlgorithm[],
  logFormat?: LogFormat
): Promise<HookResult>;

// hookJSEncrypt.ts
export async function hookJSEncrypt(
  frame: Frame,
  logFormat?: LogFormat
): Promise<HookResult>;

// hookSMCrypto.ts
export type SMAlgorithm = 'SM2' | 'SM3' | 'SM4' | 'all';

export async function hookSMCrypto(
  frame: Frame,
  algorithms?: SMAlgorithm[],
  logFormat?: LogFormat
): Promise<HookResult>;
```

### 依赖关系

```
src/functions/crypto/
  ├── 依赖: src/third_party/index.js (Puppeteer Frame 类型)
  └── 不依赖: src/tools/ToolDefinition.ts, MCP 框架
```

## 组件

### hookCryptoJS

**职责**: 生成并注入 CryptoJS Hook 代码，捕获 AES/DES/MD5/SHA/HMAC 操作。

**入参**:
- `frame`: Puppeteer Frame 对象，用于 `frame.evaluate(hookCode)`
- `algorithms`: 可选，默认 `['all']`
- `logFormat`: 可选，默认 `'compact'`

**返回**:
```typescript
{
  success: true,
  message: 'CryptoJS Hook 已安装',
  algorithms: ['AES', 'DES'],
  logFormat: 'compact'
}
```

**失败时**:
```typescript
{
  success: false,
  message: '错误: <error message>',
  algorithms: undefined,
  logFormat: undefined
}
```

### hookJSEncrypt

**职责**: 生成并注入 JSEncrypt Hook 代码，捕获 RSA encrypt/decrypt 操作。

**入参**:
- `frame`: Puppeteer Frame 对象
- `logFormat`: 可选，默认 `'compact'`

**返回**:
```typescript
{
  success: true,
  message: 'JSEncrypt Hook 已安装',
  logFormat: 'compact'
}
```

### hookSMCrypto

**职责**: 生成并注入 SM-crypto Hook 代码，捕获 SM2/SM3/SM4 国密操作。

**入参**:
- `frame`: Puppeteer Frame 对象
- `algorithms`: 可选，默认 `['all']`
- `logFormat`: 可选，默认 `'compact'`

**返回**:
```typescript
{
  success: true,
  message: 'SM-Crypto Hook 已安装',
  algorithms: ['SM2', 'SM3', 'SM4'],
  logFormat: 'compact'
}
```

## 数据流

```
调用方
  │
  │ 传入: frame + 参数
  ▼
hookCryptoJS(frame, ['AES'], 'compact')
  │
  │ 1. 默认参数处理: algorithms = ['all'], logFormat = 'compact'
  │ 2. 生成 Hook JS 代码字符串 (模板插值)
  │ 3. frame.evaluate(hookCode)
  │ 4. 捕获异常 → 返回 { success: false, message: error }
  ▼
返回 HookResult
```

## 错误处理

- 所有函数内部捕获异常
- 异常时返回 `{ success: false, message: '错误: <error.message>' }`
- 不抛出异常到调用方，保证函数始终返回结构化对象

## 测试

**测试文件**: `tests/functions/crypto.test.ts`

**测试用例**:
1. 参数默认值正确应用（不传参数时）
2. Hook 代码生成包含正确的参数插值
3. 成功注入返回 `{ success: true, ... }`
4. 注入失败返回 `{ success: false, message: '错误: ...' }`
5. algorithms 参数正确传递到生成的 JS 代码
6. logFormat 参数正确传递

**测试方式**: 使用 mock Frame 对象，验证 `evaluate` 被调用且参数正确。

## 与原工具关系

| 维度 | 原工具 (src/tools/crypto/) | 新函数 (src/functions/crypto/) |
|---|---|---|
| 定位 | MCP Tool，通过 daemon 路由调用 | 纯函数，可直接在 Node.js 调用 |
| 入参 | `{ params: { algorithms, logFormat } }` 包装 | 直接暴露参数 |
| 返回 | `response.appendResponseLine()` 拼文本 | 结构化对象 |
| 依赖 | ToolDefinition, Context, Response | 仅 Puppeteer Frame |
| 共存 | 保留不变 | 新增独立导出 |

原工具可选择性调用新函数（未来重构），但当前设计为并存，不强制修改原工具。

## 约定遵循

- **License header**: 每个源文件需含年度 Apache-2.0 header
- **ESM**: import 使用 `.js` 后缀
- **Types**: 使用 `interface` 定义类型
- **Quotes**: 单引号，`bracketSpacing: false`
- **Barrel export**: `index.ts` 聚合导出