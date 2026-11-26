/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ScreencastFormatter,
  type ScreencastStopReason,
  type StructuredScreencast,
} from '../formatters/ScreencastFormatter.js';
import type {
  ScreenRecorderData,
  ScreenRecordingHandle,
} from '../modules/browser/CdpScreenRecording.js';
import {zod, type Page} from '../third_party/index.js';
import {createToolError, ErrorCodes} from '../utils/errors.js';
import {validateOutputPath} from '../utils/fsSafe.js';
import {logger} from '../utils/logger.js';

import {ToolCategory} from './categories.js';
import type {DomainManifest} from './manifest.js';
import {definePageTool, type Context} from './ToolDefinition.js';

const DEFAULT_MAX_DURATION_MS = 600_000;
const MIN_MAX_DURATION_MS = 1_000;
const MAX_MAX_DURATION_MS = 600_000;

async function generateTempFilePath(): Promise<string> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'browsercli-screencast-'),
  );
  return path.join(dir, 'screencast.mp4');
}

async function resolveMp4Path(
  context: Context,
  filePath: string,
): Promise<`${string}.mp4`> {
  if (context.ensureExtension) {
    return await context.ensureExtension(filePath, '.mp4');
  }
  const resolved = validateOutputPath(filePath);
  const currentExtension = path.extname(resolved);
  return `${resolved.slice(0, resolved.length - currentExtension.length)}.mp4`;
}

/**
 * Returns the size of the page viewport in device pixels.
 */
async function getPagePixelSize(
  rawPage: Page,
): Promise<{maxWidth: number; maxHeight: number}> {
  const {width, height, dpr} = await rawPage.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
  }));
  return {
    maxWidth: Math.max(1, Math.round(width * dpr)),
    maxHeight: Math.max(1, Math.round(height * dpr)),
  };
}

/**
 * Fails a start that cannot possibly produce a file, instead of returning a
 * success that only fails when the recording stops. Chrome writes no bytes
 * before the recording stops, so the file size cannot be checked here.
 */
async function assertWritable(filePath: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    // Open for append so a failed start does not truncate an existing file.
    handle = await fs.open(filePath, 'a');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot write the screencast to ${filePath}: ${message}. Choose a filePath inside an existing, writable directory.`,
    );
  } finally {
    await handle?.close();
  }
}

/**
 * Stops a recording once, whatever triggered the stop, and describes the file
 * that was produced. Concurrent callers (a timer and a tool call) share the
 * first stop.
 */
async function finishRecording(
  data: ScreenRecorderData,
  stopReason: ScreencastStopReason,
): Promise<StructuredScreencast> {
  data.stopping ??= stopRecording(data, stopReason);
  return await data.stopping;
}

async function stopRecording(
  data: ScreenRecorderData,
  stopReason: ScreencastStopReason,
): Promise<StructuredScreencast> {
  if (data.timer !== undefined) {
    clearTimeout(data.timer);
    data.timer = undefined;
  }
  // Measure before stopping: stopping downloads every frame from the browser,
  // and that transfer is not part of the recording.
  const durationMs = Math.max(0, Date.now() - data.startedAt);
  try {
    await data.recorder.stop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to stop the screencast recording at ${data.filePath}: ${message}`,
      {cause: error},
    );
  }
  let bytes = 0;
  try {
    bytes = (await fs.stat(data.filePath)).size;
  } catch (error) {
    logger.debug('Failed to stat the screencast file', error);
  }
  return {
    filePath: data.filePath,
    durationMs,
    bytes,
    stopReason,
    // The stop reason says why the recording ended; completeness says whether
    // the file it produced carries frames.
    completeness: bytes > 0 ? 'complete' : 'partial',
  };
}

export const startScreencast = definePageTool({
  name: 'screencast_start',
  description:
    'Starts recording a screencast (video) of the target page. The recording stops automatically after maxDurationMs and is written to the file only when it stops, so call screencast_stop to finish it.',
  annotations: {
    title: '开始录屏',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {
    filePath: zod
      .string()
      .optional()
      .describe(
        'Output file path (.mp4). Uses mkdtemp to generate a unique path if not provided.',
      ),
    maxDurationMs: zod
      .number()
      .int()
      .min(MIN_MAX_DURATION_MS)
      .max(MAX_MAX_DURATION_MS)
      .default(DEFAULT_MAX_DURATION_MS)
      .describe(
        `Maximum recording length in milliseconds, after which the recording stops automatically. Between ${MIN_MAX_DURATION_MS} and ${MAX_MAX_DURATION_MS}.`,
      ),
    fps: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Maximum frame rate. Defaults to the --screencast-fps server option, or the browser default when that is unset.',
      ),
  },
  blockedByDialog: false,
  concurrency: 'exclusive',
  handler: async (request, response, context) => {
    const page = request.page;
    const existing = page.getScreenRecorder();
    if (existing) {
      throw createToolError(
        ErrorCodes.PREREQUISITE,
        existing.stopping
          ? 'Error: the previous screencast already stopped and is still waiting to be collected. Use screencast_stop to save it before starting a new one.'
          : 'Error: a screencast recording is already in progress. Use screencast_stop to stop it before starting a new one.',
        {toolName: 'screencast_start'},
      );
    }

    const requestedFilePath = request.params.filePath;
    const filePath = requestedFilePath ?? (await generateTempFilePath());
    const resolvedPath = await resolveMp4Path(context, filePath);
    const maxDurationMs =
      request.params.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    const fps = request.params.fps ?? context.getScreencastFps?.();

    let recorder: ScreenRecordingHandle;
    try {
      await assertWritable(resolvedPath);
      // Without explicit limits Chrome downscales frames to a small default
      // size. Record at the actual device pixel size of the page instead.
      const {maxWidth, maxHeight} = await getPagePixelSize(page.rawPage);
      recorder = await page.startScreenRecording({
        path: resolvedPath,
        fps,
        maxWidth,
        maxHeight,
      });
    } catch (err) {
      // If we generated a temporary directory for this recording, remove it so
      // a failed start does not leak an empty directory.
      if (requestedFilePath === undefined) {
        try {
          await fs.rm(path.dirname(resolvedPath), {
            recursive: true,
            force: true,
          });
        } catch {
          // no-op
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Page.startScreenRecording')) {
        throw new Error(
          'The connected Chrome does not support screen recording. Update Chrome to a newer version.',
        );
      }
      throw err;
    }

    const data: ScreenRecorderData = {
      recorder,
      filePath: resolvedPath,
      startedAt: Date.now(),
      maxDurationMs,
    };
    page.setScreenRecorder(data);
    data.timer = setTimeout(() => {
      void finishRecording(data, 'duration_limit').catch(error => {
        logger.debug('Failed to stop the screencast at maxDurationMs', error);
      });
    }, data.maxDurationMs);
    // An idle recording must not keep the process alive.
    data.timer.unref?.();

    const message = `Screencast recording started. The recording will be saved to ${resolvedPath} and stops automatically after ${data.maxDurationMs}ms. Use screencast_stop to stop it earlier.`;
    response.appendResponseLine(message);
    response.setStructuredContent({
      success: true,
      message,
      filePath: resolvedPath,
      maxDurationMs: data.maxDurationMs,
      ...(fps !== undefined ? {fps} : {}),
    });
  },
});

export const stopScreencast = definePageTool({
  name: 'screencast_stop',
  description: 'Stops the active screencast recording on the target page.',
  annotations: {
    title: '停止录屏',
    category: ToolCategory.DEBUGGING,
    readOnlyHint: false,
  },
  schema: {},
  blockedByDialog: false,
  concurrency: 'exclusive',
  handler: async (request, response) => {
    const page = request.page;
    const data = page.getScreenRecorder();
    if (!data) {
      throw createToolError(
        ErrorCodes.PREREQUISITE,
        'Error: no active screencast recording to stop.',
        {toolName: 'screencast_stop'},
      );
    }
    try {
      const result = await finishRecording(data, 'user_stopped');
      const formatter = new ScreencastFormatter(result);
      const message = formatter.toString();
      response.appendResponseLine(message);
      response.setStructuredContent({
        success: true,
        message,
        ...formatter.toJSON(),
      });
    } finally {
      page.setScreenRecorder(null);
    }
  },
});

// ─── manifest.ts ─────────────────────────────────────────

export const manifest = {
  name: 'screencast',
  description: 'Browser page screencast (video) recording tools.',
  profile: 'workflow',
  tools: [
    {
      modulePath: './screencast.js',
      handlerName: 'startScreencast',
    },
    {
      modulePath: './screencast.js',
      handlerName: 'stopScreencast',
    },
  ],
} satisfies DomainManifest;
