# Proxy 交互式终端 REPL 实施计划 (Proxy Interactive CLI Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `src/modules/proxy` 构建开箱即用的轻量级独立交互式终端 REPL（`ProxyCli` 及 `cli.ts`），支持服务启停、实时流量 tail、报文查看/curl 重放、规则改写、主机过滤、系统代理控制、HAR 导出与 Tab 智能补全，并提供 Prompt-Safe 流控打印与四重异常退出清理保障。

**Architecture:** 基于 Node.js 原生 `node:readline` 模块构建零第三方 UI 依赖的行式交互引擎，`ProxyCli` 类负责命令分发、补全和状态机，`cli.ts` 提供独立可执行入口及系统信号兜底。所有 I/O 流通过依赖注入抽象，便于 100% 隔离单元测试。

**Tech Stack:** TypeScript (ESM), Node.js `node:readline`, `node:stream`, `node:test`, `node:assert`, ANSI escape codes.

**Spec:** `docs/superpowers/specs/2026-09-05-proxy-interactive-cli-design.md`

## Global Constraints

- 遵循 Node.js ESM 规范与项目严格 TypeScript 约束。
- 零额外第三方 UI 依赖，使用标准库 `node:readline`。
- I/O 可测试：`ProxyCli` 构造器必须允许注入自定义 `input` 与 `output` 流。
- 退出安全红线：任何退出路径（正常退出、Ctrl+C、SIGTERM、未捕获异常）必须执行系统代理还原 `SystemProxyManager.restore()`。

---

### Task 1: 词法分词器与 REPL 命令分发底座 (Tokenizer & Foundation)

**Files:**

- Create: `src/modules/proxy/ProxyCli.ts`
- Test: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `MitmModule` from `src/modules/proxy/MitmModule.js`
- Produces: `ProxyCli` class with `tokenize(line: string): string[]`, `handleCommand(line: string): Promise<boolean>`, and `start(): Promise<void>`

- [ ] **Step 1: 编写分词与命令分发单元测试**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
import assert from 'node:assert';
import {PassThrough} from 'node:stream';
import {describe, it} from 'node:test';

import {MitmModule} from '../../../../src/modules/proxy/MitmModule.js';
import {ProxyCli, tokenizeLine} from '../../../../src/modules/proxy/ProxyCli.js';

describe('ProxyCli - Foundation & Tokenizer', () => {
  it('tokenizeLine 正确拆分单双引号与空格参数', () => {
    assert.deepStrictEqual(tokenizeLine('help'), ['help']);
    assert.deepStrictEqual(tokenizeLine('start 8888'), ['start', '8888']);
    assert.deepStrictEqual(
      tokenizeLine('rule add mock "/api/v1/user info" 200 \'{"code": 0}\''),
      ['rule', 'add', 'mock', '/api/v1/user info', '200', '{"code": 0}'],
    );
    assert.deepStrictEqual(tokenizeLine('   ls   10   auth   '), ['ls', '10', 'auth']);
  });

  it('handleCommand 支持 help 与 exit 命令', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let outData = '';
    output.on('data', chunk => {
      outData += chunk.toString();
    });

    const mockModule = new MitmModule();
    const cli = new ProxyCli(mockModule, input, output);

    const helpHandled = await cli.handleCommand('help');
    assert.strictEqual(helpHandled, true);
    assert.match(outData, /Available commands/i);

    const exitHandled = await cli.handleCommand('exit');
    assert.strictEqual(exitHandled, false); // false 表示终止 REPL
  });
});
```

- [ ] **Step 2: 运行测试以验证其失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，提示找不到模块 `ProxyCli.js` 或导出不存在。

- [ ] **Step 3: 实现分词器与 ProxyCli 基础类**

```typescript
// src/modules/proxy/ProxyCli.ts
import readline from 'node:readline';
import type {Readable, Writable} from 'node:stream';

import type {MitmModule} from './MitmModule.js';

export function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (/\s/.test(char) && !inDoubleQuote && !inSingleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export class ProxyCli {
  protected rl: readline.Interface | null = null;
  protected tailEnabled = false;
  protected selectedId: string | null = null;

  constructor(
    protected readonly module: MitmModule,
    protected readonly input: NodeJS.ReadableStream = process.stdin,
    protected readonly output: NodeJS.WritableStream = process.stdout,
  ) {}

  write(message: string): void {
    this.output.write(message);
  }

  writeLine(line = ''): void {
    this.output.write(line + '\n');
  }

  async handleCommand(rawLine: string): Promise<boolean> {
    const tokens = tokenizeLine(rawLine.trim());
    if (tokens.length === 0) return true;

    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    switch (cmd) {
      case 'help':
      case 'h':
      case '?':
        this.printHelp(args[0]);
        return true;
      case 'exit':
      case 'quit':
      case 'q':
        this.writeLine('[INFO] Exiting proxy CLI...');
        return false;
      default:
        this.writeLine(`[ERROR] Unknown command: ${tokens[0]}. Type 'help' for guidance.`);
        return true;
    }
  }

  printHelp(command?: string): void {
    this.writeLine('Available commands:');
    this.writeLine('  help [cmd]             Show help message');
    this.writeLine('  exit / quit / q        Exit CLI');
  }

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: this.input as Readable,
      output: this.output as Writable,
      prompt: 'proxy[stopped]> ',
    });

    this.rl.prompt();
    for await (const line of this.rl) {
      const shouldContinue = await this.handleCommand(line);
      if (!shouldContinue) {
        this.rl.close();
        break;
      }
      this.rl.prompt();
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS，所有用例通过。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add ProxyCli base class and command tokenizer"
```

---

### Task 2: 服务生命周期命令 (start, stop, restart, status)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `MitmModule.start()`, `MitmModule.stop()`, `MitmModule.getStatus()`
- Produces: `ProxyCli.handleStart()`, `ProxyCli.handleStop()`, `ProxyCli.handleRestart()`, `ProxyCli.handleStatus()`

- [ ] **Step 1: 编写服务控制命令测试**

```typescript
// 在 tests/unit/modules/proxy/ProxyCli.test.ts 中追加测试
it('支持 start, stop, restart 与 status 生命周期流转', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outData = '';
  output.on('data', chunk => {
    outData += chunk.toString();
  });

  const mockModule = new MitmModule();
  const cli = new ProxyCli(mockModule, input, output);

  // 1. start
  await cli.handleCommand('start 0'); // 端口 0 随机分配
  assert.match(outData, /MITM Proxy started/i);

  // 2. status
  outData = '';
  await cli.handleCommand('status');
  assert.match(outData, /RUNNING/i);

  // 3. stop
  outData = '';
  await cli.handleCommand('stop');
  assert.match(outData, /Proxy stopped/i);

  // 4. status after stop
  outData = '';
  await cli.handleCommand('status');
  assert.match(outData, /STOPPED/i);
});
```

- [ ] **Step 2: 运行测试以验证其失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，未知命令 `start`。

- [ ] **Step 3: 在 ProxyCli 中实现 start, stop, restart, status**

在 `ProxyCli.ts` 中补充逻辑：

- 增加 `updatePrompt()` 方法：代理运行中设置为 `proxy[<port>]>`，未运行时设置为 `proxy[stopped]>`。
- `handleStart(args)`：解析端口和 upstream，调用 `module.start(port, upstream)`，更新 prompt。
- `handleStop()`：调用 `module.stop()`，更新 prompt。
- `handleRestart(args)`：按序执行 stop 和 start。
- `handleStatus()`：调用 `module.getStatus()`，使用方框/制表符排版输出运行状态。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add start, stop, restart and status commands to ProxyCli"
```

---

### Task 3: 流量检索、详情下钻与 cURL 生成 (ls, show, curl, clear)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `MitmModule.listRequests()`, `MitmModule.getRequest()`, `MitmModule.clearRequests()`, `formatCurl()`
- Produces: `ProxyCli.handleLs()`, `ProxyCli.handleShow()`, `ProxyCli.handleCurl()`, `ProxyCli.handleClear()`

- [ ] **Step 1: 编写流量操作单元测试**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
it('支持 ls, show, curl, clear 命令', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outData = '';
  output.on('data', chunk => {
    outData += chunk.toString();
  });

  const module = new MitmModule();
  // 注入一条测试请求到 store
  const store = (module as any).store;
  store.addRequest({
    id: 'req_1',
    timestamp: Date.now(),
    method: 'POST',
    url: 'https://api.example.com/v1/login',
    clientIp: '127.0.0.1',
    statusCode: 200,
    requestHeaders: {'content-type': 'application/json'},
    requestBody: '{"user":"admin"}',
    responseHeaders: {'content-type': 'application/json'},
    responseBody: '{"code":0,"token":"abc"}',
    durationMs: 45,
  });

  const cli = new ProxyCli(module, input, output);

  // 1. ls
  outData = '';
  await cli.handleCommand('ls');
  assert.match(outData, /req_1/);
  assert.match(outData, /POST/);
  assert.match(outData, /200/);

  // 2. show req_1
  outData = '';
  await cli.handleCommand('show req_1');
  assert.match(outData, /Request #req_1/);
  assert.match(outData, /token/);

  // 3. curl req_1
  outData = '';
  await cli.handleCommand('curl req_1');
  assert.match(outData, /curl -X POST/);

  // 4. clear
  outData = '';
  await cli.handleCommand('clear');
  assert.match(outData, /Cleared/i);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，未知命令 `ls`。

- [ ] **Step 3: 实现 ls, show, curl 与 clear 逻辑**

在 `ProxyCli.ts` 中：

- `handleLs(args)`：解析 `limit`（默认 15）和 `filter`，调用 `module.listRequests()`，输出对齐表格。
- `handleShow(args)`：解析 `id`（默认为 `selectedId` 或最近一条）与 `part`，调用 `module.getRequest(id)`，分块渲染 General、Headers、Body（带 JSON 格式化与大报文截断保护）。设置 `this.selectedId = id`。
- `handleCurl(args)`：调用 `module.getRequest(id)`，利用 `formatCurl` 输出。
- `handleClear()`：调用 `module.clearRequests()`，清空 `selectedId`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add ls, show, curl and clear commands to ProxyCli"
```

---

### Task 4: 实时流控输出与 Prompt-Safe 终端保护 (tail)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `CapturedExchange` 事件流
- Produces: `ProxyCli.handleTail()`, `ProxyCli.safeLog(message: string)`

- [ ] **Step 1: 编写 tail 与 safeLog 单元测试**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
it('tail 开关切换及 safeLog 在活跃提示符时正常刷新', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outData = '';
  output.on('data', chunk => {
    outData += chunk.toString();
  });

  const module = new MitmModule();
  const cli = new ProxyCli(module, input, output);

  await cli.handleCommand('tail on');
  assert.match(outData, /Tail is now ON/i);

  outData = '';
  await cli.handleCommand('tail off');
  assert.match(outData, /Tail is now OFF/i);

  // 测试 safeLog
  outData = '';
  cli.safeLog('[TEST LOG]');
  assert.match(outData, /\[TEST LOG\]/);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，未知命令 `tail`。

- [ ] **Step 3: 实现 tail 与 safeLog**

在 `ProxyCli.ts` 中：

- `safeLog(msg)`：若 `rl` 存在，通过 `\r\x1b[K` 清除当前行，写入 `msg + '\n'`，再调用 `this.rl.prompt(true)` 重绘用户正在键入的字符。
- `handleTail(args)`：支持 `on` / `off` / 无参数 toggle。
- 在 `module` 收到 exchange 时，若 `tailEnabled` 为 true，调用 `safeLog` 输出单行紧凑日志（状态码带颜色渲染）。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add tail command with prompt-safe logging"
```

---

### Task 5: 改写规则与主机过滤命令 (rule, filter)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `MitmModule.addRule()`, `MitmModule.listRules()`, `MitmModule.removeRule()`, `MitmModule.clearRules()`, `MitmModule.addHostFilter()`, `MitmModule.listHostFilters()`, `MitmModule.removeHostFilter()`, `MitmModule.clearHostFilters()`
- Produces: `ProxyCli.handleRule()`, `ProxyCli.handleFilter()`

- [ ] **Step 1: 编写 rule 与 filter 测试用例**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
it('支持 rule 与 filter 的增删查清命令', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outData = '';
  output.on('data', chunk => {
    outData += chunk.toString();
  });

  const module = new MitmModule();
  const cli = new ProxyCli(module, input, output);

  // 1. rule add mock
  await cli.handleCommand('rule add mock /api/v1 200 {"ok":true}');
  assert.match(outData, /Rule added/i);

  // 2. rule ls
  outData = '';
  await cli.handleCommand('rule ls');
  assert.match(outData, /mock/i);
  assert.match(outData, /\/api\/v1/);

  // 3. filter allow & filter ls
  outData = '';
  await cli.handleCommand('filter allow api.github.com');
  assert.match(outData, /Filter added/i);

  outData = '';
  await cli.handleCommand('filter ls');
  assert.match(outData, /api\.github\.com/);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，未知命令 `rule`。

- [ ] **Step 3: 实现 rule 与 filter 命令处理器**

在 `ProxyCli.ts` 中：

- `handleRule(args)`：实现 `ls`, `add mock`, `add redirect`, `add header`, `rm`, `clear` 子命令分发。
- `handleFilter(args)`：实现 `ls`, `allow`, `block`, `rm`, `clear` 子命令分发。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add rule and filter commands to ProxyCli"
```

---

### Task 6: 系统代理、证书、进程与 HAR 导出命令 (sysproxy, ca, proc, har)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Consumes: `MitmModule.getSystemProxyManager()`, `MitmModule.exportCa()`, `MitmModule.listLocalProcesses()`, `MitmModule.exportHar()`
- Produces: `ProxyCli.handleSysproxy()`, `ProxyCli.handleCa()`, `ProxyCli.handleProc()`, `ProxyCli.handleHar()`

- [ ] **Step 1: 编写高级系统命令测试**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
it('支持 ca, sysproxy, proc 与 har 命令分发', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outData = '';
  output.on('data', chunk => {
    outData += chunk.toString();
  });

  const module = new MitmModule();
  const cli = new ProxyCli(module, input, output);

  // 1. ca path
  await cli.handleCommand('ca path');
  assert.match(outData, /ca\.crt/);

  // 2. sysproxy status
  outData = '';
  await cli.handleCommand('sysproxy status');
  assert.match(outData, /System proxy/i);

  // 3. proc ls
  outData = '';
  await cli.handleCommand('proc ls');
  assert.match(outData, /Local processes/i);

  // 4. har export
  outData = '';
  await cli.handleCommand('har export');
  assert.match(outData, /HAR exported/i);
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，未知命令 `ca`。

- [ ] **Step 3: 实现 sysproxy, ca, proc, har 命令**

在 `ProxyCli.ts` 中：

- `handleSysproxy(args)`：实现 `on`, `off`, `status`。
- `handleCa(args)`：实现 `path`, `export`。
- `handleProc(args)`：实现 `ls`, `target`, `clear`。
- `handleHar(args)`：解析目标路径，调用 `module.exportHar()` 写入文件。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): add sysproxy, ca, proc and har commands to ProxyCli"
```

---

### Task 7: Tab 自动补全器 (Completer)

**Files:**

- Modify: `src/modules/proxy/ProxyCli.ts`
- Modify: `tests/unit/modules/proxy/ProxyCli.test.ts`

**Interfaces:**

- Produces: `ProxyCli.completer(line: string): [string[], string]`

- [ ] **Step 1: 编写 Tab 补全单元测试**

```typescript
// tests/unit/modules/proxy/ProxyCli.test.ts
it('completer 正确补全一级命令与二级子命令', () => {
  const module = new MitmModule();
  const cli = new ProxyCli(module);

  // 1. 一级命令补全
  const [hits1] = cli.completer('st');
  assert.ok(hits1.includes('start'));
  assert.ok(hits1.includes('status'));

  // 2. 二级子命令补全
  const [hits2] = cli.completer('rule ');
  assert.ok(hits2.includes('ls'));
  assert.ok(hits2.includes('add'));
  assert.ok(hits2.includes('rm'));
  assert.ok(hits2.includes('clear'));

  const [hits3] = cli.completer('sysproxy ');
  assert.ok(hits3.includes('on'));
  assert.ok(hits3.includes('off'));
});
```

- [ ] **Step 2: 运行测试验证失败**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：FAIL，`cli.completer` 不存在。

- [ ] **Step 3: 实现 completer 并挂载到 readline**

在 `ProxyCli.ts` 中实现 `completer(line: string)`：

- 解析前缀，根据上下文匹配命令字典树及当前活跃的请求 ID。
- 在 `start()` 的 `readline.createInterface` 配置中传入 `completer: (line) => this.completer(line)`。

- [ ] **Step 4: 运行测试验证通过**

运行：`npx tsx --test tests/unit/modules/proxy/ProxyCli.test.ts`
预期：PASS。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/ProxyCli.ts tests/unit/modules/proxy/ProxyCli.test.ts
git commit -m "feat(proxy): implement intelligent tab completer in ProxyCli"
```

---

### Task 8: 独立可执行入口、信号安全门禁与脚本集成 (CLI Entry & Safety Guard)

**Files:**

- Create: `src/modules/proxy/cli.ts`
- Modify: `src/modules/proxy/index.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `ProxyCli`, `MitmModule`
- Produces: CLI 入口二进制执行流、`package.json` `"proxy:cli"` script

- [ ] **Step 1: 编写 CLI 入口脚本及参数解析**

创建 `src/modules/proxy/cli.ts`：

- 解析 `--port <num>`, `-p <num>`, `--upstream <url>`, `--sysproxy`, `--no-auto-start`。
- 实例化 `MitmModule` 与 `ProxyCli`。
- 注册 `SIGINT`, `SIGTERM`, `uncaughtException`, `exit` 四重清理守卫（保证执行 `systemProxy.restore()` 与 `module.stop()`）。
- 若未带 `--no-auto-start`，默认自启代理并进入 REPL。

- [ ] **Step 2: 在 index.ts 中导出 ProxyCli**

在 `src/modules/proxy/index.ts` 中导出 `ProxyCli`, `tokenizeLine`。

- [ ] **Step 3: 在 package.json 中注册 proxy:cli 脚本**

在 `package.json` 的 `"scripts"` 中添加：
`"proxy:cli": "node --no-warnings=ExperimentalWarning build/src/modules/proxy/cli.js"`

- [ ] **Step 4: 运行项目类型检查与格式校验**

运行：
`npm run typecheck`
`npm run check-format`
预期：全部通过，0 error。

- [ ] **Step 5: 提交代码**

```bash
git add src/modules/proxy/cli.ts src/modules/proxy/index.ts package.json
git commit -m "feat(proxy): add cli executable entry and npm script"
```
