# Local Task Report (Template)

## Summary
- targetParam: `<param_name>`
- status: `<pass|fail|partial>`

## Request Contract
- url: `<url>`
- method: `<GET|POST>`
- required fields: `<...>`

## Sign Chain
- entry: `<...>`
- included fields (`_stk`): `<...>`

## Env Dependencies
- `<window/document/navigator/storage/...>`

## Portable Runtime Status
- file: `<run/exported-runtime.js or N/A>`
- callable surface: `<genSign(...)>`
- status: `<pass|fail|partial>`

## Pure Algorithm Status
- file: `<run/pure-*.js or N/A>`
- optional extra runtime: `<run/pure_*.py or N/A>`
- status: `<pass|fail|partial>`
- known constants boundary: `<...>`

## Fixture Result
- fixture input: `<path/query/runtimeContext summary>`
- fixture output: `<fixed signer output>`
- cross-runtime aligned: `<yes|no|partial>`

## Verify Result
- status: `<code>`
- body preview: `<first 300 chars>`

## Server Acceptance
- generated request: `<pass|fail|partial>`
- business code gate: `<status_code or equivalent>`

## Current Entrypoints
- recommended entry: `<run/...>`
- verify entry: `<run/verify/...>`
- trace entry: `<run/trace/...>`
- archived entry root: `<run/legacy/... or N/A>`

## First Divergence
- `<first mismatch>`
- next action: `<single-variable patch>`

## Drift Boundary
- unchanged parts: `<...>`
- changed parts: `<...>`
- next upgrade focus: `<env rebuild|portable runtime|pure algorithm>`
