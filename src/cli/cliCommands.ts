/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 工具位置参数映射与字面量保护（参考 chrome-devtools-mcp/src/config/cli-commands.ts）。
 *
 * 规则：
 * 1. 所有 schema 中 `required: true` 的参数默认作为位置参数暴露（数组类型作为末尾变长位置参数）；
 * 2. 少数主参数为二选一或可选的常用工具（如 `select_page`、`close_page`、`click`、`fill`、
 *    `evaluate_script`、`navigate_page` 等）提供符合直觉的可选位置参数；
 * 3. yargs 命令模板统一使用 `[arg]` / `[arg..]` 形式注册，使位置参数与传统 `--flag` /
 *    `--data` / `--file` / `--stdin` 传参 100% 兼容，同时在 `--help` 的 usage 行中以
 *    `<arg>` / `[arg]` 清晰区分必填与可选位置参数。
 */

import type {ToolArgSpec, ToolArgSpecMap} from './tool-meta-types.js';

export type OptionKind = 'boolean' | 'array' | 'value';

export type PositionalTarget =
  | {kind: 'arg'; argName: string}
  | {kind: 'element'; uidArg: string; selectorArg: string}
  | {kind: 'nav'}
  | {kind: 'uploadFiles'}
  | {kind: 'clickAtX'};

export interface PositionalSlot {
  /** 位置参数展示名（如 url、page、target） */
  name: string;
  /** 将位置值写入 toolArgs 的目标规则 */
  target: PositionalTarget;
  /** 传给 yargs `.positional()` 的类型 */
  type: 'string' | 'number' | 'boolean';
  /** 是否对应 schema 必填项（用于 usage 行渲染 `<name>` vs `[name]`） */
  required: boolean;
  /** 是否为变长位置参数（`[name..]`） */
  variadic?: boolean;
  description: string;
  defaultValue?: unknown;
  enum?: string[];
}

export interface BuiltToolCommand {
  /** 位置参数槽位列表（顺序即 CLI 位置顺序） */
  slots: PositionalSlot[];
  /** yargs 命令模板后缀，如 ` [url]` 或 ` [width] [height]` */
  positionalSuffix: string;
  /** `--help` 展示的完整 usage 行（如 `$0 select_page [page] [--pageId] [--pageIdx] [--bringToFront]`） */
  usage: string;
}

export interface CommandArgSpec {
  /** 已知选项名（camelCase 及短别名）与取值方式 */
  options: Map<string, OptionKind>;
  /** 位置参数槽位数量 */
  positionalCount: number;
  /** 最后一个位置参数是否为变长 */
  variadic: boolean;
}

/**
 * 所有工具命令通用的 CLI 控制/全局选项，供 `shieldLiteralArgs` 跳过已知选项与值。
 */
export const GLOBAL_CLI_OPTIONS: ReadonlyMap<string, OptionKind> = new Map([
  ['s', 'value'],
  ['session', 'value'],
  ['outputFormat', 'value'],
  ['json', 'boolean'],
  ['toon', 'boolean'],
  ['data', 'value'],
  ['file', 'value'],
  ['stdin', 'boolean'],
  ['watch', 'boolean'],
  ['help', 'boolean'],
  ['h', 'boolean'],
  ['version', 'boolean'],
]);

const SNAPSHOT_UID_RE = /^\d+_\d+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const NAV_ACTIONS = new Set(['back', 'forward', 'reload']);

const LITERAL_PREFIX = '\0lit:';
// 与 yargs-parser 负数判定保持一致
const NEGATIVE_NUMBER = /^-\d+(\.\d*)?(e-?\d+)?$/;

function toPositionalYargsType(
  specType: ToolArgSpec['type'] | undefined,
): 'string' | 'number' | 'boolean' {
  if (specType === 'number') return 'number';
  if (specType === 'boolean') return 'boolean';
  return 'string';
}

export function toOptionKind(type: string | undefined): OptionKind {
  if (type === 'boolean') return 'boolean';
  if (type === 'string[]' || type === 'array') return 'array';
  return 'value';
}

function makeArgSlot(argName: string, spec: ToolArgSpec): PositionalSlot {
  const isArray = spec.type === 'string[]';
  return {
    name: argName,
    target: {kind: 'arg', argName},
    type: isArray ? 'string' : toPositionalYargsType(spec.type),
    required: spec.required,
    ...(isArray ? {variadic: true} : {}),
    description: spec.description,
    ...(spec.defaultValue !== undefined
      ? {defaultValue: spec.defaultValue}
      : {}),
    ...(spec.enum?.length ? {enum: spec.enum} : {}),
  };
}

/**
 * 主参数在 schema 中因双模/二选一而标记为 optional 的工具位置参数表。
 */
function getOverrideSlots(
  toolName: string,
  argSpecs: ToolArgSpecMap,
): PositionalSlot[] | undefined {
  switch (toolName) {
    case 'select_page':
    case 'close_page':
      return argSpecs.pageId
        ? [makeArgSlot('pageId', argSpecs.pageId)]
        : undefined;

    case 'evaluate_script':
      if (!argSpecs.function) return undefined;
      return [makeArgSlot('function', argSpecs.function)];

    case 'navigate_page':
      return [
        {
          name: 'target',
          target: {kind: 'nav'},
          type: 'string',
          required: false,
          description:
            '目标 URL 或导航动作（back / forward / reload），可用 --url / --type 替代',
        },
      ];

    case 'click':
    case 'hover':
    case 'get_css_styles':
      return [
        {
          name: 'target',
          target: {kind: 'element', uidArg: 'uid', selectorArg: 'selector'},
          type: 'string',
          required: false,
          description:
            '元素 uid（如 1_4）或定位器（CSS/role=/text=/xpath=），可用 --uid / --selector 替代',
        },
      ];

    case 'fill':
      return [
        {
          name: 'target',
          target: {kind: 'element', uidArg: 'uid', selectorArg: 'selector'},
          type: 'string',
          required: false,
          description:
            '元素 uid（如 1_4）或定位器（CSS/role=/text=/xpath=），可用 --uid / --selector 替代',
        },
        ...(argSpecs.value ? [makeArgSlot('value', argSpecs.value)] : []),
      ];

    case 'upload_file':
      return [
        {
          name: 'target',
          target: {kind: 'element', uidArg: 'uid', selectorArg: 'selector'},
          type: 'string',
          required: false,
          description:
            '元素 uid（如 1_4）或定位器，可用 --uid / --selector 替代',
        },
        {
          name: 'files',
          target: {kind: 'uploadFiles'},
          type: 'string',
          required: false,
          variadic: true,
          description:
            '要上传的一个或多个本地文件路径，可用 --filePath / --filePaths 替代',
        },
      ];

    case 'drag':
      return [
        {
          name: 'from',
          target: {
            kind: 'element',
            uidArg: 'fromUid',
            selectorArg: 'fromSelector',
          },
          type: 'string',
          required: false,
          description:
            '拖拽源元素 uid 或定位器，可用 --fromUid / --fromSelector 替代',
        },
        {
          name: 'to',
          target: {
            kind: 'element',
            uidArg: 'toUid',
            selectorArg: 'toSelector',
          },
          type: 'string',
          required: false,
          description:
            '拖拽目标元素 uid 或定位器，可用 --toUid / --toSelector 替代',
        },
      ];

    case 'click_at':
      return [
        {
          name: 'x',
          target: {kind: 'clickAtX'},
          type: 'string',
          required: false,
          description:
            '视口 X 坐标（配合 y 使用），或单个元素 uid/定位器，可用 --x/--y/--uid/--selector 替代',
        },
        ...(argSpecs.y ? [makeArgSlot('y', argSpecs.y)] : []),
      ];

    case 'get_network_request':
      return argSpecs.reqid
        ? [makeArgSlot('reqid', argSpecs.reqid)]
        : undefined;

    case 'get_script_source':
      return argSpecs.scriptId
        ? [makeArgSlot('scriptId', argSpecs.scriptId)]
        : undefined;

    case 'break_on_xhr':
    case 'remove_xhr_breakpoint':
      return argSpecs.url ? [makeArgSlot('url', argSpecs.url)] : undefined;

    case 'mock_network':
    case 'remove_network_mock':
      return argSpecs.route
        ? [makeArgSlot('route', argSpecs.route)]
        : undefined;

    case 'wasm_dump':
      return argSpecs.moduleIndex
        ? [makeArgSlot('moduleIndex', argSpecs.moduleIndex)]
        : undefined;

    default:
      return undefined;
  }
}

/**
 * 计算工具的位置参数槽位列表。
 * 变长位置参数（`variadic: true`）保证排在最后，以满足 yargs 约束。
 */
export function getToolPositionalSlots(
  toolName: string,
  argSpecs: ToolArgSpecMap = {},
): PositionalSlot[] {
  const override = getOverrideSlots(toolName, argSpecs);
  if (override) return override;

  const fixed: PositionalSlot[] = [];
  const variadic: PositionalSlot[] = [];
  for (const [argName, spec] of Object.entries(argSpecs)) {
    if (!spec.required) continue;
    const slot = makeArgSlot(argName, spec);
    if (slot.variadic) {
      variadic.push(slot);
    } else {
      fixed.push(slot);
    }
  }
  return [...fixed, ...variadic];
}

/**
 * 构建工具的 yargs 命令位置后缀与 `--help` usage 行（参考 chrome-devtools `buildCommand`）。
 *
 * 命令模板一律用 `[name]` / `[name..]`，使 `--flag` / `--data` / `--file` / `--stdin`
 * 保持 100% 兼容；usage 行则以 `<name>` 标注 schema 必填项。
 */
export function buildToolCommand(
  toolName: string,
  argSpecs: ToolArgSpecMap = {},
): BuiltToolCommand {
  const slots = getToolPositionalSlots(toolName, argSpecs);
  const directPositionalNames = new Set<string>();
  let positionalSuffix = '';
  let usagePositionals = '';

  for (const slot of slots) {
    if (slot.target.kind === 'arg') {
      directPositionalNames.add(slot.target.argName);
    } else if (slot.target.kind === 'clickAtX') {
      directPositionalNames.add('x');
    }
    positionalSuffix += slot.variadic ? ` [${slot.name}..]` : ` [${slot.name}]`;
    const token = slot.variadic ? `${slot.name}..` : slot.name;
    usagePositionals += slot.required ? ` <${token}>` : ` [${token}]`;
  }

  let flags = '';
  for (const argName of Object.keys(argSpecs)) {
    if (!directPositionalNames.has(argName)) {
      flags += ` [--${argName}]`;
    }
  }

  return {
    slots,
    positionalSuffix,
    usage: `$0 ${toolName}${usagePositionals}${flags}`,
  };
}

/**
 * 返回 yargs 命令字符串数组（主命令名 + 所有别名均带位置参数模板）。
 */
export function buildCommandPatterns(
  names: readonly string[],
  positionalSuffix: string,
): string[] {
  if (!positionalSuffix) return [...names];
  return names.map(name => `${name}${positionalSuffix}`);
}

/**
 * 判断槽位名是否属于虚拟位置槽位（非 argSpecs 真实键，调用工具前需剥离）。
 */
export function isSyntheticPositionalSlot(slot: PositionalSlot): boolean {
  return slot.target.kind !== 'arg' && slot.target.kind !== 'clickAtX';
}

/**
 * 生成 `shieldLiteralArgs` 所需的命令参数规格。
 * 所有 schema 参数（包括同时支持 `--flag` 的位置参数）均注册为已知选项。
 */
export function getToolArgSpec(
  toolName: string,
  argSpecs: ToolArgSpecMap = {},
  globalOptions: ReadonlyMap<string, OptionKind> = GLOBAL_CLI_OPTIONS,
): CommandArgSpec {
  const options = new Map(globalOptions);
  for (const [argName, spec] of Object.entries(argSpecs)) {
    options.set(argName, toOptionKind(spec.type));
  }
  const slots = getToolPositionalSlots(toolName, argSpecs);
  return {
    options,
    positionalCount: slots.length,
    variadic: slots.some(s => s.variadic === true),
  };
}

function optionName(token: string): string {
  let name = token.replace(/^-+/, '');
  const eq = name.indexOf('=');
  if (eq !== -1) {
    name = name.slice(0, eq);
  }
  if (name.startsWith('no-')) {
    name = name.slice(3);
  }
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 保护 yargs 无法安全透传的位置参数字面量（参考 chrome-devtools `shieldLiteralArgs`）：
 * - 孤立 `-`；
 * - `--` 之后的全部参数（并移除 `--`，使其填入位置参数）；
 * - 当存在未填满的位置槽位时，以 `-` 开头且不是已知选项的字面量（如 `--weird`、`- item`）。
 *
 * 与 chrome-devtools 相比，额外支持在子命令前出现的全局选项（如 `-s work select_page 1`）。
 */
export function shieldLiteralArgs(
  rawArgv: readonly string[],
  getSpec?: (commandName: string) => CommandArgSpec | undefined,
  globalOptions: ReadonlyMap<string, OptionKind> = GLOBAL_CLI_OPTIONS,
): {
  argv: string[];
  restore: (value: unknown) => unknown;
} {
  const literals = new Map<string, string>();
  const out: string[] = [];
  const shield = (tok: string): void => {
    const key = `${LITERAL_PREFIX}${literals.size}`;
    literals.set(key, tok);
    out.push(key);
  };

  let spec: CommandArgSpec | undefined;
  let filled = 0;
  let afterDoubleDash = false;

  for (let i = 0; i < rawArgv.length; i++) {
    const tok = rawArgv[i];
    if (afterDoubleDash) {
      shield(tok);
      continue;
    }
    if (tok === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (tok === '-') {
      shield(tok);
      if (spec) filled++;
      continue;
    }
    if (!tok.startsWith('-') || NEGATIVE_NUMBER.test(tok)) {
      out.push(tok);
      if (!spec && getSpec) {
        spec = getSpec(tok);
      } else if (spec) {
        filled++;
      }
      continue;
    }

    const optKey = optionName(tok);
    const kind = spec ? spec.options.get(optKey) : globalOptions.get(optKey);
    if (kind !== undefined) {
      out.push(tok);
      if (tok.includes('=')) {
        continue;
      }
      if (kind === 'boolean') {
        if (/^(true|false)$/.test(rawArgv[i + 1] ?? '')) {
          out.push(rawArgv[++i]);
        }
      } else if (kind === 'array') {
        while (i + 1 < rawArgv.length && !rawArgv[i + 1].startsWith('-')) {
          out.push(rawArgv[++i]);
        }
      } else if (i + 1 < rawArgv.length) {
        out.push(rawArgv[++i]);
      }
      continue;
    }

    const hasUnfilledPositional =
      spec !== undefined &&
      (filled < spec.positionalCount ||
        (spec.variadic && spec.positionalCount > 0));
    if (hasUnfilledPositional) {
      shield(tok);
      filled++;
    } else {
      out.push(tok);
    }
  }

  const restore = (val: unknown): unknown => {
    if (typeof val === 'string') return literals.get(val) ?? val;
    if (Array.isArray(val)) return val.map(restore);
    return val;
  };

  return {argv: out, restore};
}

function isSlotSatisfied(
  slot: PositionalSlot,
  toolArgs: Record<string, unknown>,
): boolean {
  switch (slot.target.kind) {
    case 'arg':
      return (
        toolArgs[slot.target.argName] !== undefined &&
        !(slot.target.argName === 'function' && toolArgs.function === true)
      );
    case 'element':
      return (
        toolArgs[slot.target.uidArg] !== undefined ||
        toolArgs[slot.target.selectorArg] !== undefined
      );
    case 'nav':
      return toolArgs.url !== undefined || toolArgs.type !== undefined;
    case 'uploadFiles':
      return (
        toolArgs.filePath !== undefined || toolArgs.filePaths !== undefined
      );
    case 'clickAtX':
      return (
        toolArgs.x !== undefined ||
        toolArgs.uid !== undefined ||
        toolArgs.selector !== undefined
      );
  }
}

function assignElementTarget(
  toolArgs: Record<string, unknown>,
  rawValue: string,
  uidArg: string,
  selectorArg: string,
): void {
  if (SNAPSHOT_UID_RE.test(rawValue)) {
    toolArgs[uidArg] = rawValue;
  } else {
    toolArgs[selectorArg] = rawValue;
  }
}

/**
 * 将 CLI 位置参数按槽位定义映射到 `toolArgs`（不覆盖显式传入的 `--flag`）。
 */
export function applyPositionalArgs(
  toolName: string,
  toolArgs: Record<string, unknown>,
  positionals: readonly string[],
  argSpecs: ToolArgSpecMap = {},
  coerce: (raw: unknown, spec?: ToolArgSpec) => unknown,
): void {
  // 特殊规整：`click_at <uid|selector>` 在 yargs 直接填充 `x` 为非数字字符串时，转为 uid/selector
  if (
    toolName === 'click_at' &&
    typeof toolArgs.x === 'string' &&
    !NUMBER_RE.test(toolArgs.x) &&
    toolArgs.y === undefined &&
    toolArgs.uid === undefined &&
    toolArgs.selector === undefined
  ) {
    const rawTarget = toolArgs.x;
    delete toolArgs.x;
    assignElementTarget(toolArgs, rawTarget, 'uid', 'selector');
  }

  // `evaluate_script` 兼容多段位置参数拼接（例如 `evaluate-script -- "() => --x" "--json"`）
  if (
    positionals.length > 0 &&
    argSpecs.function?.type === 'string' &&
    toolName === 'evaluate_script'
  ) {
    if (toolArgs.function === undefined || toolArgs.function === true) {
      toolArgs.function = positionals.join(' ');
    } else if (typeof toolArgs.function === 'string') {
      toolArgs.function = [toolArgs.function, ...positionals].join(' ');
    }
    return;
  }

  if (positionals.length === 0) return;

  const slots = getToolPositionalSlots(toolName, argSpecs);
  let posIdx = 0;

  for (const slot of slots) {
    if (posIdx >= positionals.length) break;
    if (isSlotSatisfied(slot, toolArgs)) continue;

    if (slot.variadic) {
      const rest = positionals.slice(posIdx);
      posIdx = positionals.length;
      if (slot.target.kind === 'uploadFiles') {
        if (rest.length === 1) {
          toolArgs.filePath = rest[0];
        } else if (rest.length > 1) {
          toolArgs.filePaths = rest;
        }
      } else if (slot.target.kind === 'arg') {
        const argName = slot.target.argName;
        toolArgs[argName] = coerce(rest, argSpecs[argName]);
      }
      break;
    }

    const raw = positionals[posIdx++];
    switch (slot.target.kind) {
      case 'element':
        assignElementTarget(
          toolArgs,
          raw,
          slot.target.uidArg,
          slot.target.selectorArg,
        );
        break;

      case 'nav':
        if (NAV_ACTIONS.has(raw)) {
          toolArgs.type = raw;
        } else {
          toolArgs.url = raw;
        }
        break;

      case 'clickAtX':
        if (NUMBER_RE.test(raw)) {
          toolArgs.x = Number(raw);
        } else if (toolArgs.y === undefined) {
          assignElementTarget(toolArgs, raw, 'uid', 'selector');
        } else {
          toolArgs.x = coerce(raw, argSpecs.x);
        }
        break;

      case 'arg': {
        const argName = slot.target.argName;
        const coerced = coerce(raw, argSpecs[argName]);
        if (coerced !== undefined) {
          toolArgs[argName] = coerced;
        }
        break;
      }
    }
  }
}
