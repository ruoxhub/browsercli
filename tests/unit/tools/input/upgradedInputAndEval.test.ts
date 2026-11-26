/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, describe, it} from 'node:test';

import {ToolCategory} from '../../../../src/tools/categories.js';
import {click} from '../../../../src/tools/input.js';
import {clickAt} from '../../../../src/tools/input.js';
import {drag} from '../../../../src/tools/input.js';
import {fill} from '../../../../src/tools/input.js';
import {fillTargetLocator} from '../../../../src/tools/input.js';
import {pressKey} from '../../../../src/tools/input.js';
import {uploadFile} from '../../../../src/tools/input.js';
import {evaluateScript} from '../../../../src/tools/script.js';
import {takeScreenshot} from '../../../../src/tools/screenshot.js';
import {ErrorCodes, ToolError} from '../../../../src/utils/errors.js';
import {ToolResponseAccumulator} from '../../../../src/worker/ToolResponse.js';

describe('upgraded input, screenshot & evaluate_script tools', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'upgraded-input-eval-'));
  });

  after(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  it('assigns ToolCategory.INPUT and blockedByDialog=true on input tools', () => {
    for (const tool of [click, clickAt, drag, fill, pressKey, uploadFile]) {
      assert.equal(tool.annotations?.category, ToolCategory.INPUT, tool.name);
      assert.equal(tool.blockedByDialog, true, tool.name);
      assert.equal(tool.concurrency, 'page', tool.name);
    }
  });

  it('click triggers waitForEventsAfterAction and requests snapshot when includeSnapshot=true', async () => {
    let waited = false;
    let clicked = false;
    const response = new ToolResponseAccumulator();
    await click.handler(
      {params: {selector: '#btn', includeSnapshot: true}},
      response,
      {
        getSelectedFrame: () => ({
          locator: () => ({
            click: async () => {
              clicked = true;
            },
          }),
        }),
        getDebuggerContext: async () => ({isPaused: () => false}),
        waitForEventsAfterAction: async (
          fn: (s: AbortSignal) => Promise<void>,
        ) => {
          waited = true;
          await fn(new AbortController().signal);
          return {navigatedToUrl: 'https://example.com/after'};
        },
      } as never,
    );
    assert.equal(waited, true);
    assert.equal(clicked, true);
    assert.notEqual(response.getSnapshotRequest(), undefined);
    assert.deepEqual(response.getWaitForResult(), {
      navigatedToUrl: 'https://example.com/after',
    });
  });

  it('click_at supports direct viewport x/y coordinate click and rejects single coordinate', async () => {
    await assert.rejects(
      clickAt.handler(
        {params: {x: 100}},
        new ToolResponseAccumulator(),
        {} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );

    const calls: Array<{method: string; params?: Record<string, unknown>}> = [];
    const response = new ToolResponseAccumulator();
    await clickAt.handler(
      {params: {x: 120, y: 240, dblClick: true}},
      response,
      {
        getSelectedPage: () => ({
          context: () => ({
            newCDPSession: async () => ({
              send: async (
                method: string,
                params?: Record<string, unknown>,
              ) => {
                calls.push({method, params});
                return {};
              },
              detach: async () => undefined,
            }),
          }),
        }),
      } as never,
    );
    const pressed = calls.find(c => c.params?.type === 'mousePressed');
    assert.equal(pressed?.params?.x, 120);
    assert.equal(pressed?.params?.y, 240);
    assert.equal(pressed?.params?.clickCount, 2);
  });

  it('fillTargetLocator handles checkbox toggle via setChecked', async () => {
    let checkedValue: boolean | undefined;
    const locator = {
      count: async () => 1,
      first: () => ({
        evaluate: async () => ({isSelect: false, isToggle: true}),
      }),
      setChecked: async (checked: boolean) => {
        checkedValue = checked;
      },
      fill: async () => {
        throw new Error('should not call fill on toggle');
      },
    };
    const res = await fillTargetLocator(locator, 'true');
    assert.equal(res.found, true);
    assert.equal(res.isToggle, true);
    assert.equal(checkedValue, true);
  });

  it('press_key releases modifiers in finally even if key press fails', async () => {
    const upKeys: string[] = [];
    await assert.rejects(
      pressKey.handler(
        {params: {key: 'Control+Shift+A'}},
        new ToolResponseAccumulator(),
        {
          getSelectedFrame: () => ({
            page: () => ({
              keyboard: {
                down: async () => undefined,
                press: async () => {
                  throw new Error('keyboard failure');
                },
                up: async (k: string) => {
                  upKeys.push(k);
                },
              },
            }),
          }),
        } as never,
      ),
    );
    assert.equal(upKeys.length, 2);
  });

  it('upload_file accepts multi-file filePaths array', async () => {
    let uploaded: unknown;
    const response = new ToolResponseAccumulator();
    await uploadFile.handler(
      {
        params: {
          selector: 'input[type=file]',
          filePaths: ['/tmp/a.png', '/tmp/b.png'],
        },
      },
      response,
      {
        getSelectedFrame: () => ({
          locator: () => ({
            setInputFiles: async (files: unknown) => {
              uploaded = files;
            },
          }),
          page: () => ({}),
        }),
      } as never,
    );
    assert.deepEqual(uploaded, ['/tmp/a.png', '/tmp/b.png']);
  });

  it('take_screenshot rejects uid combined with fullPage', async () => {
    await assert.rejects(
      takeScreenshot.handler(
        {params: {format: 'png', uid: '1_2', fullPage: true}},
        new ToolResponseAccumulator(),
        {getSelectedPage: () => ({})} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );
  });

  it('evaluate_script rejects format=script with args and rejects both function & sourcePath', async () => {
    await assert.rejects(
      evaluateScript.handler(
        {
          params: {
            function: '1 + 1',
            format: 'script',
            args: ['1_1'],
          },
        },
        new ToolResponseAccumulator(),
        {} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );

    const scriptFile = path.join(tmpDir, 'sample.js');
    await writeFile(scriptFile, '() => 42', 'utf-8');
    await assert.rejects(
      evaluateScript.handler(
        {
          params: {
            function: '() => 1',
            sourcePath: scriptFile,
          },
        },
        new ToolResponseAccumulator(),
        {} as never,
      ),
      (err: unknown) =>
        err instanceof ToolError && err.code === ErrorCodes.VALIDATION,
    );
  });
});
