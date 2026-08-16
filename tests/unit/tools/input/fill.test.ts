/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {fill} from '../../../../src/tools/input/fill.js';
import {fillElement} from '../../../../src/tools/input/fillElement.js';
import {fillForm} from '../../../../src/tools/input/fillForm.js';

function captureResponse() {
  let content: Record<string, unknown> | undefined;
  return {
    response: {
      setStructuredContent(value: Record<string, unknown>) {
        content = value;
      },
    },
    get content() {
      return content;
    },
  };
}

describe('input fill tools', () => {
  it('fills through the selected frame with a bounded action', async () => {
    const calls: Array<{kind: string; value?: unknown}> = [];
    const element = {
      fill: async (value: string, options: {timeout: number}) => {
        calls.push({kind: 'fill', value: {value, options}});
      },
    };
    const frame = {
      $: async (selector: string) => {
        calls.push({kind: 'query', value: selector});
        return element;
      },
      evaluate: async (_fn: unknown, selector: string) => {
        calls.push({kind: 'evaluate', value: selector});
        return false;
      },
      page: () => {
        throw new Error('page() must not be used');
      },
    };

    const result = await fillElement(frame as never, '#name', 'alice', 20);

    assert.deepEqual(result, {found: true, isSelect: false});
    assert.deepEqual(calls, [
      {kind: 'query', value: '#name'},
      {kind: 'evaluate', value: '#name'},
      {
        kind: 'fill',
        value: {value: 'alice', options: {timeout: 20}},
      },
    ]);
  });

  it('rejects a debugger-stalled frame query at its deadline', async () => {
    const frame = {
      $: async () => await new Promise<never>(() => undefined),
    };

    await assert.rejects(
      fillElement(frame as never, '#name', 'alice', 10),
      /查找表单元素 超时 \(10ms\)/,
    );
  });

  it('fill preserves its structured response without using page()', async () => {
    let fillOptions: {timeout: number} | undefined;
    const element = {
      fill: async (_value: string, options: {timeout: number}) => {
        fillOptions = options;
      },
    };
    const frame = {
      $: async () => element,
      evaluate: async () => false,
      page: () => {
        throw new Error('page() must not be used');
      },
    };
    const output = captureResponse();

    await fill.handler(
      {params: {selector: '#name', value: 'alice', timeoutMs: 23}} as never,
      output.response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.deepEqual(output.content, {
      success: true,
      message: 'Successfully filled value into element: #name',
      tooltype: 'fill',
      data: {selector: '#name', value: 'alice', isSelect: false},
    });
    assert.deepEqual(fillOptions, {timeout: 23});
  });

  it('fill resumes an existing debugger-statement trap before querying', async () => {
    const calls: string[] = [];
    const frame = {
      $: async () => {
        calls.push('query');
        return null;
      },
    };
    const output = captureResponse();

    await fill.handler(
      {params: {selector: '#name', value: 'alice'}} as never,
      output.response as never,
      {
        getSelectedFrame: () => frame,
        getExistingDebuggerContext: () => ({
          getPausedState: () => ({reason: 'debugCommand'}),
          getClient: () => ({
            send: async (method: string, params: Record<string, unknown>) => {
              calls.push(`${method}:${JSON.stringify(params)}`);
            },
          }),
          resume: async () => {
            calls.push('resume');
          },
        }),
      } as never,
    );

    assert.deepEqual(calls, [
      'Debugger.setSkipAllPauses:{"skip":true}',
      'resume',
      'query',
      'Debugger.setSkipAllPauses:{"skip":false}',
    ]);
  });

  it('fill_form counts selected-frame fills and skips missing elements', async () => {
    const selected: Array<{value: string; timeout: number}> = [];
    const frame = {
      $: async (selector: string) =>
        selector === '#missing'
          ? null
          : {
              selectOption: async (value: string, options: {timeout: number}) =>
                selected.push({value, timeout: options.timeout}),
            },
      evaluate: async () => true,
      page: () => {
        throw new Error('page() must not be used');
      },
    };
    const output = captureResponse();
    const elements = [
      {selector: '#country', value: 'SG'},
      {selector: '#missing', value: 'ignored'},
    ];

    await fillForm.handler(
      {params: {elements, timeoutMs: 31}} as never,
      output.response as never,
      {getSelectedFrame: () => frame} as never,
    );

    assert.deepEqual(selected, [{value: 'SG', timeout: 31}]);
    assert.deepEqual(output.content, {
      success: true,
      message: 'Successfully filled out 1/2 form elements',
      tooltype: 'fill_form',
      data: {filled: 1, total: 2, elements},
    });
  });
});
