/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool parameter type coercion and validation utilities.
 *
 * Provides runtime type coercion for params arriving from MCP/CLI
 * where boolean flags may be passed as strings, and string enums
 * may arrive as booleans due to CLI parser ambiguity.
 *
 * Usage in tool handler:
 *   const params = coerceParams(request.params, schema);
 */

import {zod} from '../../third_party/index.js';

type ZodRawShape = zod.ZodRawShape;

/**
 * Coerce raw params to match the expected Zod schema types.
 *
 * This is NOT a full Zod parse — it only fixes common type mismatches
 * from CLI/MCP serialization (e.g. boolean ↔ string, string → number)
 * before the params reach the handler. The tool handler still gets
 * JavaScript-native types.
 */
export function coerceParams<T extends ZodRawShape>(
  raw: Record<string, unknown>,
  schema: T,
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {...raw};

  for (const [key, field] of Object.entries(schema)) {
    if (!(key in coerced) || coerced[key] === undefined) continue;

    const actual = coerced[key];
    const expectedType = inferZodType(field);

    if (expectedType === 'enum' && typeof actual === 'boolean') {
      // --smartMode true from CLI becomes boolean; enum expects string
      delete coerced[key];
    } else if (expectedType === 'boolean' && typeof actual === 'string') {
      // --flag false from CLI becomes string "false"
      coerced[key] = actual === 'true' || actual === '1';
    } else if (expectedType === 'number' && typeof actual === 'string') {
      const n = Number(actual);
      if (!Number.isNaN(n)) coerced[key] = n;
    } else if (expectedType === 'string[]' && typeof actual === 'string') {
      coerced[key] = actual.split(',').map(s => s.trim());
    }
  }

  return coerced;
}

type ExpectedType = 'string' | 'number' | 'boolean' | 'string[]' | 'object' | 'enum' | 'unknown';

function inferZodType(schema: zod.ZodTypeAny): ExpectedType {
  let current = schema;
  if (current instanceof zod.ZodOptional) current = current.unwrap();
  if (current instanceof zod.ZodDefault) current = current.removeDefault();
  if (current instanceof zod.ZodEffects) current = current.innerType();

  if (current instanceof zod.ZodString) return 'string';
  if (current instanceof zod.ZodNumber) return 'number';
  if (current instanceof zod.ZodBoolean) return 'boolean';
  if (current instanceof zod.ZodEnum) return 'enum';
  if (current instanceof zod.ZodNativeEnum) return 'enum';
  if (current instanceof zod.ZodArray) return 'string[]';
  if (current instanceof zod.ZodObject || current instanceof zod.ZodRecord) return 'object';
  return 'unknown';
}
