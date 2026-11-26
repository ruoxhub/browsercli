/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it} from 'node:test';

import type {Page} from 'patchright';
import sinon from 'sinon';

import {
  startCdpScreenRecording,
  type ScreenRecorderData,
  type ScreenRecordingHandle,
  type StartScreenRecordingOptions,
} from '../../../src/modules/browser/CdpScreenRecording.js';
import {PageSnapshotManager} from '../../../src/modules/snapshot/PageSnapshotManager.js';
import {
  startScreencast,
  stopScreencast,
} from '../../../src/tools/screencast.js';
import type {Context, ContextPage} from '../../../src/tools/ToolDefinition.js';
import {BrowserPage} from '../../../src/worker/BrowserPage.js';
import {CollectorContextProvider} from '../../../src/worker/context/CollectorContextProvider.js';
import {PageHealthTracker} from '../../../src/worker/context/PageHealthTracker.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bcli-screencast-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, {recursive: true, force: true}).catch(() => undefined);
  }
});

function createResponseMock() {
  const lines: string[] = [];
  let structured: unknown;
  return {
    lines,
    get structured() {
      return structured;
    },
    response: {
      appendResponseLine(line: string) {
        lines.push(line);
      },
      setStructuredContent(val: unknown) {
        structured = val;
      },
    },
  };
}

function createScreencastMocks(dir: string, defaultFps?: number) {
  let activeRecorder: ScreenRecorderData | null = null;
  const stopStub = sinon.stub().resolves();
  const mockRecorder: ScreenRecordingHandle = {stop: stopStub};
  const filePath: `${string}.mp4` = `${path.join(dir, 'recording')}.mp4`;

  const startScreenRecording = sinon
    .stub()
    .callsFake(async (options: StartScreenRecordingOptions) => {
      await fs.writeFile(options.path, 'ftyp');
      return mockRecorder;
    });

  const evaluate = sinon.stub().resolves({width: 800, height: 600, dpr: 2});
  const getScreenRecorder = sinon.stub().callsFake(() => activeRecorder);
  const setScreenRecorder = sinon
    .stub()
    .callsFake((data: ScreenRecorderData | null) => {
      activeRecorder = data;
    });

  const page = {
    id: 'page-1',
    rawPage: {evaluate} as unknown as Page,
    getScreenRecorder,
    setScreenRecorder,
    startScreenRecording,
  } as unknown as ContextPage;

  const ensureExtension = sinon
    .stub()
    .callsFake(async (fp: string, ext: `.${string}`) => {
      const resolved = path.resolve(fp);
      const curExt = path.extname(resolved);
      return `${resolved.slice(0, resolved.length - curExt.length)}${ext}`;
    });

  const context = {
    ensureExtension,
    getScreencastFps: () => defaultFps,
  } as unknown as Context;

  const resp = createResponseMock();

  return {
    page,
    context,
    resp,
    stopStub,
    mockRecorder,
    startScreenRecording,
    getScreenRecorder,
    setScreenRecorder,
    ensureExtension,
    filePath,
    getActiveRecorder: () => activeRecorder,
    clearTimer: () => {
      if (activeRecorder?.timer) {
        clearTimeout(activeRecorder.timer);
      }
    },
  };
}

describe('screencast tools', () => {
  describe('screencast_start', () => {
    it('starts an mp4 recording at the page device pixel size', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);

      try {
        await startScreencast.handler(
          {
            params: {filePath: mocks.filePath, maxDurationMs: 600_000},
            page: mocks.page,
          },
          mocks.resp.response as never,
          mocks.context,
        );

        sinon.assert.calledOnceWithExactly(
          mocks.ensureExtension,
          mocks.filePath,
          '.mp4',
        );
        sinon.assert.calledOnceWithExactly(mocks.startScreenRecording, {
          path: mocks.filePath,
          fps: undefined,
          maxWidth: 1600,
          maxHeight: 1200,
        });
        sinon.assert.calledOnce(mocks.setScreenRecorder);
        const started = mocks.getActiveRecorder();
        assert.equal(started?.recorder, mocks.mockRecorder);
        assert.equal(started?.filePath, mocks.filePath);
        assert.equal(started?.maxDurationMs, 600_000);
        assert.deepEqual(mocks.resp.lines, [
          `Screencast recording started. The recording will be saved to ${mocks.filePath} and stops automatically after 600000ms. Use screencast_stop to stop it earlier.`,
        ]);
      } finally {
        mocks.clearTimer();
      }
    });

    it('generates a temp mp4 path when filePath is omitted', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      let generatedDir: string | undefined;

      try {
        await startScreencast.handler(
          {params: {maxDurationMs: 600_000}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        );

        const started = mocks.getActiveRecorder();
        assert.ok(started?.filePath.endsWith('.mp4'));
        generatedDir = path.dirname(started.filePath);
      } finally {
        mocks.clearTimer();
        if (generatedDir) {
          await fs.rm(generatedDir, {recursive: true, force: true});
        }
      }
    });

    it('uses default screencastFps from context and lets fps param override it', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir, 10);

      try {
        await startScreencast.handler(
          {
            params: {filePath: mocks.filePath, maxDurationMs: 600_000},
            page: mocks.page,
          },
          mocks.resp.response as never,
          mocks.context,
        );
        sinon.assert.calledOnceWithExactly(mocks.startScreenRecording, {
          path: mocks.filePath,
          fps: 10,
          maxWidth: 1600,
          maxHeight: 1200,
        });
        mocks.clearTimer();
        mocks.page.setScreenRecorder(null);

        mocks.startScreenRecording.resetHistory();
        await startScreencast.handler(
          {
            params: {filePath: mocks.filePath, maxDurationMs: 600_000, fps: 3},
            page: mocks.page,
          },
          mocks.resp.response as never,
          mocks.context,
        );
        sinon.assert.calledOnceWithExactly(mocks.startScreenRecording, {
          path: mocks.filePath,
          fps: 3,
          maxWidth: 1600,
          maxHeight: 1200,
        });
      } finally {
        mocks.clearTimer();
      }
    });

    it('errors if a recording is already active', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      mocks.page.setScreenRecorder({
        recorder: mocks.mockRecorder,
        filePath: mocks.filePath,
        startedAt: Date.now(),
        maxDurationMs: 600_000,
      });

      await assert.rejects(
        startScreencast.handler(
          {params: {maxDurationMs: 600_000}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        ),
        /Error: a screencast recording is already in progress\. Use screencast_stop to stop it before starting a new one\./,
      );

      sinon.assert.notCalled(mocks.startScreenRecording);
    });

    it('asks to collect a recording that already stopped', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      mocks.page.setScreenRecorder({
        recorder: mocks.mockRecorder,
        filePath: mocks.filePath,
        startedAt: Date.now(),
        maxDurationMs: 600_000,
        stopping: Promise.resolve({
          filePath: mocks.filePath,
          durationMs: 10,
          bytes: 4,
          stopReason: 'duration_limit',
          completeness: 'complete',
        }),
      });

      await assert.rejects(
        startScreencast.handler(
          {params: {maxDurationMs: 600_000}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        ),
        /Error: the previous screencast already stopped and is still waiting to be collected\. Use screencast_stop to save it before starting a new one\./,
      );

      sinon.assert.notCalled(mocks.startScreenRecording);
    });

    it('provides a clear error when Chrome does not support recording and cleans temp dir', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      mocks.startScreenRecording.rejects(
        new Error(
          "Protocol error (Page.startScreenRecording): 'Page.startScreenRecording' wasn't found",
        ),
      );

      await assert.rejects(
        startScreencast.handler(
          {params: {maxDurationMs: 600_000}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        ),
        /The connected Chrome does not support screen recording/,
      );

      const attemptedPath = mocks.startScreenRecording.firstCall.args[0]?.path;
      assert.ok(attemptedPath);
      await assert.rejects(fs.access(path.dirname(attemptedPath)));
      sinon.assert.notCalled(mocks.setScreenRecorder);
    });

    it('reports an unwritable output path before starting', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      const badPath = path.join(dir, 'non-existent-subdir', 'out.mp4');

      await assert.rejects(
        startScreencast.handler(
          {
            params: {filePath: badPath, maxDurationMs: 600_000},
            page: mocks.page,
          },
          mocks.resp.response as never,
          mocks.context,
        ),
        /Cannot write the screencast to/,
      );

      sinon.assert.notCalled(mocks.startScreenRecording);
    });
  });

  describe('screencast_stop', () => {
    it('stops the active recording, formats summary, and clears state', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      await fs.writeFile(mocks.filePath, Buffer.alloc(2048, 0x41));
      mocks.page.setScreenRecorder({
        recorder: mocks.mockRecorder,
        filePath: mocks.filePath,
        startedAt: Date.now() - 1_500,
        maxDurationMs: 600_000,
      });

      await stopScreencast.handler(
        {params: {}, page: mocks.page},
        mocks.resp.response as never,
        mocks.context,
      );

      sinon.assert.calledOnce(mocks.stopStub);
      assert.equal(mocks.getActiveRecorder(), null);
      assert.match(
        mocks.resp.lines[0] ?? '',
        new RegExp(
          `Screencast saved to ${mocks.filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        ),
      );
      assert.match(
        mocks.resp.lines[0] ?? '',
        /The recording is complete \(2\.0 KiB over .*, stopped by the caller\)\./,
      );
      assert.equal(
        (mocks.resp.structured as {completeness: string}).completeness,
        'complete',
      );
    });

    it('reports partial completeness when file is empty', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      await fs.writeFile(mocks.filePath, Buffer.alloc(0));
      mocks.page.setScreenRecorder({
        recorder: mocks.mockRecorder,
        filePath: mocks.filePath,
        startedAt: Date.now() - 200,
        maxDurationMs: 600_000,
      });

      await stopScreencast.handler(
        {params: {}, page: mocks.page},
        mocks.resp.response as never,
        mocks.context,
      );

      assert.match(mocks.resp.lines[0] ?? '', /The recording is partial/);
      assert.match(
        mocks.resp.lines[0] ?? '',
        /The file is empty: no frames were written/,
      );
    });

    it('errors when no active recording exists', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);

      await assert.rejects(
        stopScreencast.handler(
          {params: {}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        ),
        /Error: no active screencast recording to stop\./,
      );
    });

    it('clears recorder state even when stop() rejects', async () => {
      const dir = await makeTempDir();
      const mocks = createScreencastMocks(dir);
      mocks.stopStub.rejects(new Error('stream broken'));
      mocks.page.setScreenRecorder({
        recorder: mocks.mockRecorder,
        filePath: mocks.filePath,
        startedAt: Date.now(),
        maxDurationMs: 600_000,
      });

      await assert.rejects(
        stopScreencast.handler(
          {params: {}, page: mocks.page},
          mocks.resp.response as never,
          mocks.context,
        ),
        /Failed to stop the screencast recording/,
      );
      assert.equal(mocks.getActiveRecorder(), null);
    });
  });

  describe('CdpScreenRecording & BrowserPage lifecycle', () => {
    it('streams MP4 chunks via Page.startScreenRecording / Page.stopScreenRecording / IO.read', async () => {
      const dir = await makeTempDir();
      const outPath = path.join(dir, 'cdp-output.mp4');
      const sent: Array<{method: string; params?: Record<string, unknown>}> =
        [];
      let readCount = 0;
      let detached = false;

      const fakeSession = {
        async send(method: string, params?: Record<string, unknown>) {
          sent.push({method, params});
          if (method === 'Page.startScreenRecording') {
            return {stream: 'stream-42'};
          }
          if (method === 'Page.stopScreenRecording') {
            return {};
          }
          if (method === 'IO.read') {
            readCount++;
            if (readCount === 1) {
              return {
                data: Buffer.from('hello-').toString('base64'),
                base64Encoded: true,
                eof: false,
              };
            }
            return {data: 'mp4', base64Encoded: false, eof: true};
          }
          if (method === 'IO.close') {
            return {};
          }
          return {};
        },
        async detach() {
          detached = true;
        },
      };

      const fakePage = {
        context: () => ({
          newCDPSession: async () => fakeSession,
        }),
      } as unknown as Page;

      const recording = await startCdpScreenRecording(fakePage, {
        path: outPath,
        fps: 15,
        maxWidth: 1280,
        maxHeight: 720,
      });

      // Concurrent stop() calls share the same stop execution
      await Promise.all([recording.stop(), recording.stop()]);

      const content = await fs.readFile(outPath, 'utf8');
      assert.equal(content, 'hello-mp4');
      assert.equal(detached, true);
      assert.deepEqual(sent[0], {
        method: 'Page.startScreenRecording',
        params: {maxWidth: 1280, maxHeight: 720, frameRate: 15},
      });
      assert.equal(
        sent.filter(s => s.method === 'Page.stopScreenRecording').length,
        1,
      );
      assert.equal(sent.filter(s => s.method === 'IO.close').length, 1);
    });

    it('BrowserPage.dispose() stops active screen recorder and clears timer', async () => {
      const stopStub = sinon.stub().resolves();
      const fakePage = {
        isClosed: () => false,
        on: () => undefined,
        once: () => undefined,
        off: () => undefined,
      } as unknown as Page;

      const bp = new BrowserPage('page-1', fakePage, {
        collectors: new CollectorContextProvider(),
        snapshotManager: new PageSnapshotManager(),
        healthTracker: new PageHealthTracker(),
      });

      const timer = setTimeout(() => undefined, 60_000);
      timer.unref?.();
      bp.setScreenRecorder({
        recorder: {stop: stopStub},
        filePath: '/tmp/test.mp4',
        startedAt: Date.now(),
        maxDurationMs: 60_000,
        timer,
      });

      await bp.dispose();

      sinon.assert.calledOnce(stopStub);
      assert.equal(bp.getScreenRecorder(), null);
    });
  });
});
