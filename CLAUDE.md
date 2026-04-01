# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
npm ci

# Build the project (TypeScript compilation + post-build scripts)
npm run build

# Run all tests
npm test

# Run a single test file (after building)
node --require ./build/tests/setup.js --no-warnings=ExperimentalWarning --test-reporter spec --test-force-exit --test "build/tests/path/to/test.test.js"

# Run only tests marked with { only: true }
npm run test:only

# Update test snapshots
npm run test:update-snapshots

# Type checking without emitting
npm run typecheck

# Lint and format
npm run format

# Start the MCP server (builds first)
npm run start

# Start with debug logging
npm run start-debug

# Generate documentation (after changing tools)
npm run docs
```

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/src/index.js
```

## CLI Commands (js-reverse)

```bash
# Start daemon (background service)
js-reverse start --browserUrl http://127.0.0.1:9222

# Stop daemon
js-reverse stop

# Check daemon status
js-reverse status

# List available skills
js-reverse list-skills

# Call a skill
js-reverse call-skill observe-flow --url https://example.com
js-reverse call-skill auto-hook --url https://example.com
js-reverse call-skill rebuild-bundle --url https://example.com

# Start interactive REPL mode
js-reverse repl

# Create new task scaffold
js-reverse scaffold --name jd-h5st --desc "JD H5ST signature" --url https://m.jd.com
```

**Windows 用户：**

方案 1 - 使用批处理脚本：
```powershell
# 在项目目录执行
.\js-reverse.bat start --browserUrl http://127.0.0.1:9222
.\js-reverse.bat status
.\js-reverse.bat stop
```

方案 2 - 使用 npm 脚本：
```powershell
npm run cli:daemon:start -- --browserUrl http://127.0.0.1:9222
npm run cli:daemon:status
npm run cli:daemon:stop
```

方案 3 - 全局安装：
```powershell
npm install -g .
js-reverse start --browserUrl http://127.0.0.1:9222
```

## Architecture Overview

This is an MCP (Model Context Protocol) server that exposes Chrome DevTools functionality to AI coding assistants via Puppeteer.

### Core Components

- **`src/main.ts`**: Entry point. Creates the MCP server, registers all tools, and handles tool execution with **mutex-based serialization** to prevent concurrent tool access.

- **`src/McpContext.ts`**: Central state management class. Maintains:
  - Browser and page state (selected page, page list)
  - Accessibility tree snapshots for element interaction
  - Network and console collectors
  - Debugger context for script/breakpoint management
  - Performance trace state

- **`src/McpResponse.ts`**: Response builder that tools use to construct their output (text, images, snapshots, network data, console data).

- **`src/browser.ts`**: Browser lifecycle management. Handles launching new Chrome instances or connecting to existing ones via `browserURL`/`wsEndpoint`.

### Tool System

Tools are defined in `src/tools/` using the `defineTool()` helper from `src/tools/ToolDefinition.ts`. Each tool has:

- `name`: Tool identifier
- `description`: For MCP clients
- `annotations`: Category and read-only hint
- `schema`: Zod schema for input validation
- `handler`: Implementation that receives request, response builder, and context

Tool categories are defined in `src/tools/categories.ts` and can be disabled via CLI flags (e.g., `--categoryNetwork=false`).

### CLI Arguments

Key runtime options passed via MCP server config `env`:

- `--browserUrl`: Connect to existing Chrome instance
- `--wsEndpoint`: Connect via WebSocket endpoint
- `--headless`: Run in headless mode
- `--executablePath`: Custom Chrome path
- `--chromeArg`: Additional Chrome flags

### Data Collection

- **`src/PageCollector.ts`**: Base class for collecting page events. Extended by `NetworkCollector` and `ConsoleCollector` to track requests and console messages across pages.

- **`src/formatters/`**: Convert collected data to text format for MCP responses.

### Third-Party Integration

- **`src/third_party/index.ts`**: Re-exports from bundled dependencies (puppeteer, @modelcontextprotocol/sdk, zod).

- **`chrome-devtools-frontend`**: Used for performance trace analysis and issue descriptions. Included via tsconfig.json.

### Testing

Tests use Node.js built-in test runner. Test files mirror source structure under `tests/`. Snapshots are stored alongside test files with `.snapshot` extension.

- `tests/setup.ts`: Configures snapshot paths and serializers
- `tests/server.ts`: Test utilities for MCP server testing
- `tests/utils.ts`: Shared test helpers

## Conventions

- Follow [conventional commits](https://www.conventionalcommits.org/) for PR and commit titles
- Run `npm run docs` after adding or modifying tools to update documentation
- Node version: v22 (see .nvmrc)

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **JSReverser-MCP** (2716 symbols, 7839 relationships, 223 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/JSReverser-MCP/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/JSReverser-MCP/context` | Codebase overview, check index freshness |
| `gitnexus://repo/JSReverser-MCP/clusters` | All functional areas |
| `gitnexus://repo/JSReverser-MCP/processes` | All execution flows |
| `gitnexus://repo/JSReverser-MCP/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
