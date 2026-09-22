/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  extractCallsFromMarkdown,
  validateMarkdownContent,
  type ParamSchemaInfo,
  type ToolDefinitionsMap,
} from '../../../scripts/verify-skills-schema.js';

function createMockToolDefinitions(): ToolDefinitionsMap {
  const map: ToolDefinitionsMap = new Map();

  // 1. click: requires selector (string), optional dblClick (boolean), optional timeoutMs (number)
  const clickParams = new Map<string, ParamSchemaInfo>([
    [
      'selector',
      {
        name: 'selector',
        type: 'string',
        required: true,
        hasDefault: false,
        description: 'CSS selector',
      },
    ],
    [
      'dblClick',
      {
        name: 'dblClick',
        type: 'boolean',
        required: false,
        hasDefault: false,
        description: 'Double click',
      },
    ],
    [
      'timeoutMs',
      {
        name: 'timeoutMs',
        type: 'number',
        required: false,
        hasDefault: false,
        description: 'Timeout in ms',
      },
    ],
  ]);
  map.set('click', {
    name: 'click',
    parameters: clickParams,
    requiredParams: new Set(['selector']),
  });

  // 2. create_hook: requires type (string), optional action (enum), optional params (json/object), optional hookId (string)
  const createHookParams = new Map<string, ParamSchemaInfo>([
    [
      'type',
      {
        name: 'type',
        type: 'string',
        required: true,
        hasDefault: false,
        description: 'Hook type',
      },
    ],
    [
      'action',
      {
        name: 'action',
        type: 'string',
        required: false,
        hasDefault: true,
        defaultValue: 'log',
        enumValues: ['log', 'block', 'modify', 'passthrough'],
        description: 'Hook action',
      },
    ],
    [
      'params',
      {
        name: 'params',
        type: 'json',
        required: false,
        hasDefault: false,
        description: 'Parameters',
      },
    ],
    [
      'capture',
      {
        name: 'capture',
        type: 'object',
        required: false,
        hasDefault: false,
        description: 'Capture options',
      },
    ],
    [
      'hookId',
      {
        name: 'hookId',
        type: 'string',
        required: false,
        hasDefault: false,
        description: 'Hook identifier',
      },
    ],
  ]);
  map.set('create_hook', {
    name: 'create_hook',
    parameters: createHookParams,
    requiredParams: new Set(['type']),
  });

  // 3. navigate_page: all params optional/have defaults
  const navigateParams = new Map<string, ParamSchemaInfo>([
    [
      'url',
      {
        name: 'url',
        type: 'string',
        required: false,
        hasDefault: false,
        description: 'URL',
      },
    ],
    [
      'type',
      {
        name: 'type',
        type: 'string',
        required: false,
        hasDefault: true,
        defaultValue: 'url',
        enumValues: ['url', 'back', 'forward', 'reload'],
        description: 'Navigation type',
      },
    ],
    [
      'ignoreCache',
      {
        name: 'ignoreCache',
        type: 'boolean',
        required: false,
        hasDefault: true,
        defaultValue: false,
        description: 'Ignore cache',
      },
    ],
    [
      'timeout',
      {
        name: 'timeout',
        type: 'number',
        required: false,
        hasDefault: false,
        description: 'Timeout in ms',
      },
    ],
  ]);
  map.set('navigate_page', {
    name: 'navigate_page',
    parameters: navigateParams,
    requiredParams: new Set([]),
  });

  // 4. list_pages: no parameters
  map.set('list_pages', {
    name: 'list_pages',
    parameters: new Map(),
    requiredParams: new Set([]),
  });

  return map;
}

describe('verify-skills-schema', () => {
  const toolDefs = createMockToolDefinitions();

  describe('extractCallsFromMarkdown', () => {
    it('extracts single-line executable call with arguments', () => {
      const md = 'Run `browsercli call click --selector "#btn"` to click.';
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.toolName, 'click');
      assert.strictEqual(calls[0]!.isSynopsis, false);
      assert.strictEqual(calls[0]!.args.length, 1);
      assert.strictEqual(calls[0]!.args[0]!.name, 'selector');
      assert.strictEqual(calls[0]!.args[0]!.rawValue, '"#btn"');
    });

    it('extracts multiline call with line continuation backslashes', () => {
      const md = `\`\`\`bash
browsercli call create_hook --type fetch \\
  --action log \\
  --hookId fetch_hook
\`\`\``;
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.toolName, 'create_hook');
      assert.strictEqual(calls[0]!.args.length, 3);
      assert.deepStrictEqual(
        calls[0]!.args.map(a => a.name),
        ['type', 'action', 'hookId'],
      );
    });

    it('detects bracketed synopsis signatures', () => {
      const md =
        'browsercli call navigate_page [--type <str>] [--url <str>] [--ignoreCache <bool>]';
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.toolName, 'navigate_page');
      assert.strictEqual(calls[0]!.isSynopsis, true);
      assert.strictEqual(calls[0]!.args.length, 3);
      assert.strictEqual(calls[0]!.args[0]!.isBracketed, true);
    });

    it('strips shell comments from arguments', () => {
      const md = 'browsercli call list_pages # list all pages';
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.toolName, 'list_pages');
      assert.strictEqual(calls[0]!.args.length, 0);
    });

    it('parses --data JSON payload', () => {
      const md =
        'browsercli call click --data \'{"selector":"#submit","timeoutMs":3000}\'';
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0]!.dataPayload);
      assert.deepStrictEqual(calls[0]!.dataPayload, {
        selector: '#submit',
        timeoutMs: 3000,
      });
    });

    it('records dataPayloadError on invalid JSON in --data', () => {
      const md = 'browsercli call click --data \'{"selector": invalid}\'';
      const calls = extractCallsFromMarkdown('test.md', md);
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0]!.dataPayloadError);
    });
  });

  describe('validateCall & validateMarkdownContent', () => {
    it('strictly rejects unknown tool', () => {
      const md = 'browsercli call nonexistent_tool --foo bar';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'unknown_tool');
      assert.ok(errors[0]!.message.includes('nonexistent_tool'));
    });

    it('ignores generic placeholder template <tool-name>', () => {
      const md =
        'browsercli call <tool-name> [--param value] [--data \'{"k":"v"}\']';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 0);
    });

    it('strictly rejects unknown parameters', () => {
      const md = 'browsercli call click --selector "#btn" --invalidParam 123';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'unknown_param');
      assert.ok(errors[0]!.message.includes('--invalidParam'));
    });

    it('disallows kebab-case and alias argument names', () => {
      const md = 'browsercli call click --selector "#btn" --timeout-ms 5000';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'unknown_param');
      assert.ok(errors[0]!.message.includes('--timeout-ms'));
    });

    it('strictly rejects missing required parameters on executable examples', () => {
      const md = 'browsercli call click --timeoutMs 5000';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'missing_required_param');
      assert.ok(errors[0]!.message.includes('--selector'));
    });

    it('does not require all mandatory arguments on bracketed synopsis', () => {
      const md =
        'browsercli call click [--selector <str>] [--dblClick <bool>] [--timeoutMs <num>]';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 0);
    });

    it('strictly rejects invalid enum values', () => {
      const md =
        'browsercli call create_hook --type cookie --action invalidAction';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'invalid_enum');
      assert.ok(errors[0]!.message.includes('invalidAction'));
    });

    it('accepts valid enum values', () => {
      const md = 'browsercli call create_hook --type cookie --action log';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 0);
    });

    it('strictly rejects malformed JSON in arguments', () => {
      const md =
        'browsercli call create_hook --type cookie --capture \'{"args": true, broken}\'';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'malformed_json');
      assert.ok(errors[0]!.message.includes('--capture'));
    });

    it('strictly rejects malformed JSON in --data', () => {
      const md = 'browsercli call click --data \'{"selector": broken\'';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.ok(errors.some(e => e.type === 'malformed_json'));
    });

    it('accepts valid global CLI flags (--data, --file, --stdin, --session, --json, --help)', () => {
      const md =
        'browsercli call click --selector "#btn" --session s123 --json --file config.json';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 0);
    });

    it('satisfies required arguments via --data object', () => {
      const md =
        'browsercli call click --data \'{"selector":"#btn"}\' --session s123';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 0);
    });

    it('validates enum values inside --data object', () => {
      const md =
        'browsercli call create_hook --data \'{"type":"cookie","action":"badAction"}\'';
      const errors = validateMarkdownContent('test.md', md, toolDefs);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0]!.type, 'invalid_enum');
    });
  });
});
