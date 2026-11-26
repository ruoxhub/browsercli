/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {waitFor} from '../../../../src/tools/page.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('wait_for tool', () => {
  it('throws PAGE_REQUIRED when no active page is selected', async () => {
    const response = new ToolResponseAccumulator();
    await assert.rejects(
      waitFor.handler({params: {text: ['Ready']}}, response, {
        getSelectedPage: () => null,
      } as never),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.PAGE_REQUIRED,
    );
  });

  it('waits for text array and requests snapshot by default', async () => {
    let capturedParams: unknown;
    const response = new ToolResponseAccumulator();
    await waitFor.handler(
      {
        params: {
          text: ['Welcome', 'Dashboard'],
          visible: true,
          timeout: 5000,
        },
      },
      response,
      {
        getSelectedPage: () => ({}),
        waitForTextOnPage: async (params: unknown) => {
          capturedParams = params;
        },
      } as never,
    );
    assert.deepEqual(capturedParams, {
      text: ['Welcome', 'Dashboard'],
      timeout: 5000,
      visible: true,
    });
    assert.notEqual(response.getSnapshotRequest(), undefined);
    assert.equal(
      (
        (response.toJSON().structuredContent as Record<string, unknown>)
          .data as Record<string, unknown>
      ).found,
      true,
    );
  });

  it('skips snapshot when includeSnapshot is false and maps timeout errors', async () => {
    const response = new ToolResponseAccumulator();
    await waitFor.handler(
      {params: {text: ['Done'], includeSnapshot: false}},
      response,
      {
        getSelectedPage: () => ({}),
        waitForTextOnPage: async () => undefined,
      } as never,
    );
    assert.equal(response.getSnapshotRequest(), undefined);

    await assert.rejects(
      waitFor.handler(
        {params: {text: ['Never'], timeout: 200}},
        new ToolResponseAccumulator(),
        {
          getSelectedPage: () => ({}),
          waitForTextOnPage: async () => {
            throw new Error('Timed out waiting for text');
          },
        } as never,
      ),
      (err: unknown) =>
        err instanceof ToolError &&
        err.code === ErrorCodes.TIMEOUT &&
        err.retryable === true,
    );
  });
});
