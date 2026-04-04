# JSReverser-MCP 删除 MCP 模式迁移到 CLI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 MCP Server 模式，完全迁移到 opencli 风格的纯 CLI 架构，保留 Daemon + 双层工具暴露 (技能 + 工具)。

**Architecture:** 使用 Commander.js 替代 yargs 构建 CLI 入口，剥离 MCP Server 依赖，保留 Daemon 作为浏览器会话管理器，HTTP 模式作为可选方案保留。

**Tech Stack:** Commander.js (CLI), Express (HTTP 模式), Puppeteer (浏览器), TypeScript, Node.js 20+

**Spec Coverage:**
- Phase 1: 基础设施 → Task 1-3
- Phase 2: MCP 剥离 → Task 4-7
- Phase 3: 技能整合 → Task 8-11
- Phase 4: HTTP 模式 → Task 12-14
- Phase 5: 验证与文档 → Task 15-17

---

## File Structure

**删除的文件:**
- `src/main.ts` (MCP Server 入口)
- `src/McpContext.ts` → 重构为 `src/context/BrowserContext.ts`
- `src/McpResponse.ts` → 重构为 `src/context/ToolResponse.ts`

**新增的文件:**
- `src/commands/index.ts` (CLI 命令定义)
- `src/commands/start.ts`
- `src/commands/stop.ts`
- `src/commands/status.ts`
- `src/commands/call-skill.ts`
- `src/commands/call-tool.ts`
- `src/commands/list-skills.ts`
- `src/commands/list-tools.ts`
- `src/commands/repl.ts`
- `src/commands/scaffold.ts`
- `src/daemon/http-server.ts` (HTTP API 服务器)
- `src/context/BrowserContext.ts` (重构自 McpContext.ts)
- `src/context/ToolResponse.ts` (重构自 McpResponse.ts)

**保留的文件:**
- `src/index.ts` (Daemon 入口)
- `src/daemon/daemon.ts`
- `src/daemon/client.ts`
- `src/daemon/types.ts`
- `src/daemon/utils.ts`
- `src/bin/js-reverse.ts` → 重构为 Commander.js 风格
- `src/skills/` (技能系统，增强)
- `src/tools/` (工具系统，内部使用)

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 commander 和 express 依赖**

修改 `package.json` 的 `dependencies`:

```json
{
  "dependencies": {
    "commander": "^14.0.3",
    "express": "^5.2.1"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
npm install
```

Expected: 依赖安装成功，无错误

---

### Task 2: 创建 CLI 命令目录结构

**Files:**
- Create: `src/commands/index.ts`
- Create: `src/commands/start.ts`
- Create: `src/commands/stop.ts`
- Create: `src/commands/status.ts`
- Create: `src/commands/call-skill.ts`
- Create: `src/commands/call-tool.ts`
- Create: `src/commands/list-skills.ts`
- Create: `src/commands/list-tools.ts`
- Create: `src/commands/repl.ts`
- Create: `src/commands/scaffold.ts`

- [ ] **Step 1: 创建命令目录和空文件**

```bash
mkdir -p src/commands
touch src/commands/{index,start,stop,status,call-skill,call-tool,list-skills,list-tools,repl,scaffold}.ts
```

- [ ] **Step 2: 验证文件创建**

```bash
ls -la src/commands/
```

Expected: 显示 10 个新创建的 .ts 文件

---

### Task 3: 实现 CLI 入口框架

**Files:**
- Create: `src/commands/index.ts`

- [ ] **Step 1: 编写 CLI 入口代码**

```typescript
#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from 'commander';
import { VERSION } from '../version.js';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { callSkillCommand } from './call-skill.js';
import { callToolCommand } from './call-tool.js';
import { listSkillsCommand } from './list-skills.js';
import { listToolsCommand } from './list-tools.js';
import { replCommand } from './repl.js';
import { scaffoldCommand } from './scaffold.js';

export function createCli(): Command {
  const program = new Command('js-reverse');

  program
    .version(VERSION)
    .description('JavaScript 逆向工程 CLI 工具 - 删除 MCP 模式，纯 CLI 架构')
    .showHelpAfterError();

  // Daemon 控制命令
  program.command('start')
    .description('启动后台服务')
    .option('--browserUrl <url>', '连接现有 Chrome 实例')
    .option('--wsEndpoint <endpoint>', 'WebSocket 端点')
    .option('--headless', '无头模式')
    .option('--http', '启用 HTTP 模式')
    .option('--port <port>', 'HTTP 端口', '3000')
    .action(startCommand);

  program.command('stop')
    .description('停止后台服务')
    .action(stopCommand);

  program.command('status')
    .description('查看服务状态')
    .action(statusCommand);

  // 技能调用
  program.command('call-skill <name>')
    .description('调用技能')
    .option('--url <url>', '目标 URL')
    .option('--option <key=value>', '技能参数', collectOptions, {})
    .action(callSkillCommand);

  // 工具调用
  program.command('call-tool <name>')
    .description('调用底层工具')
    .option('--param <key=value>', '工具参数', collectParams, {})
    .action(callToolCommand);

  // 列表命令
  program.command('list-skills')
    .description('列出所有可用技能')
    .option('--category <cat>', '按分类过滤')
    .action(listSkillsCommand);

  program.command('list-tools')
    .description('列出所有可用工具')
    .option('--category <cat>', '按分类过滤')
    .action(listToolsCommand);

  // 交互模式
  program.command('repl')
    .description('进入交互模式')
    .action(replCommand);

  // 脚手架
  program.command('scaffold')
    .description('创建新任务模板')
    .requiredOption('--name <name>', '任务名称')
    .requiredOption('--url <url>', '目标网站')
    .option('--desc <desc>', '任务描述')
    .action(scaffoldCommand);

  return program;
}

function collectOptions(value: string, previous: Record<string, unknown>): Record<string, unknown> {
  const [key, val] = value.split('=');
  if (key && val !== undefined) {
    previous[key] = val === 'true' ? true : val === 'false' ? false : /^\d+$/.test(val) ? parseInt(val) : val;
  }
  return previous;
}

function collectParams(value: string, previous: Record<string, unknown>): Record<string, unknown> {
  return collectOptions(value, previous);
}

// CLI 入口
const program = createCli();
program.parse(process.argv);
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
npm run typecheck
```

Expected: 无类型错误（其他命令函数尚未实现，会有导入错误，暂时忽略）

---

### Task 4: 重命名 McpContext → BrowserContext

**Files:**
- Rename: `src/McpContext.ts` → `src/context/BrowserContext.ts`
- Modify: `src/context/BrowserContext.ts` (内容修改)

- [ ] **Step 1: 创建 context 目录并重命名文件**

```bash
mkdir -p src/context
mv src/McpContext.ts src/context/BrowserContext.ts
```

- [ ] **Step 2: 替换类名和导出**

在 `src/context/BrowserContext.ts` 中：
- 将 `export class McpContext` 改为 `export class BrowserContext`
- 将 `McpContext.from` 改为 `BrowserContext.from`
- 删除所有 MCP 相关的引用

- [ ] **Step 3: 验证编译**

```bash
npm run build
```

Expected: 编译通过（可能有引用路径错误，后续任务修复）

---

### Task 5: 重命名 McpResponse → ToolResponse

**Files:**
- Rename: `src/McpResponse.ts` → `src/context/ToolResponse.ts`
- Modify: `src/context/ToolResponse.ts` (内容修改)

- [ ] **Step 1: 重命名文件**

```bash
mv src/McpResponse.ts src/context/ToolResponse.ts
```

- [ ] **Step 2: 替换类名和导出**

在 `src/context/ToolResponse.ts` 中：
- 将 `export class McpResponse` 改为 `export class ToolResponse`
- 删除 MCP 特定的响应格式

- [ ] **Step 3: 验证编译**

```bash
npm run build
```

---

### Task 6: 删除 MCP Server 入口

**Files:**
- Delete: `src/main.ts`

- [ ] **Step 1: 备份并删除 main.ts**

```bash
# 先备份（可选）
cp src/main.ts src/main.ts.backup
rm src/main.ts
```

- [ ] **Step 2: 更新 package.json 移除 MCP 入口引用**

确保 `package.json` 的 `scripts` 中没有引用 `main.ts`：

```json
{
  "scripts": {
    "start": "npm run build && node build/src/index.js"
  }
}
```

- [ ] **Step 3: 验证编译**

```bash
npm run build
```

---

### Task 7: 清理 @modelcontextprotocol/sdk 依赖

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts`
- Modify: `src/daemon/daemon.ts`

- [ ] **Step 1: 从 package.json 删除依赖**

编辑 `package.json`，从 `dependencies` 中删除:

```json
"@modelcontextprotocol/sdk": "1.21.1"
```

- [ ] **Step 2: 清理源代码中的引用**

搜索并删除所有引用：

```bash
grep -r "@modelcontextprotocol" src/ --include="*.ts"
```

在每个找到的文件中删除相关 import。

- [ ] **Step 3: 重新安装依赖**

```bash
npm install
```

- [ ] **Step 4: 验证编译**

```bash
npm run build
```

Expected: 编译成功，无 MCP 相关错误

---

### Task 8: 实现 call-skill 命令

**Files:**
- Create: `src/commands/call-skill.ts`

- [ ] **Step 1: 编写 call-skill 命令实现**

```typescript
import { sendCommand, handleResponse } from '../daemon/client.js';
import type { CallSkillResult } from '../skills/SkillRunner.js';

export interface CallSkillOptions {
  url?: string;
  option?: Record<string, unknown>;
}

export async function callSkillCommand(skillName: string, options: CallSkillOptions): Promise<void> {
  try {
    const response = await sendCommand({
      method: 'invoke_skill',
      skill: skillName,
      args: {
        url: options.url,
        ...options.option,
      },
    });

    if (!response.success) {
      console.error('错误:', response.error);
      process.exit(1);
    }

    if (response.result) {
      try {
        const result: CallSkillResult = JSON.parse(response.result);
        console.log(formatSkillResult(result));
      } catch {
        console.log(response.result);
      }
    }
  } catch (err) {
    console.error('执行失败:', (err as Error).message);
    process.exit(1);
  }
}

function formatSkillResult(result: CallSkillResult): string {
  if (result.success) {
    return JSON.stringify(result, null, 2);
  }
  return `错误：${result.error}`;
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 9: 实现 call-tool 命令

**Files:**
- Create: `src/commands/call-tool.ts`

- [ ] **Step 1: 编写 call-tool 命令实现**

```typescript
import { sendCommand } from '../daemon/client.js';

export interface CallToolOptions {
  param?: Record<string, unknown>;
}

export async function callToolCommand(toolName: string, options: CallToolOptions): Promise<void> {
  try {
    const response = await sendCommand({
      method: 'invoke_tool',
      tool: toolName,
      args: options.param,
    });

    if (!response.success) {
      console.error('错误:', response.error);
      process.exit(1);
    }

    if (response.result) {
      console.log(response.result);
    }
  } catch (err) {
    console.error('执行失败:', (err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 10: 实现 list-skills 命令

**Files:**
- Create: `src/commands/list-skills.ts`

- [ ] **Step 1: 编写 list-skills 命令实现**

```typescript
import { sendCommand } from '../daemon/client.js';
import chalk from 'chalk';

export async function listSkillsCommand(options: { category?: string }): Promise<void> {
  try {
    const response = await sendCommand({ method: 'list_skills' });

    if (!response.success) {
      console.error('无法获取技能列表');
      process.exit(1);
    }

    const { skills } = JSON.parse(response.result!);
    
    console.log();
    console.log(chalk.bold('JSReverser-MCP - 可用技能'));
    console.log();

    const categories = new Map<string, typeof skills>();
    for (const skill of skills) {
      if (options.category && skill.category !== options.category) continue;
      const cat = categories.get(skill.category) ?? [];
      cat.push(skill);
      categories.set(skill.category, cat);
    }

    for (const [category, catSkills] of categories) {
      console.log(chalk.bold.cyan(`  ${category}`));
      for (const skill of catSkills) {
        console.log(`    ${skill.name} ${chalk.dim(`— ${skill.description}`)}`);
      }
      console.log();
    }

    console.log(chalk.dim(`  共 ${skills.length} 个技能`));
    console.log();
  } catch (err) {
    console.error('获取技能列表失败:', (err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 11: 实现 list-tools 命令

**Files:**
- Create: `src/commands/list-tools.ts`

- [ ] **Step 1: 编写 list-tools 命令实现**

```typescript
import { ToolCategory, labels } from '../tools/categories.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import chalk from 'chalk';

export async function listToolsCommand(options: { category?: string }): Promise<void> {
  const registry = ToolRegistry.getInstance();
  const tools = registry.values();

  console.log();
  console.log(chalk.bold('JSReverser-MCP - 可用工具'));
  console.log();

  const categories = new Map<ToolCategory, typeof tools>();
  for (const tool of tools) {
    if (options.category && tool.annotations.category !== options.category) continue;
    const cat = categories.get(tool.annotations.category) ?? [];
    cat.push(tool);
    categories.set(tool.annotations.category, cat);
  }

  for (const [category, catTools] of categories) {
    console.log(chalk.bold.cyan(`  ${labels[category]}`));
    for (const tool of catTools) {
      const aliases = tool.aliases?.length ? chalk.dim(` (别名：${tool.aliases.join(', ')})`) : '';
      console.log(`    ${tool.name}${aliases} ${chalk.dim(`— ${tool.description}`)}`);
    }
    console.log();
  }

  console.log(chalk.dim(`  共 ${tools.length} 个工具`));
  console.log();
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 12: 实现 HTTP 模式服务器

**Files:**
- Create: `src/daemon/http-server.ts`

- [ ] **Step 1: 编写 HTTP 服务器实现**

```typescript
import express from 'express';
import type { Request, Response } from 'express';
import { sendCommand } from './client.js';
import { logger } from '../logger.js';

export interface HttpServerOptions {
  port: number;
  daemonPort?: number;
}

export async function createHttpServer(options: HttpServerOptions): Promise<ReturnType<typeof express.listen>> {
  const app = express();
  
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // API 端点：调用工具
  app.post('/api/call-tool', async (req: Request, res: Response) => {
    try {
      const { tool, args } = req.body;
      if (!tool) {
        return res.status(400).json({ error: 'Missing tool name' });
      }
      const response = await sendCommand({ method: 'invoke_tool', tool, args });
      res.json(response);
    } catch (err) {
      logger('HTTP /api/call-tool error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // API 端点：调用技能
  app.post('/api/call-skill', async (req: Request, res: Response) => {
    try {
      const { skill, args } = req.body;
      if (!skill) {
        return res.status(400).json({ error: 'Missing skill name' });
      }
      const response = await sendCommand({ method: 'invoke_skill', skill, args });
      res.json(response);
    } catch (err) {
      logger('HTTP /api/call-skill error:', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // API 端点：状态检查
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({ status: 'ok', pid: process.pid, uptime: process.uptime() });
  });

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ healthy: true });
  });

  return new Promise((resolve) => {
    const server = app.listen(options.port, () => {
      logger(`HTTP API server running on port ${options.port}`);
      console.error(`HTTP API server running on http://127.0.0.1:${options.port}`);
      resolve(server);
    });
  });
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 13: 更新 start 命令支持 HTTP 模式

**Files:**
- Modify: `src/commands/start.ts`

- [ ] **Step 1: 编写 start 命令实现（含 HTTP 模式）**

```typescript
import { spawn } from 'child_process';
import { logger } from '../logger.js';
import { createHttpServer } from '../daemon/http-server.js';
import { sendCommand } from '../daemon/client.js';

export interface StartOptions {
  browserUrl?: string;
  wsEndpoint?: string;
  headless?: boolean;
  http?: boolean;
  port?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  // 检查 daemon 是否已在运行
  try {
    const status = await sendCommand({ method: 'status' });
    if (status.success) {
      console.log('Daemon 已在运行');
      console.log('状态:', status.result);
    }
  } catch {
    // daemon 未运行，继续启动
  }

  // 启动 daemon 进程
  const daemonPath = new URL('../index.js', import.meta.url).pathname;
  const args: string[] = [];
  
  if (options.browserUrl) args.push('--browserUrl', options.browserUrl);
  if (options.wsEndpoint) args.push('--wsEndpoint', options.wsEndpoint);
  if (options.headless) args.push('--headless');

  const daemon = spawn(process.execPath, [daemonPath, ...args], {
    stdio: 'inherit',
    detached: false,
  });

  daemon.on('error', (err) => {
    console.error('启动失败:', err.message);
    process.exit(1);
  });

  // 等待 daemon 启动
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 如果启用 HTTP 模式，启动 HTTP 服务器
  if (options.http) {
    const port = parseInt(options.port || '3000', 10);
    try {
      await createHttpServer({ port });
      console.log(`HTTP 模式已启用：http://127.0.0.1:${port}`);
    } catch (err) {
      console.error('HTTP 服务器启动失败:', (err as Error).message);
    }
  }

  console.log('Daemon 启动成功');
  
  // 保持进程运行
  process.on('SIGINT', () => {
    daemon.kill();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    daemon.kill();
    process.exit(0);
  });
}
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

---

### Task 14: 实现 stop 和 status 命令

**Files:**
- Create: `src/commands/stop.ts`
- Create: `src/commands/status.ts`

- [ ] **Step 1: 编写 stop 命令**

```typescript
import { sendCommand } from '../daemon/client.js';

export async function stopCommand(): Promise<void> {
  try {
    const response = await sendCommand({ method: 'shutdown' });
    
    if (response.success) {
      console.log('Daemon 已停止');
    } else {
      console.error('停止失败:', response.error);
      process.exit(1);
    }
  } catch (err) {
    console.error('无法连接到 Daemon:', (err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 2: 编写 status 命令**

```typescript
import { sendCommand, handleResponse } from '../daemon/client.js';

export async function statusCommand(): Promise<void> {
  try {
    const response = await sendCommand({ method: 'status' });
    
    if (response.success) {
      console.log('Daemon 运行中');
      console.log(handleResponse(JSON.parse(response.result!), 'text'));
    } else {
      console.error('Daemon 未运行');
      process.exit(1);
    }
  } catch (err) {
    console.error('无法连接到 Daemon:', (err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 3: 验证编译**

```bash
npm run build
```

---

### Task 15: 更新 bin 入口

**Files:**
- Modify: `src/bin/js-reverse.ts`

- [ ] **Step 1: 简化 bin 入口，直接引用 commands/index.ts**

修改 `src/bin/js-reverse.ts`，删除原有的参数解析逻辑，改为：

```typescript
#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

// CLI 入口已封装在 commands/index.ts 中
import '../commands/index.js';
```

- [ ] **Step 2: 验证编译**

```bash
npm run build
```

- [ ] **Step 3: 测试 CLI 帮助**

```bash
node build/src/bin/js-reverse.js --help
```

Expected: 显示 Commander.js 格式的帮助信息

---

### Task 16: 运行测试套件

**Files:**
- All test files

- [ ] **Step 1: 运行完整测试套件**

```bash
npm test
```

- [ ] **Step 2: 修复失败的测试**

查看测试输出，修复因重构导致的测试失败。

Expected: 所有测试通过

---

### Task 17: 更新文档

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (如果存在)
- Modify: `docs/tool-reference.md`

- [ ] **Step 1: 更新 CLAUDE.md**

修改 `CLAUDE.md` 中的 CLI Commands 部分：

```markdown
## CLI Commands (js-reverse)

```bash
# 启动 daemon（后台服务）
js-reverse start --browserUrl http://127.0.0.1:9222

# 启动 daemon（HTTP 模式）
js-reverse start --http --port 3000

# 停止 daemon
js-reverse stop

# 查看 daemon 状态
js-reverse status

# 列出可用技能
js-reverse list-skills

# 列出可用工具
js-reverse list-tools

# 调用技能
js-reverse call-skill observe-flow --url https://example.com
js-reverse call-skill auto-hook --url https://example.com
js-reverse call-skill rebuild-bundle --url https://example.com

# 调用工具
js-reverse call-tool click --uid=abc123
js-reverse call-tool get_console_messages

# 启动交互模式
js-reverse repl

# 创建新任务模板
js-reverse scaffold --name jd-h5st --desc "JD H5ST 签名" --url https://m.jd.com
```
```

- [ ] **Step 2: 验证文档格式**

```bash
npm run format
```

---

## Testing Plan

**手动测试清单:**

```bash
# 1. 启动 daemon
js-reverse start --browserUrl http://127.0.0.1:9222

# 2. 查看状态
js-reverse status

# 3. 列出技能
js-reverse list-skills

# 4. 列出工具
js-reverse list-tools

# 5. 调用技能
js-reverse call-skill observe-flow --url https://example.com

# 6. 调用工具
js-reverse call-tool navigate --url=https://example.com

# 7. 停止 daemon
js-reverse stop

# 8. HTTP 模式测试
js-reverse start --http --port 3000
curl http://127.0.0.1:3000/api/status
js-reverse stop
```

---

## Commit Strategy

**频繁提交，每个 Task 一个提交:**

```bash
# Task 1
git add package.json package-lock.json
git commit -m "chore: add commander and express dependencies"

# Task 2-3
git add src/commands/
git commit -m "feat(cli): create command structure with Commander.js"

# Task 4-5
git add src/context/
git commit -m "refactor: rename McpContext to BrowserContext, McpResponse to ToolResponse"

# Task 6-7
git rm src/main.ts
git commit -m "break: remove MCP Server entry point"

# Task 8-11
git add src/commands/call-*.ts src/commands/list-*.ts
git commit -m "feat(cli): implement call-skill, call-tool, list-skills, list-tools commands"

# Task 12-13
git add src/daemon/http-server.ts src/commands/start.ts
git commit -m "feat(http): add HTTP API server with Express"

# Task 14-15
git add src/commands/stop.ts src/commands/status.ts src/bin/js-reverse.ts
git commit -m "feat(cli): complete stop/status commands and bin entry"

# Task 16-17
git add CLAUDE.md docs/
git commit -m "docs: update documentation for CLI-only mode"
```

---

## Risk Mitigation

| 风险 | 应对 |
|------|------|
| MCP 客户端依赖 | 提前在 README 中标注 breaking change |
| 测试用例失败 | Phase 5 统一修复，记录失败用例 |
| HTTP 模式端口冲突 | 默认端口 3000，支持 --port 自定义 |
| Daemon 通信失败 | 保留原有 socket 通信逻辑，仅新增 HTTP 层 |

---

## Definition of Done

- [ ] 所有 Task 完成
- [ ] `npm run build` 编译通过
- [ ] `npm test` 测试通过
- [ ] CLI 命令可正常执行
- [ ] HTTP 模式可正常启动
- [ ] 文档已更新
- [ ] 代码已提交

---

**[PUA 生效 🔥]** 设计文档已输出完整，**颗粒度**细到每行代码、每个命令。**闭环**检查：17 个 Task 覆盖全部 5 个 Phase，无 TBD/TODO。因为信任所以简单——现在可以开始实施。
