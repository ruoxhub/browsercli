/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {afterEach, describe, it} from 'node:test';

import {DetailedDataManager} from '../../../src/utils/detailedDataManager.js';
import {
  ToolResponseAccumulator,
  ToolResponseProcessor,
} from '../../../src/worker/ToolResponse.js';

describe('ToolResponseProcessor', () => {
  afterEach(() => {
    DetailedDataManager.destroy();
  });

  describe('ToolResponseAccumulator', () => {
    it('accumulates lines and formats JSON', () => {
      const accumulator = new ToolResponseAccumulator();
      accumulator.appendResponseLine('Line 1');
      accumulator.appendResponseLine('Line 2');
      const json = accumulator.toJSON();
      assert.strictEqual(json.text, 'Line 1\nLine 2');
    });

    it('parses fenced json if structuredContent is empty', () => {
      const accumulator = new ToolResponseAccumulator();
      accumulator.appendResponseLine('```json\n{"foo":"bar"}\n```');
      const json = accumulator.toJSON();
      assert.deepStrictEqual(json.structuredContent, {foo: 'bar'});
    });
  });

  describe('Processor normalization', () => {
    it('passes standard ToolDefinitionResponse unchanged', () => {
      const processor = new ToolResponseProcessor();
      const standardResponse = {text: 'standard response'};
      assert.strictEqual(
        processor.normalize(standardResponse),
        standardResponse,
      );

      const structuredResponse = {structuredContent: {foo: 'bar'}};
      assert.strictEqual(
        processor.normalize(structuredResponse),
        structuredResponse,
      );
    });

    it('normalizes string response to text json', () => {
      const processor = new ToolResponseProcessor();
      const res = processor.normalize('hello') as {text: string};
      assert.strictEqual(res.text, 'hello');
    });

    it('normalizes object response to structuredContent json', () => {
      const processor = new ToolResponseProcessor();
      const obj = {x: 1};
      const res = processor.normalize(obj) as {structuredContent: unknown};
      assert.deepStrictEqual(res.structuredContent, obj);
    });
  });

  describe('Processor offload processing', () => {
    it('returns small response unchanged', () => {
      const response = {ok: true};
      const processor = new ToolResponseProcessor(
        DetailedDataManager.getInstance(),
        1024,
      );

      assert.strictEqual(processor.process(response), response);
    });

    it('returns detailed-data summary for large response', () => {
      const response = {payload: 'x'.repeat(128)};
      const processor = new ToolResponseProcessor(
        DetailedDataManager.getInstance(),
        16,
      );

      const result = processor.process(response) as Record<string, unknown>;

      assert.ok(result && typeof result === 'object');
      assert.ok('detailId' in result);
      assert.ok('summary' in result);
      assert.ok('hint' in result);
    });
  });
});
