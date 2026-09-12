/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {withDebuggerTrapBypass} from '../../../../src/tools/shared/browserRuntime.js';

function debuggerContext(
  reason: string,
  calls: string[],
  hitBreakpoints: string[] = [],
) {
  return {
    getExistingDebuggerContext: () => ({
      getPausedState: () => ({reason, hitBreakpoints}),
      getClient: () => ({
        send: async (method: string, params?: Record<string, unknown>) => {
          calls.push(`${method}:${JSON.stringify(params)}`);
        },
      }),
      resume: async () => {
        calls.push('resume');
      },
    }),
  };
}

describe('withDebuggerTrapBypass', () => {
  it('temporarily skips a debugger-statement pause around an operation', async () => {
    const calls: string[] = [];

    await withDebuggerTrapBypass(
      debuggerContext('debugCommand', calls),
      async () => {
        calls.push('action');
      },
    );

    assert.deepEqual(calls, [
      'Debugger.setSkipAllPauses:{"skip":true}',
      'resume',
      'action',
      'Debugger.setSkipAllPauses:{"skip":false}',
    ]);
  });

  it('leaves ordinary breakpoint pauses untouched', async () => {
    const calls: string[] = [];

    await withDebuggerTrapBypass(
      debuggerContext('other', calls, ['bp:1']),
      async () => {
        calls.push('action');
      },
    );

    assert.deepEqual(calls, ['action']);
  });

  it('skips an eval-ed debugger statement reported as reason other', async () => {
    // Chrome 对 eval 里的 debugger 语句报 'other' 且不带命中断点, 与真断点命中区分开
    const calls: string[] = [];

    await withDebuggerTrapBypass(debuggerContext('other', calls), async () => {
      calls.push('action');
    });

    assert.deepEqual(calls, [
      'Debugger.setSkipAllPauses:{"skip":true}',
      'resume',
      'action',
      'Debugger.setSkipAllPauses:{"skip":false}',
    ]);
  });

  it('restores pauses when the guarded operation fails', async () => {
    const calls: string[] = [];

    await assert.rejects(
      withDebuggerTrapBypass(
        debuggerContext('debugCommand', calls),
        async () => {
          calls.push('action');
          throw new Error('fill failed');
        },
      ),
      /fill failed/,
    );

    assert.deepEqual(calls, [
      'Debugger.setSkipAllPauses:{"skip":true}',
      'resume',
      'action',
      'Debugger.setSkipAllPauses:{"skip":false}',
    ]);
  });

  it('bounds a debugger bypass command that never settles', async () => {
    let sentinel: ReturnType<typeof setTimeout> | undefined;
    const context = {
      getExistingDebuggerContext: () => ({
        getPausedState: () => ({reason: 'debugCommand'}),
        getClient: () => ({
          send: async () => await new Promise<never>(() => undefined),
        }),
        resume: async () => undefined,
      }),
    };

    try {
      await assert.rejects(
        Promise.race([
          withDebuggerTrapBypass(context, async () => undefined, 10),
          new Promise<never>((_, reject) => {
            sentinel = setTimeout(
              () =>
                reject(new Error('debugger bypass command was not bounded')),
              50,
            );
          }),
        ]),
        /启用调试器陷阱绕过 超时 \(10ms\)/,
      );
    } finally {
      if (sentinel) clearTimeout(sentinel);
    }
  });

  it('does not hang when restoring debugger pauses never settles', async () => {
    let sends = 0;
    let sentinel: ReturnType<typeof setTimeout> | undefined;
    const context = {
      getExistingDebuggerContext: () => ({
        getPausedState: () => ({reason: 'debugCommand'}),
        getClient: () => ({
          send: async () => {
            sends += 1;
            if (sends === 2) await new Promise<never>(() => undefined);
          },
        }),
        resume: async () => undefined,
      }),
    };

    try {
      const result = await Promise.race([
        withDebuggerTrapBypass(context, async () => 'done', 10),
        new Promise<string>((_, reject) => {
          sentinel = setTimeout(
            () => reject(new Error('debugger pause restore was not bounded')),
            50,
          );
        }),
      ]);
      assert.strictEqual(result, 'done');
    } finally {
      if (sentinel) clearTimeout(sentinel);
    }
  });
});
