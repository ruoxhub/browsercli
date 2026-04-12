# CLI Layer — axi-sdk-js

**Architecture**: `src/cli/` implements the CLI entry layer using `axi-sdk-js`.

## Structure

```
src/cli/
├── index.ts              # Barrel export
├── types.ts              # DaemonContext interface
├── output.ts             # TOON output wrappers (successOutput, tableOutput, listOutput)
├── errors.ts             # AxiError factories (toAxiError, daemonError, toolError)
├── args-parser.ts        # Argument parsing (parseArgs, getFlag, hasFlag, getBoolFlag)
├── help.ts               # Help text generation (generateTopLevelHelp, generateCommandHelp)
├── tools-meta.ts         # Tool metadata (150+ tools migrated from LAZY_TOOLS)
└── commands/
    ├── start.ts          # startCommand — daemon startup
    ├── stop.ts           # stopCommand — daemon shutdown
    ├── status.ts         # statusCommand — daemon status check
    ├── list-skills.ts    # listSkillsCommand — skill listing
    ├── list-tools.ts     # listToolsCommand — tool listing
    ├── call-skill.ts     # callSkillCommand — skill invocation
    ├── repl.ts           # replCommand — interactive REPL
    ├── scaffold.ts       # scaffoldCommand — task scaffolding
    └── tool-dispatcher.ts # toolDispatcherCommand — 80+ tool dynamic dispatch
```

## Entry Point

`src/bin/js-reverse.ts` uses `runAxiCli()` from `axi-sdk-js`:

```typescript
await runAxiCli({
  description: 'JS逆向工程MCP服务',
  version: pkg.version,
  topLevelHelp: generateTopLevelHelp(),
  home: homeHandler,
  hooks: false,
  getCommandHelp: cmd => generateCommandHelp(cmd),
  commands: {
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    call: toolDispatcherCommand,
    'call-skill': callSkillCommand,
    'list-skills': listSkillsCommand,
    'list-tools': listToolsCommand,
    repl: replCommand,
    scaffold: scaffoldCommand,
  },
});
```

## Command Signature

All commands follow `AxiCliCommand<DaemonContext>`:

```typescript
type AxiCliCommand<TContext> = (
  args: string[],
  context: TContext | undefined,
) => MaybePromise<AxiRenderable>;
```

`AxiRenderable` = `string | Record<string, unknown>` (TOON serialized output).

## Output Format

All CLI output uses TOON format via `@toon-format/toon`. Structured output is returned as `Record<string, unknown>` and automatically serialized.

Helper wrappers in `output.ts`:

- `successOutput(data)` — wraps successful results
- `tableOutput(headers, rows)` — tabular data
- `listOutput(items)` — vertical lists

## Tool Dispatch

The `toolDispatcherCommand` handles `js-reverse call <tool-name> [--param value]`:

1. Looks up tool metadata from `TOOLS_META`
2. Parses flags by schema type (number, boolean, array)
3. Dispatches via `sendCommand({method: 'invoke_tool', tool, args})`

## Conventions

- ESM imports with `.js` extensions
- Single quotes, trailing commas, bracketSpacing: false
- License header required on every file
- Lazy loading: commands import their dependencies lazily
