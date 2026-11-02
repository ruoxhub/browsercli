/**
 * @license
 * Copyright 2026 Browser-CLI
 * SPDX-License-Identifier: Apache-2.0
 */

export type VideoErrorCode =
  | 'invalid_params'
  | 'permission_denied'
  | 'timeout'
  | 'cancelled'
  | 'cdp_failed'
  | 'encoder_failed'
  | 'storage_failed'
  | 'ffmpeg_missing';

export class VideoError extends Error {
  readonly code: VideoErrorCode;
  readonly data?: Record<string, unknown>;

  constructor(error: {
    code: VideoErrorCode;
    message: string;
    data?: Record<string, unknown>;
  }) {
    super(error.message);
    this.name = 'VideoError';
    this.code = error.code;
    this.data = error.data;
  }
}

export function toVideoError(
  error: unknown,
  fallback: VideoErrorCode = 'cdp_failed',
): VideoError {
  if (error instanceof VideoError) return error;
  return new VideoError({
    code: fallback,
    message: error instanceof Error ? error.message : String(error),
  });
}
