/**
 * @license
 * Copyright 2026 JSReverser-MCP
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {ToolPrerequisiteChecker} from '../../../../src/tools/prerequisites/ToolPrerequisiteChecker.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {PageHealthTracker} from '../../../../src/worker/context/PageHealthTracker.js';

describe('ToolPrerequisiteChecker', () => {
  it('throws BROWSER_REQUIRED when browser is connected requirement fails', () => {
    const checker = new ToolPrerequisiteChecker({
      isBrowserConnected: () => false,
      getBrowserContext: () => null,
      getSelectedPage: () => null,
    });

    assert.throws(
      () => checker.check('click', {browser: 'connected'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.BROWSER_REQUIRED);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it('passes when browser: connected and browser is available', () => {
    const checker = new ToolPrerequisiteChecker({
      isBrowserConnected: () => true,
      getBrowserContext: () => ({}),
      getSelectedPage: () => null,
    });

    assert.doesNotThrow(() => checker.check('click', {browser: 'connected'}));
  });

  it('throws PAGE_REQUIRED when page: selected and no page is selected', () => {
    const checker = new ToolPrerequisiteChecker({
      isBrowserConnected: () => true,
      getSelectedPage: () => null,
    });

    assert.throws(
      () => checker.check('click', {page: 'selected'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.PAGE_REQUIRED);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it('passes when page: selected and page exists', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
    });

    assert.doesNotThrow(() => checker.check('click', {page: 'selected'}));
  });

  it('throws FRAME_REQUIRED when frame: selected and no frame is selected', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getSelectedFrame: () => null,
    });

    assert.throws(
      () => checker.check('click', {frame: 'selected'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.FRAME_REQUIRED);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });

  it('passes when frame: selected and frame exists', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getSelectedFrame: () => ({}),
    });

    assert.doesNotThrow(() => checker.check('click', {frame: 'selected'}));
  });

  it('throws DEBUGGER_PAUSED when debugger: running and page is paused', () => {
    let eagerCalls = 0;
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => true,
          getPausedState: () => ({callFrames: []}),
        }) as never,
      getDebuggerContext: async () => {
        eagerCalls++;
        throw new Error('must not be called');
      },
    });

    assert.throws(
      () => checker.check('click', {debugger: 'running'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.DEBUGGER_PAUSED);
        assert.equal(error.retryable, true);
        assert.deepEqual(error.recovery, {
          tool: 'resume',
          command: 'proxycli call resume',
          reason: 'Resume execution or evaluate the current call frame.',
        });
        return true;
      },
    );
    assert.equal(eagerCalls, 0);
  });

  it('passes when debugger: running and page is running', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => false,
          getPausedState: () => null,
        }) as never,
    });

    assert.doesNotThrow(() => checker.check('click', {debugger: 'running'}));
  });

  it('passes when debugger: running and debugger was never attached', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () => undefined,
    });

    assert.doesNotThrow(() => checker.check('click', {debugger: 'running'}));
  });

  it('throws DEBUGGER_NOT_PAUSED when debugger: paused and page is running', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => false,
          getPausedState: () => null,
        }) as never,
    });

    assert.throws(
      () => checker.check('evaluate_on_callframe', {debugger: 'paused'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.DEBUGGER_NOT_PAUSED);
        assert.equal(error.retryable, false);
        assert.deepEqual(error.recovery, {
          tool: 'pause',
          command: 'proxycli call pause',
          reason: 'Pause page execution before inspecting call frames.',
        });
        return true;
      },
    );
  });

  it('passes when debugger: paused and page is paused', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => true,
          getPausedState: () => ({callFrames: []}),
        }) as never,
    });

    assert.doesNotThrow(() =>
      checker.check('evaluate_on_callframe', {debugger: 'paused'}),
    );
  });

  it('passes when debugger: available regardless of running or paused state', () => {
    const checkerRunning = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => false,
          getPausedState: () => null,
        }) as never,
    });
    assert.doesNotThrow(() =>
      checkerRunning.check('list_scripts', {debugger: 'available'}),
    );

    const checkerPaused = new ToolPrerequisiteChecker({
      getSelectedPage: () => ({url: () => 'https://example.test'}),
      getExistingDebuggerContext: () =>
        ({
          isPaused: () => true,
          getPausedState: () => ({callFrames: []}),
        }) as never,
    });
    assert.doesNotThrow(() =>
      checkerPaused.check('list_scripts', {debugger: 'available'}),
    );
  });

  it('throws PAGE_UNRESPONSIVE when page is marked unresponsive and recovery is not true', () => {
    const healthTracker = new PageHealthTracker();
    healthTracker.markUnresponsive('dead-page-1', 'deadlock');

    const checker = new ToolPrerequisiteChecker(
      {
        getSelectedPage: () => ({}),
        getPageId: () => 'dead-page-1',
      },
      healthTracker,
    );

    assert.throws(
      () => checker.check('collect_code', {page: 'selected'}),
      (error: unknown) => {
        assert.ok(error instanceof ToolError);
        assert.equal(error.code, ErrorCodes.PAGE_UNRESPONSIVE);
        assert.equal(error.retryable, true);
        assert.ok(error.message.includes('卡死状态'));
        return true;
      },
    );
  });

  it('allows execution on unresponsive page when recovery: true', () => {
    const healthTracker = new PageHealthTracker();
    healthTracker.markUnresponsive('dead-page-2', 'deadlock');

    const checker = new ToolPrerequisiteChecker(
      {
        getSelectedPage: () => ({}),
        getPageId: () => 'dead-page-2',
      },
      healthTracker,
    );

    assert.doesNotThrow(() =>
      checker.check('check_browser_health', {
        page: 'selected',
        recovery: true,
      }),
    );
  });

  it('handles legacy prerequisites array requiresPage', () => {
    const checker = new ToolPrerequisiteChecker({
      getSelectedPage: () => null,
    });

    assert.throws(
      () =>
        checker.check('injectHook', [
          {
            condition: 'requiresPage',
            fix: 'Start or attach a browser page first.',
          },
        ]),
      (error: unknown) =>
        error instanceof ToolError &&
        error.code === ErrorCodes.PREREQUISITE &&
        error.context?.fix === 'Start or attach a browser page first.',
    );
  });
});
