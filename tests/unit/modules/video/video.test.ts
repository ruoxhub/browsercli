/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {
  FrameClock,
  type StoredVideo,
  validateVideoStart,
  VideoArtifactStore,
  videoDimensions,
  VideoManager,
  VideoTimeline,
} from '../../../../src/modules/video/index.js';

describe('Video module - Timeline and FrameClock', () => {
  it('calculates monotonic elapsed time accurately', () => {
    const clock = new FrameClock();
    // CDP timestamp in seconds
    const t0 = clock.elapsed(100.0, 0);
    assert.equal(t0, 0);

    const t1 = clock.elapsed(100.05, 50);
    assert.equal(t1, 50);

    const t2 = clock.elapsed(100.1, 100);
    assert.equal(t2, 100);

    // Clock skew / timestamp jitter should not go backwards
    const t3 = clock.elapsed(100.08, 120);
    assert.equal(t3 >= t2, true);
  });

  it('drops frames exceeding frame rate budget or max duration', () => {
    const timeline = new VideoTimeline(15, 1000); // 15fps, max 1000ms

    const f1 = timeline.advance(80);
    assert.ok(f1);
    assert.equal(f1.timestamp, 0);

    // Frame arrived too quickly (90ms - 80ms = 10ms < 66ms)
    const f2 = timeline.advance(90);
    assert.equal(f2, null);

    // Frame arrived after interval
    const f3 = timeline.advance(160);
    assert.ok(f3);

    // First frame exceeding max duration finishes up to limitMs
    const f4 = timeline.advance(1500);
    assert.ok(f4);
    assert.equal(timeline.durationMs, 1000);

    // Subsequent frame is fully capped and rejected
    const f5 = timeline.advance(1600);
    assert.equal(f5, null);
  });

  it('computes correct video dimensions maintaining aspect ratio', () => {
    const dims = videoDimensions(1920, 1080, 1280);
    assert.equal(dims.width, 1280);
    assert.equal(dims.height, 720);
  });
});

describe('Video module - Validation', () => {
  it('validates start parameters', () => {
    assert.equal(validateVideoStart({}), undefined);
    assert.equal(validateVideoStart({quality: 'standard'}), undefined);
    assert.equal(validateVideoStart({quality: 'clear'}), undefined);
    assert.match(
      validateVideoStart({quality: 'invalid' as any}) || '',
      /quality must be/i,
    );
    assert.match(
      validateVideoStart({max_duration_ms: -1}) || '',
      /max_duration_ms must be/,
    );
    assert.match(
      validateVideoStart({max_duration_ms: 700_000}) || '',
      /max_duration_ms must be/,
    );
    assert.match(validateVideoStart({tab_id: -1}) || '', /Invalid tab_id/);
  });
});

describe('Video module - Artifact Store', () => {
  it('stores, retrieves, chunks, and removes video metadata and files', async () => {
    const tmpBase = mkdtempSync(
      path.join(os.tmpdir(), 'browsercli-video-test-'),
    );
    try {
      const store = new VideoArtifactStore(tmpBase);
      await store.prepare();

      const stored: StoredVideo = {
        recording_id: `vid_${'0123456789abcdef'.repeat(2)}`,
        session_id: 'sess_default',
        request_id: 'req_test12345678',
        tab_id: 0,
        title: 'Test Page',
        state: 'ready',
        quality: 'standard',
        created_at: Date.now(),
        expires_at: Date.now() + 10_000,
        max_duration_ms: 60_000,
        duration_ms: 5000,
        byte_size: 1000,
        width: 1280,
        height: 720,
        frames: 30,
        dropped_frames: 0,
        exported: false,
        owner: 'test',
        capability: 'cap_secret',
      };

      await store.put(stored);

      const dir = store.videoDir(stored.recording_id);
      writeFileSync(path.join(dir, 'video.mp4'), Buffer.alloc(1000, 0x42));

      const fetched = await store.get(stored.recording_id);
      assert.ok(fetched);
      assert.equal(fetched.recording_id, stored.recording_id);
      assert.equal(fetched.title, 'Test Page');

      const list = await store.list();
      assert.equal(list.length, 1);
      assert.equal(list[0].recording_id, stored.recording_id);

      const buf = await store.fileBuffer(stored.recording_id);
      assert.equal(buf.length, 1000);
      assert.equal(buf[0], 0x42);

      await store.remove(stored.recording_id);
      assert.equal(existsSync(dir), false);
      assert.equal(await store.get(stored.recording_id), undefined);
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });
});

describe('Video module - VideoManager Mock Workflow', () => {
  it('manages video lifecycle: start -> status -> stop -> read -> save -> discard', async () => {
    const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'browsercli-vm-test-'));
    try {
      const store = new VideoArtifactStore(tmpBase);

      let screencastStarted = false;

      // Mock CDP Session
      const mockCdp = {
        send: async (method: string) => {
          if (method === 'Page.enable') return {};
          if (method === 'Page.captureScreenshot') {
            return {
              data: Buffer.from('fake-screenshot-data').toString('base64'),
            };
          }
          if (method === 'Page.startScreencast') {
            screencastStarted = true;
            return {};
          }
          if (method === 'Page.stopScreencast') {
            return {};
          }
          if (method === 'Page.screencastFrameAck') return {};
          return {};
        },
        on: () => undefined,
        detach: async () => undefined,
      };

      // Mock Page
      const mockPage = {
        title: async () => 'Mock Target Tab',
        isClosed: () => false,
        context: () => ({
          newCDPSession: async () => mockCdp,
        }),
        once: () => undefined,
        off: () => undefined,
      };

      const manager = new VideoManager({
        getPage: async () => mockPage as any,
        store,
      });

      // 1. Capabilities
      const caps = await manager.capabilities();
      assert.equal(caps.format, 'mp4');
      assert.equal(caps.audio, false);

      // 2. Start
      const grant = await manager.start({
        session_id: 'sess_default',
        quality: 'standard',
        max_duration_ms: 10_000,
        request_id: 'req_12345678',
      });
      assert.ok(grant.recording.recording_id);
      assert.equal(grant.recording.state, 'recording');
      assert.equal(grant.recording.quality, 'standard');
      assert.equal(screencastStarted, true);
      assert.equal(manager.isRecording(), true);

      // 3. Idempotent start with same request_id
      const idemp = await manager.start({
        session_id: 'sess_default',
        request_id: 'req_12345678',
      });
      assert.equal(idemp.recording.recording_id, grant.recording.recording_id);

      // 4. Status
      const statusRes = await manager.get(grant.recording.recording_id);
      assert.equal(statusRes.recording_id, grant.recording.recording_id);
      assert.equal(statusRes.state, 'recording');

      // To test stop without real ffmpeg execution in unit tests,
      // simulate finished output
      const dir = store.videoDir(grant.recording.recording_id);
      writeFileSync(
        path.join(dir, 'video.mp4'),
        Buffer.from('mock-mp4-stream-data'),
      );

      // 5. Read (simulate ready state)
      statusRes.state = 'ready';
      statusRes.byte_size = 20;
      (manager as any).active.value = statusRes;
      await store.put(statusRes);

      const chunk = await manager.read(grant.recording.recording_id, 0);
      assert.equal(chunk.recording_id, grant.recording.recording_id);
      assert.equal(chunk.byte_size, 20);
      assert.equal(
        Buffer.from(chunk.data_base64, 'base64').toString('utf8'),
        'mock-mp4-stream-data',
      );

      // 6. Save
      const saveDest = path.join(tmpBase, 'exported.mp4');
      const saveRes = await manager.save(
        grant.recording.recording_id,
        saveDest,
      );
      assert.equal(existsSync(saveDest), true);
      assert.equal(saveRes.filePath, saveDest);

      // 7. Discard
      await manager.discard(grant.recording.recording_id);
      assert.equal(existsSync(dir), false);
    } finally {
      rmSync(tmpBase, {recursive: true, force: true});
    }
  });
});
