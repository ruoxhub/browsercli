/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {randomBytes} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, statSync} from 'node:fs';
import path from 'node:path';

import type {CDPSession, Page} from 'patchright';

import {VideoEncoderEngine} from './encoder.js';
import {toVideoError, VideoError} from './errors.js';
import {VideoArtifactStore} from './store.js';
import {FrameClock} from './timeline.js';
import {
  completeStop,
  isVideoId,
  publicVideo,
  type StoredVideo,
  validateVideoStart,
  VIDEO_CHUNK_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_DURATION_MS,
  VIDEO_PRESETS,
  VIDEO_VERSION,
  type VideoGrant,
  type VideoParams,
  type VideoRecording,
  type VideoStartOptions,
  type VideoStopReason,
} from './types.js';

interface ActiveVideo {
  value: StoredVideo;
  cdp: CDPSession;
  page: Page;
  encoder: VideoEncoderEngine;
  clock: FrameClock;
  origin: number;
  timer: NodeJS.Timeout;
  starting?: Promise<VideoGrant>;
  stopping?: Promise<StoredVideo>;
  stopReason?: VideoStopReason;
  onPageClose?: () => void;
}

export interface VideoManagerDeps {
  getPage: (tabId?: number) => Promise<Page | null> | Page | null;
  store?: VideoArtifactStore;
  owner?: () => string;
}

export class VideoManager {
  private readonly store: VideoArtifactStore;
  private active?: ActiveVideo;
  private readonly ownerFn: () => string;

  constructor(private readonly deps: VideoManagerDeps) {
    this.store = deps.store ?? new VideoArtifactStore();
    this.ownerFn = deps.owner ?? (() => 'browsercli');
    void this.store.prepare().catch(() => undefined);
  }

  isRecording(): boolean {
    return (
      !!this.active &&
      (this.active.value.state === 'starting' ||
        this.active.value.state === 'recording')
    );
  }

  getActiveRecording(): VideoRecording | undefined {
    return this.active
      ? publicVideo(this.progress(this.active.value))
      : undefined;
  }

  private progress(value: StoredVideo): StoredVideo {
    if (
      value.state !== 'recording' ||
      value.recording_id !== this.active?.value.recording_id
    ) {
      return value;
    }
    const elapsed = Date.now() - (value.started_at ?? Date.now());
    return {
      ...value,
      duration_ms: Math.max(0, Math.min(value.max_duration_ms, elapsed)),
    };
  }

  async capabilities() {
    return {
      version: VIDEO_VERSION,
      format: 'mp4',
      audio: false,
      max_duration_ms: VIDEO_MAX_DURATION_MS,
    };
  }

  async list(owner?: string): Promise<StoredVideo[]> {
    await this.store.prepare(this.active?.value.recording_id);
    const list = await this.store.list();
    return list
      .filter(item => owner === undefined || item.owner === owner)
      .map(item => this.progress(item));
  }

  async get(
    id: string,
    auth?: {owner?: string; capability?: string},
  ): Promise<StoredVideo> {
    if (!isVideoId(id)) {
      throw new VideoError({
        code: 'invalid_params',
        message: 'Invalid recording ID',
      });
    }
    if (this.active && this.active.value.recording_id === id) {
      return this.progress(this.active.value);
    }
    const record = await this.store.get(id);
    if (!record || record.expires_at <= Date.now()) {
      throw new VideoError({
        code: 'permission_denied',
        message: 'Recording not found or expired',
      });
    }
    if (auth?.owner && record.owner !== auth.owner) {
      throw new VideoError({
        code: 'permission_denied',
        message: 'Access denied to recording',
      });
    }
    return record;
  }

  async start(options: VideoStartOptions): Promise<VideoGrant> {
    const opts: VideoStartOptions = {
      ...options,
      session_id: options.session_id || 'default',
      request_id: options.request_id || `req_${randomBytes(8).toString('hex')}`,
    };
    const errorMsg = validateVideoStart(opts);
    if (errorMsg) {
      throw new VideoError({code: 'invalid_params', message: errorMsg});
    }

    const owner = this.ownerFn();
    const existing = (await this.store.list()).find(
      v =>
        v.owner === owner &&
        v.request_id === opts.request_id &&
        v.expires_at > Date.now(),
    );
    if (existing) {
      if (
        this.active?.value.recording_id === existing.recording_id &&
        this.active.starting
      ) {
        return this.active.starting;
      }
      return {
        recording: publicVideo(existing),
        capability: existing.capability,
      };
    }

    if (this.isRecording()) {
      throw new VideoError({
        code: 'invalid_params',
        message: 'A video is already recording or being finalized',
      });
    }

    await this.store.reserve();

    const page = await this.deps.getPage(opts.tab_id);
    if (!page || page.isClosed()) {
      throw new VideoError({
        code: 'cdp_failed',
        message: 'Target page is unavailable or closed',
      });
    }

    const recordingId = `vid_${randomBytes(16).toString('hex')}`;
    const capability = randomBytes(24).toString('hex');
    const quality = opts.quality ?? 'standard';
    const preset = VIDEO_PRESETS[quality];
    const maxDuration = opts.max_duration_ms ?? 60_000;
    const now = Date.now();

    const stored: StoredVideo = {
      recording_id: recordingId,
      session_id: opts.session_id!,
      tab_id: opts.tab_id ?? 0,
      title: (await page.title().catch(() => '')) || 'Browser Session',
      state: 'starting',
      quality,
      created_at: now,
      expires_at: now + 24 * 60 * 60_000,
      max_duration_ms: maxDuration,
      duration_ms: 0,
      byte_size: 0,
      width: preset.maxDimension,
      height: preset.maxDimension,
      frames: 0,
      dropped_frames: 0,
      exported: false,
      owner,
      capability,
      request_id: options.request_id,
    };

    await this.store.put(stored);

    const workingDir = this.store.videoDir(recordingId, true);
    const encoder = new VideoEncoderEngine({
      workingDir,
      quality,
      maxDurationMs: maxDuration,
    });

    const active: ActiveVideo = {
      value: stored,
      cdp: null as unknown as CDPSession,
      page,
      encoder,
      clock: new FrameClock(),
      origin: Date.now(),
      timer: null as unknown as NodeJS.Timeout,
    };

    this.active = active;

    const beginCapture = async (): Promise<VideoGrant> => {
      try {
        const cdp = await page.context().newCDPSession(page);
        active.cdp = cdp;

        await cdp.send('Page.enable');

        // Capture initial frame to ensure page is rendering
        const first = (await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 80,
        })) as {data: string};

        active.encoder.appendFrame(first.data, 0);
        active.origin = Date.now();
        active.value.started_at = Date.now();
        active.value.state = 'recording';
        await this.store.put(active.value);

        cdp.on(
          'Page.screencastFrame',
          async (event: {
            data: string;
            metadata: {timestamp?: number};
            sessionId: number;
          }) => {
            if (!this.active || this.active !== active || active.stopReason)
              return;
            try {
              await cdp
                .send('Page.screencastFrameAck', {sessionId: event.sessionId})
                .catch(() => undefined);
              const elapsed = active.clock.elapsed(
                event.metadata.timestamp,
                Date.now() - active.origin,
              );
              active.encoder.appendFrame(event.data, elapsed);

              // Size cap check
              if (active.value.byte_size > VIDEO_MAX_BYTES) {
                void this.stop(recordingId, 'size_limit');
              }
            } catch {
              // Drop frame on error
            }
          },
        );

        await cdp.send('Page.startScreencast', {
          format: 'jpeg',
          quality: 80,
          maxWidth: preset.maxDimension,
          maxHeight: preset.maxDimension,
          everyNthFrame: 1,
        });

        active.onPageClose = () => {
          void this.stop(recordingId, 'tab_closed');
        };
        page.once('close', active.onPageClose);

        active.timer = setTimeout(() => {
          void this.stop(recordingId, 'duration_limit');
        }, maxDuration);

        return {
          recording: publicVideo(active.value),
          capability,
        };
      } catch (err) {
        active.encoder.abort();
        active.value.state = 'failed';
        active.value.stop_reason = 'capture_failed';
        active.value.error = err instanceof Error ? err.message : String(err);
        await this.store.put(active.value);
        this.active = undefined;
        throw toVideoError(err, 'cdp_failed');
      }
    };

    active.starting = beginCapture();
    return await active.starting;
  }

  async stop(
    id: string,
    reason: VideoStopReason = 'user_stopped',
  ): Promise<StoredVideo> {
    const active = this.active;
    if (!active || active.value.recording_id !== id) {
      return this.get(id);
    }

    if (active.stopping) return active.stopping;

    active.stopReason = reason;
    clearTimeout(active.timer);
    if (active.onPageClose) {
      active.page.off('close', active.onPageClose);
    }

    active.stopping = (async () => {
      active.value.state = 'finalizing';
      await this.store.put(active.value);

      try {
        if (active.cdp) {
          await active.cdp.send('Page.stopScreencast').catch(() => undefined);
          await active.cdp.detach().catch(() => undefined);
        }

        const finalElapsedMs = Date.now() - active.origin;
        const result = await active.encoder.finish(finalElapsedMs);

        const fileSize = existsSync(result.outputPath)
          ? statSync(result.outputPath).size
          : 0;

        active.value.state = 'ready';
        active.value.stop_reason = reason;
        active.value.completeness = completeStop(reason)
          ? 'complete'
          : 'partial';
        active.value.duration_ms = result.durationMs;
        active.value.frames = result.frames;
        active.value.dropped_frames = result.droppedFrames;
        active.value.byte_size = fileSize;

        await this.store.put(active.value);
        return active.value;
      } catch (err) {
        active.encoder.abort();
        active.value.state = 'failed';
        active.value.stop_reason = 'encoding_failed';
        active.value.error = err instanceof Error ? err.message : String(err);
        await this.store.put(active.value);
        return active.value;
      } finally {
        if (this.active === active) {
          this.active = undefined;
        }
      }
    })();

    return await active.stopping;
  }

  async save(
    id: string,
    outputPath: string,
    overwrite = false,
  ): Promise<{recording: VideoRecording; filePath: string}> {
    const record = await this.get(id);
    if (record.state !== 'ready') {
      throw new VideoError({
        code: 'invalid_params',
        message: `Video is not ready to save (current state: ${record.state})`,
      });
    }

    const sourcePath = this.store.videoFilePath(id);
    if (!existsSync(sourcePath)) {
      throw new VideoError({
        code: 'storage_failed',
        message: 'Video artifact file is missing',
      });
    }

    const resolvedOut = path.resolve(process.cwd(), outputPath);
    if (existsSync(resolvedOut) && !overwrite) {
      throw new VideoError({
        code: 'invalid_params',
        message: `Destination file already exists: ${resolvedOut}. Use overwrite=true to replace.`,
      });
    }

    mkdirSync(path.dirname(resolvedOut), {recursive: true});
    copyFileSync(sourcePath, resolvedOut);

    record.exported = true;
    await this.store.put(record);

    return {
      recording: publicVideo(record),
      filePath: resolvedOut,
    };
  }

  async read(
    id: string,
    offset = 0,
  ): Promise<{
    recording_id: string;
    offset: number;
    byte_size: number;
    data_base64: string;
    next_offset: number;
  }> {
    const record = await this.get(id);
    if (record.state !== 'ready') {
      throw new VideoError({
        code: 'invalid_params',
        message: 'Video is not ready to read',
      });
    }

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > record.byte_size
    ) {
      throw new VideoError({
        code: 'invalid_params',
        message: 'Invalid video offset',
      });
    }

    const buffer = await this.store.fileBuffer(id);
    const chunk = buffer.subarray(offset, offset + VIDEO_CHUNK_BYTES);

    return {
      recording_id: record.recording_id,
      offset,
      byte_size: buffer.length,
      data_base64: chunk.toString('base64'),
      next_offset: offset + chunk.length,
    };
  }

  async discard(id: string): Promise<void> {
    if (this.active?.value.recording_id === id) {
      clearTimeout(this.active.timer);
      this.active.encoder.abort();
      this.active = undefined;
    }
    await this.store.remove(id);
  }

  async rpc(params: VideoParams): Promise<unknown> {
    if (params.action === 'capabilities') return this.capabilities();
    if (params.action === 'start') return this.start(params);
    if (params.action === 'list') {
      const recordings = await this.list();
      return {
        recordings: recordings.map(r => ({
          recording: publicVideo(r),
          capability: r.capability,
        })),
      };
    }

    const id = params.recording_id;
    if (params.action === 'status') {
      const record = await this.get(id);
      return {recording: publicVideo(record)};
    }
    if (params.action === 'stop') {
      const record = await this.stop(id);
      return {recording: publicVideo(record)};
    }
    if (params.action === 'save') {
      return this.save(id, params.output, params.overwrite);
    }
    if (params.action === 'read') {
      return this.read(id, params.offset);
    }
    if (params.action === 'discard') {
      await this.discard(id);
      return {discarded: true};
    }

    throw new VideoError({
      code: 'invalid_params',
      message: `Unsupported video action: ${(params as {action?: string}).action}`,
    });
  }
}
