/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {ToolMeta} from '../../../../src/cli/tools-meta.js';
import {toolMetaToJsonSchema} from '../../../../src/web/adapters/ZodToJsonSchema.js';

function meta(argSpecs: ToolMeta['argSpecs']): ToolMeta {
  return {
    name: 'fixture_tool',
    description: '',
    schema: {},
    argSpecs,
    modulePath: './fixture.js',
    handlerName: 'fixture',
    callMode: 'defineTool',
    domain: 'fixture',
    profile: 'workflow',
  } as ToolMeta;
}

describe('toolMetaToJsonSchema', () => {
  it('converts string with description and required', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        url: {
          type: 'string',
          required: true,
          description: 'Page URL',
        },
      }),
    );
    assert.deepStrictEqual(schema, {
      type: 'object',
      properties: {
        url: {type: 'string', description: 'Page URL'},
      },
      required: ['url'],
      additionalProperties: false,
    });
  });

  it('converts number with default and optional', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        timeout: {
          type: 'number',
          required: false,
          defaultValue: 5000,
          description: '',
        },
      }),
    );
    assert.deepStrictEqual(schema.properties.timeout, {
      type: 'number',
      description: undefined,
      default: 5000,
    });
    assert.deepStrictEqual(schema.required, []);
  });

  it('converts boolean property', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        verbose: {type: 'boolean', required: false, description: 'Print logs'},
      }),
    );
    assert.deepStrictEqual(schema.properties.verbose, {
      type: 'boolean',
      description: 'Print logs',
    });
  });

  it('converts string[] to array with string items', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        tags: {type: 'string[]', required: true, description: 'Filter tags'},
      }),
    );
    assert.deepStrictEqual(schema.properties.tags, {
      type: 'array',
      description: 'Filter tags',
      items: {type: 'string'},
    });
  });

  it('passes enum values through for string with enum', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        mode: {
          type: 'string',
          required: true,
          enum: ['fast', 'thorough'],
          description: 'Search mode',
        },
      }),
    );
    assert.deepStrictEqual(schema.properties.mode, {
      type: 'string',
      description: 'Search mode',
      enum: ['fast', 'thorough'],
    });
  });

  it('converts object type to JSON Schema object (no properties)', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        config: {type: 'object', required: false, description: 'Free-form'},
      }),
    );
    assert.deepStrictEqual(schema.properties.config, {
      type: 'object',
      description: 'Free-form',
    });
  });

  it('returns empty schema body for tool with no args', () => {
    const schema = toolMetaToJsonSchema(meta({}));
    assert.deepStrictEqual(schema, {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it('combines multiple props with mixed required state', () => {
    const schema = toolMetaToJsonSchema(
      meta({
        url: {type: 'string', required: true, description: ''},
        timeout: {
          type: 'number',
          required: false,
          defaultValue: 1000,
          description: '',
        },
        verbose: {type: 'boolean', required: false, description: ''},
      }),
    );
    assert.deepStrictEqual(schema.required, ['url']);
    assert.strictEqual(Object.keys(schema.properties).length, 3);
    assert.strictEqual(schema.additionalProperties, false);
  });
});
