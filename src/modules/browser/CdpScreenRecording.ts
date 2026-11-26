/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';

import type {CDPSession, Page} from 'patchright';

import type {StructuredScreencast} from '../../formatters/ScreencastFormatter.js';
import {logger} from '../../utils/logger.js';

export interface StartScreenRecordingOptions {
  path: string;
  fps?: number;
  maxWidth?: number;
  maxHeight?: number;
  audio?: boolean;
}

export interface ScreenRecordingHandle {
  stop(): Promise<void>;
}

export interface ScreenRecorderData {
  recorder: ScreenRecordingHandle;
  filePath: string;
  startedAt: number;
  maxDurationMs: number;
  timer?: ReturnType<typeof setTimeout>;
  /**
   * Shared stop promise so a timer-triggered stop and a concurrent
   * `screencast_stop` call settle on the same result without double-stopping.
   */
  stopping?: Promise<StructuredScreencast>;
}

interface RawCdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach(): Promise<void>;
}

interface StartScreenRecordingResult {
  stream?: string;
}

interface IoReadResult {
  data?: string;
  base64Encoded?: boolean;
  eof?: boolean;
}

/**
 * 基于 CDP `Page.startScreenRecording` / `Page.stopScreenRecording` 与 `IO.read`
 * 的页面原生 MP4 录屏会话（对齐 Puppeteer `CdpScreenRecording` 与 `chrome-devtools-mcp`）。
 */
export class CdpScreenRecording implements ScreenRecordingHandle {
  readonly #client: RawCdpClient;
  readonly #streamHandle: string | undefined;
  readonly #filePath: string;
  #stopPromise?: Promise<void>;

  constructor(
    client: CDPSession,
    streamHandle: string | undefined,
    filePath: string,
  ) {
    this.#client = client as unknown as RawCdpClient;
    this.#streamHandle = streamHandle;
    this.#filePath = filePath;
  }

  async stop(): Promise<void> {
    this.#stopPromise ??= this.#stopImpl();
    await this.#stopPromise;
  }

  async #stopImpl(): Promise<void> {
    let fileHandle: fs.FileHandle | undefined;
    try {
      if (!this.#streamHandle) {
        return;
      }

      await this.#client.send('Page.stopScreenRecording').catch(err => {
        logger.debug('Page.stopScreenRecording failed:', err);
      });

      fileHandle = await fs.open(this.#filePath, 'w');
      let eof = false;
      while (!eof) {
        const chunk = (await this.#client.send('IO.read', {
          handle: this.#streamHandle,
        })) as IoReadResult;
        eof = Boolean(chunk.eof);
        if (chunk.data) {
          const buffer = chunk.base64Encoded
            ? Buffer.from(chunk.data, 'base64')
            : Buffer.from(chunk.data, 'utf8');
          await fileHandle.write(buffer);
        }
      }

      await this.#client
        .send('IO.close', {handle: this.#streamHandle})
        .catch(err => {
          logger.debug('IO.close failed:', err);
        });
    } finally {
      if (fileHandle) {
        await fileHandle.close().catch(() => undefined);
      }
      await this.#client.detach().catch(() => undefined);
    }
  }
}

export async function startCdpScreenRecording(
  page: Page,
  options: StartScreenRecordingOptions,
): Promise<CdpScreenRecording> {
  const client = await page.context().newCDPSession(page);
  const rawClient = client as unknown as RawCdpClient;

  const params: Record<string, unknown> = {};
  if (options.audio !== undefined) params.audio = options.audio;
  if (options.maxWidth !== undefined) params.maxWidth = options.maxWidth;
  if (options.maxHeight !== undefined) params.maxHeight = options.maxHeight;
  if (options.fps !== undefined) params.frameRate = options.fps;

  try {
    const result = (await rawClient.send(
      'Page.startScreenRecording',
      params,
    )) as StartScreenRecordingResult;
    return new CdpScreenRecording(client, result?.stream, options.path);
  } catch (error) {
    await client.detach().catch(() => undefined);
    throw error;
  }
}
