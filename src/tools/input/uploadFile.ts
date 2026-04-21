/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Frame} from './types.js';
import type {UploadFileParams, UploadFileResult} from './types.js';

export async function uploadFile(
  frame: Frame,
  params: UploadFileParams,
): Promise<UploadFileResult> {
  const {selector, filePath} = params;
  const tooltype = 'upload_file';
  const page = frame.page();

  try {
    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const uploaded = await (element as any)
      .uploadFile(filePath)
      .then(() => true)
      .catch(() => false);

    if (uploaded) {
      return {
        success: true,
        message: `File uploaded from ${filePath}`,
        tooltype,
        logFormat: 'simple',
      };
    }

    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({timeout: 3000}),
      element.click(),
    ]);
    await fileChooser.accept([filePath]);

    return {
      success: true,
      message: `File uploaded from ${filePath}`,
      tooltype,
      logFormat: 'simple',
    };
  } catch (error) {
    return {
      success: false,
      message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      tooltype,
    };
  }
}