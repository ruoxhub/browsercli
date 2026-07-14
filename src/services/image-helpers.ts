/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {readFileSync} from 'node:fs';

/**
 * Supported image MIME types for vision-capable providers.
 */
export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

const MEDIA_TYPE_BY_EXT: Record<string, ImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/;

export interface DecodedImage {
  mediaType: ImageMediaType;
  data: string;
}

/**
 * Resolve the MIME type for an image file extension.
 * Falls back to `image/png` when the extension is unknown.
 */
export function getImageMediaType(
  extension: string | undefined,
): ImageMediaType {
  if (!extension) {
    return 'image/png';
  }
  return MEDIA_TYPE_BY_EXT[extension.toLowerCase()] ?? 'image/png';
}

/**
 * Parse an image input in any of the supported forms into base64 data + MIME type.
 *
 * @param imageInput - Either a `data:` URL, raw base64, or (when `isFilePath` is true) a filesystem path.
 * @param isFilePath - Whether `imageInput` should be read from disk.
 */
export function decodeImageInput(
  imageInput: string,
  isFilePath: boolean,
): DecodedImage {
  if (isFilePath) {
    const buffer = readFileSync(imageInput);
    const extension = imageInput.toLowerCase().split('.').pop();
    return {
      mediaType: getImageMediaType(extension),
      data: buffer.toString('base64'),
    };
  }

  const dataUrlMatch = imageInput.match(DATA_URL_PATTERN);
  if (dataUrlMatch) {
    return {
      mediaType: dataUrlMatch[1] as ImageMediaType,
      data: dataUrlMatch[2],
    };
  }

  return {
    mediaType: 'image/png',
    data: imageInput,
  };
}

/**
 * Build a `data:` URL from raw base64 image data and a MIME type.
 */
export function toImageDataUrl(
  mediaType: ImageMediaType,
  base64Data: string,
): string {
  return `data:${mediaType};base64,${base64Data}`;
}

/**
 * HTTP-style error augmented with provider metadata so the retry layer can inspect it.
 */
export interface FormattedProviderError extends Error {
  status?: number;
  code?: string;
}

/**
 * Wrap an unknown error with a provider-specific message and standard status/code fields.
 */
export function formatProviderError(
  prefix: string,
  error: unknown,
): FormattedProviderError {
  if (error instanceof Error) {
    const wrapped: FormattedProviderError = new Error(
      `${prefix}: ${error.message}`,
    );
    wrapped.stack = error.stack;
    return wrapped;
  }
  return new Error(`${prefix}: ${String(error)}`);
}
