import assert from 'node:assert';
import {describe, it} from 'node:test';

import {dumpTargetScripts} from '../../../../src/tools/collector/dumpTargetScripts.js';
import {listTargets} from '../../../../src/tools/collector/listTargets.js';
import {ToolError} from '../../../../src/utils/errors.js';

function responseCapture(): {
  response: object;
  get(): Record<string, unknown>;
} {
  let value: Record<string, unknown> = {};
  return {
    response: {
      setStructuredContent: (next: Record<string, unknown>) => (value = next),
    },
    get: () => value,
  };
}

describe('target collector tools', () => {
  it('list_targets delegates once and returns targets', async () => {
    let calls = 0;
    const targets = [{targetId: 't1'}];
    const capture = responseCapture();
    await listTargets.handler(
      {params: {}},
      capture.response as never,
      {
        getBrowserTargetInspector: () => ({
          listTargets: async () => {
            calls++;
            return targets;
          },
        }),
      } as never,
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      (capture.get().data as {targets: unknown}).targets,
      targets,
    );
    assert.equal(listTargets.annotations.readOnlyHint, true);
  });

  it('dump_target_scripts passes targetId and returns the complete result', async () => {
    let received = '';
    const result = {
      target: {targetId: 't1'},
      scripts: [],
      failures: [],
      stats: {},
      partial: false,
      warnings: [],
    };
    const capture = responseCapture();
    await dumpTargetScripts.handler(
      {params: {targetId: 't1'}},
      capture.response as never,
      {
        getBrowserTargetInspector: () => ({
          dumpScripts: async (targetId: string) => {
            received = targetId;
            return result;
          },
        }),
      } as never,
    );
    assert.equal(received, 't1');
    assert.equal(capture.get().data, result);
    assert.equal(dumpTargetScripts.annotations.readOnlyHint, true);
  });

  it('preserves structured recoverable errors and rejects missing context', async () => {
    const errorCapture = responseCapture();
    await listTargets.handler(
      {params: {}},
      errorCapture.response as never,
      {
        getBrowserTargetInspector: () => ({
          listTargets: async () => {
            throw new ToolError(
              'NOT_FOUND',
              'gone；请重新调用 list_targets',
              {targetId: 'gone', recoveryHint: 'list_targets'},
              true,
            );
          },
        }),
      } as never,
    );
    const error = (errorCapture.get().data as {error: Record<string, unknown>})
      .error;
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.recoverable, true);
    assert.deepEqual(error.context, {
      targetId: 'gone',
      recoveryHint: 'list_targets',
    });

    const missingCapture = responseCapture();
    await listTargets.handler(
      {params: {}},
      missingCapture.response as never,
      {} as never,
    );
    assert.match(
      String(missingCapture.get().message),
      /BrowserTargetInspector/,
    );
  });
});
