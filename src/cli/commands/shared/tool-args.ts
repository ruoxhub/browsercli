/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ParsedArgs} from '../../args-parser.js';
import type {ToolMeta} from '../../tools-meta.js';

type ToolArgCoercer = (value: string | boolean) => unknown;

const schemaCoercers: Record<string, ToolArgCoercer> = {
  boolean: value => value === true || value === 'true' || value === '1',
  number: value => Number(value),
  string: value => value,
};

function inferArgValue(value: string | boolean): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.includes(',')) return value.split(',').map(s => s.trim());
  return value;
}

export function buildToolArgs(
  parsed: ParsedArgs,
  meta: ToolMeta,
): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(parsed.flags)) {
    if (typeof value === 'boolean') {
      toolArgs[key] = value;
      continue;
    }

    const schemaType = meta.schema[key];
    const coerce = schemaCoercers[schemaType];
    toolArgs[key] = coerce ? coerce(value) : inferArgValue(value);
  }

  return toolArgs;
}
