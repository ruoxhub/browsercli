/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  isVideoId,
  type StoredVideo,
  VIDEO_BUDGET_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_RETENTION_MS,
} from './types.js';

export class VideoArtifactStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve(process.cwd(), 'artifacts/videos');
    mkdirSync(this.baseDir, {recursive: true});
  }

  videoDir(id: string, create = false): string {
    if (!isVideoId(id)) throw new Error('Invalid recording ID');
    const dir = path.join(this.baseDir, id);
    if (create && !existsSync(dir)) {
      mkdirSync(dir, {recursive: true});
    }
    return dir;
  }

  async list(): Promise<StoredVideo[]> {
    if (!existsSync(this.baseDir)) return [];
    const entries = readdirSync(this.baseDir, {withFileTypes: true});
    const recordings: StoredVideo[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && isVideoId(entry.name)) {
        const item = await this.get(entry.name);
        if (item) recordings.push(item);
      }
    }
    return recordings.sort((a, b) => b.created_at - a.created_at);
  }

  async get(id: string): Promise<StoredVideo | undefined> {
    if (!isVideoId(id)) return undefined;
    const metaPath = path.join(this.videoDir(id), 'metadata.json');
    if (!existsSync(metaPath)) return undefined;
    try {
      const data = JSON.parse(readFileSync(metaPath, 'utf8'));
      return data as StoredVideo;
    } catch {
      return undefined;
    }
  }

  async put(value: StoredVideo): Promise<void> {
    const dir = this.videoDir(value.recording_id, true);
    const metaPath = path.join(dir, 'metadata.json');
    writeFileSync(metaPath, JSON.stringify(value, null, 2), 'utf8');
  }

  videoFilePath(id: string): string {
    return path.join(this.videoDir(id), 'video.mp4');
  }

  async fileBuffer(id: string): Promise<Buffer> {
    const file = this.videoFilePath(id);
    if (!existsSync(file)) throw new Error(`Video file not found: ${id}`);
    return readFileSync(file);
  }

  async remove(id: string): Promise<void> {
    if (!isVideoId(id)) throw new Error('Invalid recording ID');
    const dir = path.join(this.baseDir, id);
    if (existsSync(dir)) {
      rmSync(dir, {recursive: true, force: true});
    }
  }

  async prepare(activeId?: string): Promise<void> {
    const now = Date.now();
    for (const recording of await this.list()) {
      if (
        recording.recording_id !== activeId &&
        (recording.expires_at <= now ||
          now - recording.created_at > VIDEO_RETENTION_MS)
      ) {
        await this.remove(recording.recording_id);
      }
    }
  }

  async reserve(): Promise<void> {
    await this.prepare();
    const values = await this.list();
    let used = 0;
    for (const value of values) {
      const mp4Path = this.videoFilePath(value.recording_id);
      if (existsSync(mp4Path)) {
        used += statSync(mp4Path).size;
      }
    }
    if (used + VIDEO_MAX_BYTES * 2 > VIDEO_BUDGET_BYTES) {
      throw new Error(
        'Video storage is full; save and delete an earlier recording',
      );
    }
  }
}
