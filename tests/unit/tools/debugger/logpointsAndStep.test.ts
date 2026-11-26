/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  formatLogpoints,
  LogpointManager,
  parseLogpoint,
  validateLogpointExpression,
} from '../../../../src/modules/debugger/LogpointManager.js';
import {
  debuggerDisable,
  debuggerStep,
  debuggerWaitForPaused,
} from '../../../../src/tools/debugger.js';
import {setLogpoints} from '../../../../src/tools/debugger.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('set_logpoints, debugger_step, debugger_wait_for_paused & debugger_disable', () => {
  it('parses valid logpoint specifications and rejects invalid expressions', () => {
    const parsed = parseLogpoint("app.js:42 'total:', cart.total");
    assert.equal(parsed.url, 'app.js');
    assert.equal(parsed.lineNumber, 42);
    assert.equal(parsed.columnNumber, undefined);
    assert.equal(parsed.expression, "'total:', cart.total");

    const parsedCol = parseLogpoint('bundle.js:10:5 user.id');
    assert.equal(parsedCol.lineNumber, 10);
    assert.equal(parsedCol.columnNumber, 5);

    assert.throws(() => parseLogpoint('missing-line'));
    assert.throws(() => validateLogpointExpression('unclosed('));
  });

  it('reconciles CDP non-pausing logpoints in LogpointManager', async () => {
    const bpCalls: Array<{
      action: 'set' | 'remove';
      params: Record<string, unknown>;
    }> = [];
    const fakeDebuggerManager = {
      getScripts: () => [{scriptId: 's1', url: 'https://example.com/app.js'}],
      setBreakpointByUrl: async (params: Record<string, unknown>) => {
        bpCalls.push({action: 'set', params});
        return {
          breakpointId: `bp-${bpCalls.length}`,
          location: {scriptId: 's1', lineNumber: 41, columnNumber: 0},
        };
      },
      removeBreakpoint: async (breakpointId: string) => {
        bpCalls.push({action: 'remove', params: {breakpointId}});
      },
    };
    const manager = new LogpointManager();

    const applied = await manager.setLogpoints(fakeDebuggerManager as never, [
      {url: 'app.js', lineNumber: 42, columnNumber: 1, expression: 'x'},
    ]);
    assert.equal(applied.length, 1);
    const setCall = bpCalls.find(c => c.action === 'set');
    assert.match(String(setCall?.params.condition), /console\.log\(x\)/);
    assert.match(String(setCall?.params.condition), /return false;/);

    const cleared = await manager.setLogpoints(
      fakeDebuggerManager as never,
      [],
    );
    assert.equal(cleared.length, 0);
    assert.ok(bpCalls.some(c => c.action === 'remove'));
  });

  it('set_logpoints delegates parsed entries and formats summary', async () => {
    const response = new ToolResponseAccumulator();
    await setLogpoints.handler(
      {params: {logpoints: ['main.js:10 token']}},
      response,
      {
        setLogpoints: async (desired: unknown[]) =>
          desired.map((d: any) => ({...d, active: true, locations: 1})),
      } as never,
    );
    const data = (
      response.toJSON().structuredContent as Record<string, unknown>
    ).data as Record<string, unknown>;
    assert.equal((data.logpoints as unknown[]).length, 1);
    assert.match(formatLogpoints(data.logpoints as never), /main\.js:10/);
  });

  it('debugger_step executes into/over/out and handles non-paused error', async () => {
    await assert.rejects(
      debuggerStep.handler(
        {
          params: {
            direction: 'over',
            includePausedInfo: true,
            includeScopes: true,
          },
        },
        new ToolResponseAccumulator(),
        {
          getDebuggerContext: async () => ({
            isPaused: () => false,
          }),
        } as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.DEBUGGER_NOT_PAUSED,
    );

    let steppedInto = false;
    const response = new ToolResponseAccumulator();
    await debuggerStep.handler(
      {
        params: {
          direction: 'into',
          includePausedInfo: false,
          includeScopes: false,
        },
      },
      response,
      {
        getDebuggerContext: async () => ({
          isPaused: () => true,
          stepInto: async () => {
            steppedInto = true;
          },
        }),
      } as never,
    );
    assert.equal(steppedInto, true);
    assert.equal(
      (
        (response.toJSON().structuredContent as Record<string, unknown>)
          .data as Record<string, unknown>
      ).direction,
      'into',
    );
  });

  it('debugger_wait_for_paused awaits pause and debugger_disable resumes+disables', async () => {
    let paused = false;
    let disabled = false;
    let resumed = false;

    const fakeDebugger = {
      isPaused: () => paused,
      waitForPaused: async () => {
        paused = true;
        return {
          reason: 'debugCommand',
          callFrames: [],
          hitBreakpoints: [],
        };
      },
      getPausedState: () =>
        paused
          ? {
              reason: 'debugCommand',
              callFrames: [],
              hitBreakpoints: [],
            }
          : null,
      resume: async () => {
        resumed = true;
        paused = false;
      },
      disable: async () => {
        disabled = true;
      },
    };

    const waitResponse = new ToolResponseAccumulator();
    await debuggerWaitForPaused.handler(
      {params: {timeout: 1000, includeScopes: false}},
      waitResponse,
      {getDebuggerContext: async () => fakeDebugger} as never,
    );
    assert.equal(
      (
        (waitResponse.toJSON().structuredContent as Record<string, unknown>)
          .data as Record<string, unknown>
      ).isPaused,
      true,
    );

    const disableResponse = new ToolResponseAccumulator();
    await debuggerDisable.handler({params: {}}, disableResponse, {
      getDebuggerContext: async () => fakeDebugger,
    } as never);
    assert.equal(resumed, true);
    assert.equal(disabled, true);
  });
});
