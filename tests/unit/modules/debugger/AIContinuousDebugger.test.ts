import assert from 'node:assert';
import {describe, it} from 'node:test';

import {extractJsonFromResponse} from '../../../../src/modules/debugger/AIContinuousDebugger.js';

describe('AIContinuousDebugger utilities', () => {
  it('extractJsonFromResponse handles plain JSON', () => {
    const input = '{"action":"step_over","reason":"test","confidence":0.9}';
    const result = extractJsonFromResponse(input);
    assert.strictEqual(result, input);
  });

  it('extractJsonFromResponse extracts from markdown code block', () => {
    const input = '```json\n{"action":"step_into","reason":"deep","confidence":0.8}\n```';
    const result = extractJsonFromResponse(input);
    assert.strictEqual(result, '{"action":"step_into","reason":"deep","confidence":0.8}');
  });

  it('extractJsonFromResponse extracts from untagged code block', () => {
    const input = '```\n{"action":"resume","reason":"done","confidence":1}\n```';
    const result = extractJsonFromResponse(input);
    assert.strictEqual(result, '{"action":"resume","reason":"done","confidence":1}');
  });

  it('extractJsonFromResponse trims whitespace', () => {
    const input = '  {"action":"stop","reason":"ok","confidence":0.5}  ';
    const result = extractJsonFromResponse(input);
    assert.strictEqual(result, '{"action":"stop","reason":"ok","confidence":0.5}');
  });
});
