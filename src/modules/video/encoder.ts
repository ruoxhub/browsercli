/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {VideoError} from './errors.js';
import {VideoTimeline} from './timeline.js';
import {VIDEO_PRESETS, type VideoQuality} from './types.js';

let cachedFfmpegAvailable: boolean | undefined;

export function isFfmpegAvailable(): boolean {
  if (cachedFfmpegAvailable !== undefined) return cachedFfmpegAvailable;
  try {
    const res = spawnSync('ffmpeg', ['-version'], {stdio: 'ignore'});
    cachedFfmpegAvailable = res.status === 0;
  } catch {
    cachedFfmpegAvailable = false;
  }
  return cachedFfmpegAvailable;
}

export interface VideoEncoderOptions {
  workingDir: string;
  quality: VideoQuality;
  maxDurationMs: number;
}

export class VideoEncoderEngine {
  private readonly framesDir: string;
  private readonly concatPath: string;
  private readonly outputPath: string;
  private readonly timeline: VideoTimeline;
  private frameCount = 0;
  private droppedFrames = 0;
  private lastElapsedMs = 0;
  private lastFrameFile = '';
  private concatEntries: string[] = [];
  private closed = false;

  constructor(private readonly options: VideoEncoderOptions) {
    if (!isFfmpegAvailable()) {
      throw new VideoError({
        code: 'ffmpeg_missing',
        message:
          'FFmpeg is required for video encoding but was not found in PATH.',
      });
    }
    this.framesDir = path.join(options.workingDir, 'frames');
    this.concatPath = path.join(options.workingDir, 'concat.txt');
    this.outputPath = path.join(options.workingDir, 'video.mp4');

    mkdirSync(this.framesDir, {recursive: true});
    const preset = VIDEO_PRESETS[options.quality];
    this.timeline = new VideoTimeline(preset.fps, options.maxDurationMs);
  }

  appendFrame(jpegBase64: string, elapsedMs: number): void {
    if (this.closed) return;
    const monotonicElapsed = Math.max(elapsedMs, this.lastElapsedMs);
    const timing = this.timeline.advance(monotonicElapsed);
    if (!timing) {
      this.droppedFrames++;
      return;
    }

    const frameIndex = this.frameCount + 1;
    const filename = `frame_${String(frameIndex).padStart(6, '0')}.jpg`;
    const frameFilePath = path.join(this.framesDir, filename);

    const buffer = Buffer.from(jpegBase64, 'base64');
    writeFileSync(frameFilePath, buffer);

    if (this.lastFrameFile) {
      const durationSec = Math.max(
        0.001,
        (monotonicElapsed - this.lastElapsedMs) / 1000,
      );
      this.concatEntries.push(`file 'frames/${this.lastFrameFile}'`);
      this.concatEntries.push(`duration ${durationSec.toFixed(4)}`);
    }

    this.lastFrameFile = filename;
    this.lastElapsedMs = monotonicElapsed;
    this.frameCount++;
  }

  async finish(finalElapsedMs: number): Promise<{
    outputPath: string;
    frames: number;
    droppedFrames: number;
    durationMs: number;
  }> {
    this.closed = true;
    if (this.frameCount === 0) {
      throw new VideoError({
        code: 'encoder_failed',
        message: 'No frames were recorded',
      });
    }

    // Flush the last frame with duration
    const preset = VIDEO_PRESETS[this.options.quality];
    const finalDurationSec = Math.max(
      1 / preset.fps,
      (finalElapsedMs - this.lastElapsedMs) / 1000,
    );
    this.concatEntries.push(`file 'frames/${this.lastFrameFile}'`);
    this.concatEntries.push(`duration ${finalDurationSec.toFixed(4)}`);
    // Concat demuxer requirement: repeat the last image entry
    this.concatEntries.push(`file 'frames/${this.lastFrameFile}'`);

    writeFileSync(this.concatPath, this.concatEntries.join('\n'), 'utf8');

    // Run ffmpeg to produce standard H.264 MP4 with faststart
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        'concat.txt',
        '-vf',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2',
        '-fps_mode',
        'vfr',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-b:v',
        String(preset.bitrate),
        '-movflags',
        '+faststart',
        'video.mp4',
      ];

      const proc = spawn('ffmpeg', args, {
        cwd: this.options.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      proc.on('close', code => {
        if (code === 0 && existsSync(this.outputPath)) {
          resolve();
        } else {
          reject(
            new VideoError({
              code: 'encoder_failed',
              message: `FFmpeg failed with exit code ${code}:\n${stderr}\nConcat Content:\n${this.concatEntries.join('\n')}`,
            }),
          );
        }
      });

      proc.on('error', err => {
        reject(
          new VideoError({
            code: 'encoder_failed',
            message: `Failed to spawn FFmpeg: ${err.message}`,
          }),
        );
      });
    });

    // Cleanup raw frames
    try {
      rmSync(this.framesDir, {recursive: true, force: true});
      if (existsSync(this.concatPath)) rmSync(this.concatPath, {force: true});
    } catch {
      // Ignore cleanup error
    }

    return {
      outputPath: this.outputPath,
      frames: this.frameCount,
      droppedFrames: this.droppedFrames,
      durationMs: Math.max(finalElapsedMs, this.timeline.durationMs),
    };
  }

  abort(): void {
    this.closed = true;
    try {
      if (existsSync(this.framesDir))
        rmSync(this.framesDir, {recursive: true, force: true});
      if (existsSync(this.concatPath)) rmSync(this.concatPath, {force: true});
    } catch {
      // Ignore
    }
  }
}
