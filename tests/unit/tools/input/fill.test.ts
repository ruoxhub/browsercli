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
import {ToolError} from '../../../../src/utils/errors.js';

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
    const loc = {
      count: async () => {
        calls.push({kind: 'count', value: '#name'});
        return 1;
      },
      first: () => ({
        evaluate: async (_fn: unknown) => {
          calls.push({kind: 'evaluate', value: '#name'});
          return false;
        },
      }),
      fill: async (value: string, options: {timeout: number}) => {
        calls.push({kind: 'fill', value: {value, options}});
      },
      selectOption: async (value: string, options: {timeout: number}) => {
        calls.push({kind: 'selectOption', value: {value, options}});
      },
    };
    const frame = {
      locator: (selector: string) => {
        calls.push({kind: 'locator', value: selector});
        return loc;
      },
      page: () => {
        throw new Error('page() must not be used');
      },
    };

    const result = await fillElement(frame as never, '#name', 'alice', 20);

    assert.deepEqual(result, {found: true, isSelect: false});
    assert.deepEqual(calls, [
      {kind: 'locator', value: '#name'},
      {kind: 'count', value: '#name'},
      {kind: 'evaluate', value: '#name'},
      {
        kind: 'fill',
        value: {value: 'alice', options: {timeout: 20}},
      },
    ]);
  });

  it('rejects a debugger-stalled frame query at its deadline', async () => {
    const frame = {
      locator: () => ({
        count: async () => await new Promise<never>(() => undefined),
      }),
    };

    await assert.rejects(
      fillElement(frame as never, '#name', 'alice', 10),
      /查找表单元素 超时 \(10ms\)/,
    );
  });

  it('fill preserves its structured response without using page()', async () => {
    let fillOptions: {timeout: number} | undefined;
    const loc = {
      count: async () => 1,
      first: () => ({evaluate: async () => false}),
      fill: async (_value: string, options: {timeout: number}) => {
        fillOptions = options;
      },
    };
    const frame = {
      locator: () => loc,
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
    const loc = {
      count: async () => {
        calls.push('count');
        return 0;
      },
    };
    const frame = {
      locator: () => {
        calls.push('locator');
        return loc;
      },
    };
    const output = captureResponse();

    await assert.rejects(
      () =>
        fill.handler(
          {params: {selector: '#name', value: 'alice'}} as never,
          output.response as never,
          {
            getSelectedFrame: () => frame,
            getExistingDebuggerContext: () => ({
              getPausedState: () => ({reason: 'debugCommand'}),
              getClient: () => ({
                send: async (
                  method: string,
                  params: Record<string, unknown>,
                ) => {
                  calls.push(`${method}:${JSON.stringify(params)}`);
                },
              }),
              resume: async () => {
                calls.push('resume');
              },
            }),
          } as never,
        ),
      (error: unknown) =>
        error instanceof ToolError && error.code === 'NOT_FOUND',
    );

    assert.deepEqual(calls, [
      'Debugger.setSkipAllPauses:{"skip":true}',
      'resume',
      'locator',
      'count',
      'Debugger.setSkipAllPauses:{"skip":false}',
    ]);
  });

  it('fill_form counts selected-frame fills and skips missing elements', async () => {
    const selected: Array<{value: string; timeout: number}> = [];
    const frame = {
      locator: (selector: string) =>
        selector === '#missing'
          ? {
              count: async () => 0,
            }
          : {
              count: async () => 1,
              first: () => ({evaluate: async () => true}),
              selectOption: async (value: string, options: {timeout: number}) =>
                selected.push({value, timeout: options.timeout}),
            },
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
