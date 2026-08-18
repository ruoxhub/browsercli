/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {Frame, Page} from 'patchright';

import {
  terminateFrameExecution,
  wrapFrameWithTimeout,
} from '../../../src/worker/timeoutUtils.js';

describe('timeoutUtils', () => {
  it('resolves evaluate when action finishes before timeout', async () => {
    const rawFrame = {
      evaluate: async (fn: () => number) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return fn();
      },
    } as unknown as Frame;

    const wrapped = wrapFrameWithTimeout(rawFrame, 100);
    const result = await wrapped.evaluate(() => 42);
    assert.equal(result, 42);
  });

  it('rejects and triggers terminateFrameExecution when evaluate times out', async () => {
    const sentCommands: string[] = [];
    let detached = false;

    const mockSession = {
      send: async (method: string) => {
        sentCommands.push(method);
      },
      detach: async () => {
        detached = true;
      },
    };

    const mockPage = {
      isClosed: () => false,
      context: () => ({
        newCDPSession: async () => mockSession,
      }),
    } as unknown as Page;

    const rawFrame = {
      page: () => mockPage,
      evaluate: async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'never';
      },
    } as unknown as Frame;

    let timeoutCalled = false;
    const wrapped = wrapFrameWithTimeout(rawFrame, {
      timeoutMs: 30,
      autoTerminate: true,
      onTimeout: () => {
        timeoutCalled = true;
      },
    });

    await assert.rejects(
      wrapped.evaluate(() => null),
      /frame\.evaluate\(\) 超时/,
    );

    assert.equal(timeoutCalled, true);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(sentCommands.includes('Runtime.terminateExecution'));
    assert.ok(sentCommands.includes('Page.stopLoading'));
    assert.equal(detached, true);
  });

  it('skips terminate when autoTerminate is false', async () => {
    let sessionCreated = false;
    const mockPage = {
      isClosed: () => false,
      context: () => ({
        newCDPSession: async () => {
          sessionCreated = true;
          return {send: async () => undefined, detach: async () => undefined};
        },
      }),
    } as unknown as Page;

    const rawFrame = {
      page: () => mockPage,
      evaluate: async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'never';
      },
    } as unknown as Frame;

    const wrapped = wrapFrameWithTimeout(rawFrame, {
      timeoutMs: 20,
      autoTerminate: false,
    });

    await assert.rejects(
      wrapped.evaluate(() => null),
      /frame\.evaluate\(\) 超时/,
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sessionCreated, false);
  });

  it('handles closed page gracefully in terminateFrameExecution', async () => {
    const closedPage = {
      isClosed: () => true,
    } as unknown as Page;
    const rawFrame = {
      page: () => closedPage,
    } as unknown as Frame;

    await terminateFrameExecution(rawFrame);
  });

  it('preserves non-evaluate frame methods', async () => {
    const rawFrame = {
      url: () => 'https://example.com',
      evaluate: async () => 1,
    } as unknown as Frame;

    const wrapped = wrapFrameWithTimeout(rawFrame);
    assert.equal(wrapped.url(), 'https://example.com');
  });
});
